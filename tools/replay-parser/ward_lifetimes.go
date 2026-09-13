package main

import (
	"fmt"
	"github.com/dotabuff/manta"
	"github.com/dotabuff/manta/dota"
	"math"
	"strings"
)

const maxWardClockSamples = 200000
const maxWardLifetimes = 4096
const maxWardLifetimeDeaths = 16384

type wardLifetimePosition struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Source string  `json:"source"`
}
type wardLifetimeWindow struct {
	From float64 `json:"from"`
	To   float64 `json:"to"`
}
type wardLifetimeKiller struct {
	Attacker         string  `json:"attacker"`
	AttackerHero     *string `json:"attacker_hero"`
	AttackerTeam     *string `json:"attacker_team"`
	CombatSeconds    float64 `json:"combat_seconds"`
	Source           string  `json:"source"`
	SourceControlled bool    `json:"source_controlled"`
	SourceIllusion   bool    `json:"source_illusion"`
}
type wardLifetimeEntry struct {
	ID                     string                `json:"id"`
	EntityIndex            int32                 `json:"entity_index"`
	EntitySerial           int32                 `json:"entity_serial"`
	Kind                   string                `json:"kind"`
	Team                   *string               `json:"team"`
	OwnerHero              *string               `json:"owner_hero"`
	OwnerSteamID           *string               `json:"owner_steam_id"`
	PlacedSeconds          *float64              `json:"placed_seconds"`
	FirstObservedSeconds   float64               `json:"first_observed_seconds"`
	LastObservedSeconds    float64               `json:"last_observed_seconds"`
	DeathObservedSeconds   *float64              `json:"death_observed_seconds"`
	DeathObservationWindow *wardLifetimeWindow   `json:"death_observation_window_seconds"`
	DeletedObservedSeconds *float64              `json:"deleted_observed_seconds"`
	LeftObservedSeconds    *float64              `json:"left_observed_seconds"`
	AliveAtEnd             *bool                 `json:"alive_at_end"`
	Position               *wardLifetimePosition `json:"position"`
	PositionMoved          bool                  `json:"position_moved"`
	ObservationComplete    bool                  `json:"observation_complete"`
	Killer                 *wardLifetimeKiller   `json:"killer"`
}
type WardLifetimes struct {
	Version  string              `json:"version"`
	Entries  []wardLifetimeEntry `json:"entries"`
	Coverage struct {
		ClockSource                      string   `json:"clock_source"`
		ClockSamplesDropped              int      `json:"clock_samples_dropped"`
		ClockComplete                    bool     `json:"clock_complete"`
		EntitiesSeen                     int      `json:"entities_seen"`
		EntitiesStored                   int      `json:"entities_stored"`
		OwnerResolved                    int      `json:"owner_resolved"`
		CreationTimeKnown                int      `json:"creation_time_known"`
		DeathObserved                    int      `json:"death_observed"`
		KillerMatched                    int      `json:"killer_matched"`
		AmbiguousKillerMatches           int      `json:"ambiguous_killer_matches"`
		PositionObserved                 int      `json:"position_observed"`
		MovedEntities                    int      `json:"moved_entities"`
		GameEndObserved                  bool     `json:"game_end_observed"`
		TickIntervalSeconds              *float64 `json:"tick_interval_seconds"`
		MaxDeathObservationWindowSeconds *float64 `json:"max_death_observation_window_seconds"`
		Truncated                        bool     `json:"truncated"`
		DroppedEntities                  int      `json:"dropped_entities"`
		DroppedKillerEvents              int      `json:"dropped_killer_events"`
	} `json:"coverage"`
}
type wardLifetimeObservation struct {
	index, serial          int32
	kind, team, owner      string
	tick                   uint32
	created, deleted, left bool
	createdAt              *float32
	life                   *uint32
	lastDamage             *float32
	position               *wardLifetimePosition
}
type wardLifetimeState struct {
	id                                                string
	index, serial                                     int32
	kind, team, owner                                 string
	createdAt                                         *float32
	firstTick, lastTick                               uint32
	lastAliveTick                                     *uint32
	deathTick, deletedTick, leftTick                  *uint32
	deathFromTick                                     *uint32
	deathLastDamage                                   *float32
	life                                              *uint32
	present, complete, ownerConflicted, positionMoved bool
	position                                          *wardLifetimePosition
}
type wardLifetimeDeath struct {
	ts                                                           float32
	kind, targetOwner, targetTeam, attacker, owner, attackerTeam string
	illusion                                                     bool
}
type wardLifetimeCollector struct {
	nativeTimes                  map[uint32]float64
	clockSamplesDropped          int
	sampleTick                   uint32
	sampleTime                   float64
	haveSample                   bool
	interval                     float64
	states                       []*wardLifetimeState
	active                       map[string]*wardLifetimeState
	generations                  map[string]int
	ignored                      map[string]bool
	seen, dropped, killerDropped int
	deaths                       []wardLifetimeDeath
	ended                        bool
	endRaw                       float64
	lastPacket                   uint32
	lastPacketSpan               float64
	havePacket                   bool
	clockGap                     bool
	clockInvalid                 bool
}

func lifetimePtr[T any](v T) *T     { return &v }
func lifetimeFinite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func lifetimeSide(s string) *string {
	if s == "radiant" || s == "dire" {
		return lifetimePtr(s)
	}
	return nil
}
func newWardLifetimeCollector(p *manta.Parser) *wardLifetimeCollector {
	c := &wardLifetimeCollector{nativeTimes: map[uint32]float64{}, active: map[string]*wardLifetimeState{}, generations: map[string]int{}}
	p.Callbacks.OnCSVCMsg_ServerInfo(func(e *dota.CSVCMsg_ServerInfo) error {
		v := float64(e.GetTickInterval())
		if v > 0 && v <= 1 && lifetimeFinite(v) {
			if c.interval > 0 && c.interval != v {
				c.clockGap = true
				c.clockInvalid = true
			}
			if !c.clockInvalid {
				c.interval = v
			}
		}
		return nil
	})
	var rules *manta.Entity
	sample := func() {
		if c.ended {
			return
		}
		if rules == nil {
			found := p.FilterEntity(func(e *manta.Entity) bool { return e.GetClassName() == "CDOTAGamerulesProxy" })
			if len(found) == 1 {
				rules = found[0]
			}
		}
		v, ok := lifetimeNativeClock(rules, p.NetTick, c.interval)
		c.sampleClock(p.NetTick, v, ok)
	}
	p.Callbacks.OnCSVCMsg_PacketEntities(func(e *dota.CSVCMsg_PacketEntities) error { sample(); c.confirmPacket(p.NetTick); return nil })
	p.OnEntity(func(e *manta.Entity, op manta.EntityOp) error {
		if c.ended {
			return nil
		}
		cn := e.GetClassName()
		kind := ""
		switch cn {
		case "CDOTA_NPC_Observer_Ward":
			kind = "observer"
		case "CDOTA_NPC_Observer_Ward_TrueSight":
			kind = "sentry"
		}
		if kind == "" {
			return nil
		}
		sample()
		o := wardLifetimeObservation{index: e.GetIndex(), serial: e.GetSerial(), kind: kind, tick: p.NetTick, created: op.Flag(manta.EntityOpCreated), deleted: op.Flag(manta.EntityOpDeleted), left: op.Flag(manta.EntityOpLeft)}
		if v, ok := e.GetFloat32("m_flCreateTime"); ok && v >= 0 && lifetimeFinite(float64(v)) {
			o.createdAt = lifetimePtr(v)
		}
		if v, ok := e.GetUint32("m_lifeState"); ok {
			o.life = lifetimePtr(v)
		}
		if v, ok := e.GetFloat32("m_flLastDamageTime"); ok && lifetimeFinite(float64(v)) {
			o.lastDamage = lifetimePtr(v)
		}
		if v, ok := e.GetUint32("m_iTeamNum"); ok {
			o.team = wardTeam(v)
		}
		if h, ok := e.GetUint64("m_hOwnerEntity"); ok {
			owner := p.FindEntityByHandle(h)
			if owner != nil && owner.GetClassName() == "CDOTAPlayerController" {
				if h, ok := owner.GetUint64("m_hAssignedHero"); ok {
					owner = p.FindEntityByHandle(h)
				} else {
					owner = nil
				}
			}
			if owner != nil && strings.HasPrefix(owner.GetClassName(), "CDOTA_Unit_Hero_") {
				o.owner = "npc_dota_hero_" + classToHero(owner.GetClassName())
			}
		}
		cx, a := e.GetUint32("CBodyComponent.m_cellX")
		cy, b := e.GetUint32("CBodyComponent.m_cellY")
		vx, d := e.GetFloat32("CBodyComponent.m_vecX")
		vy, f := e.GetFloat32("CBodyComponent.m_vecY")
		if a && b && d && f {
			x, y := float64(cx)*CellWidth+float64(vx)-CellOffset, float64(cy)*CellWidth+float64(vy)-CellOffset
			if lifetimeFinite(x) && lifetimeFinite(y) {
				o.position = &wardLifetimePosition{x, y, "ward_entity"}
			}
		}
		c.observeEntity(o)
		return nil
	})
	return c
}
func (c *wardLifetimeCollector) observeEntity(o wardLifetimeObservation) {
	if c.ended {
		return
	}
	if c.active == nil {
		c.active = map[string]*wardLifetimeState{}
		c.generations = map[string]int{}
	}
	key := fmt.Sprintf("%d:%d", o.index, o.serial)
	if c.ignored == nil {
		c.ignored = map[string]bool{}
	}
	if c.ignored[key] {
		if o.deleted {
			delete(c.ignored, key)
		}
		return
	}
	s := c.active[key]
	if !lifetimeFinite(c.clock(o.tick)) {
		c.clockGap = true
		if s != nil {
			s.complete = false
			s.present = false
		} else {
			c.seen++
			c.dropped++
			c.ignored[key] = true
		}
		return
	}
	if o.created && s != nil && (s.deletedTick != nil || (s.createdAt != nil && o.createdAt != nil && math.Float32bits(*s.createdAt) != math.Float32bits(*o.createdAt))) {
		if o.tick < s.lastTick {
			s.complete = false
			c.clockGap = true
			return
		}
		if s.deletedTick == nil {
			s.complete = false
			s.present = false
		}
		s = nil
	}
	if s == nil {
		c.seen++
		if len(c.states) >= maxWardLifetimes {
			c.dropped++
			c.ignored[key] = true
			return
		}
		c.generations[key]++
		id := key
		if c.generations[key] > 1 {
			id = fmt.Sprintf("%s:%d", key, c.generations[key])
		}
		s = &wardLifetimeState{id: id, index: o.index, serial: o.serial, kind: o.kind, firstTick: o.tick, lastTick: o.tick, createdAt: o.createdAt, present: true, complete: o.created && o.createdAt != nil}
		c.active[key] = s
		c.states = append(c.states, s)
	}
	if o.tick < s.lastTick {
		s.complete = false
		c.clockGap = true
		return
	}
	s.lastTick = o.tick
	if o.createdAt != nil && s.createdAt != nil && math.Float32bits(*o.createdAt) != math.Float32bits(*s.createdAt) {
		s.complete = false
	}
	if o.owner != "" {
		if s.owner != "" && normalizedHero(s.owner) != normalizedHero(o.owner) {
			s.ownerConflicted = true
			s.complete = false
		}
		if !s.ownerConflicted {
			s.owner = o.owner
		}
	}
	if o.team != "" {
		if s.team != "" && s.team != o.team {
			s.complete = false
			s.ownerConflicted = true
		}
		s.team = o.team
	}
	if o.position == nil {
		s.complete = false
	}
	if o.position != nil {
		if s.position == nil {
			copy := *o.position
			s.position = &copy
		} else if s.position.X != o.position.X || s.position.Y != o.position.Y {
			s.positionMoved = true
		}
	}
	if o.life != nil {
		if *o.life != 0 && *o.life != 1 && *o.life != 2 {
			s.complete = false
		}
		if (*o.life == 1 || *o.life == 2) && s.deathTick == nil {
			s.deathTick = lifetimePtr(o.tick)
			s.deathLastDamage = o.lastDamage
			if s.lastAliveTick != nil {
				s.deathFromTick = lifetimePtr(*s.lastAliveTick)
			} else {
				s.complete = false
			}
		}
		if *o.life == 0 && s.deathTick != nil {
			s.complete = false
		} // resurrection/reuse without a created event is not continuous lifetime
		s.life = lifetimePtr(*o.life)
	} else {
		s.complete = false
	}
	if o.deleted {
		s.deletedTick = lifetimePtr(o.tick)
		s.present = false
	} else if o.left {
		if s.leftTick == nil {
			s.leftTick = lifetimePtr(o.tick)
		}
		s.present = false
		s.complete = false
	} else {
		s.present = true
	}
	if s.present && s.life != nil && *s.life == 0 {
		s.lastAliveTick = lifetimePtr(o.tick)
	}
}

// State retained in an entity packet is an observed alive state even if its fields did not change.
func (c *wardLifetimeCollector) confirmPacket(tick uint32) {
	if c.ended {
		return
	}
	if !lifetimeFinite(c.clock(tick)) {
		c.clockGap = true
		return
	}
	if c.havePacket && tick < c.lastPacket {
		c.clockGap = true
		for _, s := range c.states {
			s.complete = false
		}
		return
	}
	if c.havePacket && tick > c.lastPacket {
		c.lastPacketSpan = c.clock(tick) - c.clock(c.lastPacket)
	}
	c.lastPacket = tick
	c.havePacket = true
	for _, s := range c.states {
		if s.present {
			s.lastTick = tick
			if s.life != nil && *s.life == 0 {
				s.lastAliveTick = lifetimePtr(tick)
			}
		}
	}
}
func (c *wardLifetimeCollector) end(ts float64) {
	if c.ended || !lifetimeFinite(ts) {
		return
	}
	c.ended = true
	c.endRaw = ts
}
func (c *wardLifetimeCollector) observeDeath(e *dota.CMsgDOTACombatLogEntry, name func(uint32) string) {
	if c.ended || e.GetType() != dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_DEATH || e.Timestamp == nil || !lifetimeFinite(float64(e.GetTimestamp())) {
		return
	}
	kind := actualWardKind(name(e.GetTargetName()))
	attacker := name(e.GetAttackerName())
	if kind == "" || attacker == name(e.GetTargetName()) || e.GetIsTargetIllusion() {
		return
	}
	if len(c.deaths) >= maxWardLifetimeDeaths {
		c.killerDropped++
		return
	}
	d := wardLifetimeDeath{ts: e.GetTimestamp(), kind: kind, attacker: attacker, illusion: e.GetIsAttackerIllusion()}
	if e.TargetSourceName != nil {
		d.targetOwner = name(e.GetTargetSourceName())
	}
	if e.DamageSourceName != nil {
		d.owner = name(e.GetDamageSourceName())
	}
	if e.TargetTeam != nil {
		d.targetTeam = wardTeam(e.GetTargetTeam())
	}
	if e.AttackerTeam != nil {
		d.attackerTeam = wardTeam(e.GetAttackerTeam())
	}
	c.deaths = append(c.deaths, d)
}
func (c *wardLifetimeCollector) clock(tick uint32) float64 {
	if v, ok := c.nativeTimes[tick]; ok {
		return v
	}
	return math.NaN()
}
func (c *wardLifetimeCollector) finish(players []*Player, start float64) *WardLifetimes {
	out := &WardLifetimes{Version: "ward-lifetimes-v1", Entries: []wardLifetimeEntry{}}
	coverage := &out.Coverage
	coverage.ClockSource = "gamerules"
	coverage.ClockSamplesDropped = c.clockSamplesDropped
	coverage.ClockComplete = !c.clockGap && !c.clockInvalid && c.clockSamplesDropped == 0 && c.haveSample
	coverage.EntitiesSeen = c.seen
	coverage.DroppedEntities = c.dropped
	coverage.DroppedKillerEvents = c.killerDropped
	coverage.GameEndObserved = c.ended
	coverage.Truncated = c.dropped > 0 || c.killerDropped > 0 || c.clockSamplesDropped > 0
	if c.clockInvalid || c.interval <= 0 || !lifetimeFinite(c.interval) || !lifetimeFinite(start) || start < 0 {
		coverage.DroppedEntities += len(c.states)
		coverage.Truncated = len(c.states) > 0 || coverage.Truncated
		return out
	}
	coverage.TickIntervalSeconds = lifetimePtr(c.interval)
	states := []*wardLifetimeState{}
	// Clip replicated observations to the known final boundary, not to a fabricated lifetime expiry.
	clock := func(t uint32) float64 {
		v := c.clock(t)
		if c.ended && v > c.endRaw {
			v = c.endRaw
		}
		return v - start
	}
	for _, s := range c.states {
		ticks := []uint32{s.firstTick, s.lastTick}
		for _, t := range []*uint32{s.deathTick, s.deathFromTick, s.deletedTick, s.leftTick} {
			if t != nil {
				ticks = append(ticks, *t)
			}
		}
		valid := true
		for _, t := range ticks {
			if !lifetimeFinite(c.clock(t)) {
				valid = false
			}
		}
		if !valid {
			coverage.DroppedEntities++
			coverage.Truncated = true
			continue
		}
		if c.ended && ((s.createdAt != nil && float64(*s.createdAt) > c.endRaw) || c.clock(s.firstTick) > c.endRaw+c.interval) {
			continue
		}
		e := wardLifetimeEntry{ID: s.id, EntityIndex: s.index, EntitySerial: s.serial, Kind: s.kind, Team: lifetimeSide(s.team), FirstObservedSeconds: clock(s.firstTick), LastObservedSeconds: clock(s.lastTick), Position: s.position, PositionMoved: s.positionMoved, ObservationComplete: s.complete && !c.clockGap}
		if s.createdAt != nil && *s.createdAt >= 0 && lifetimeFinite(float64(*s.createdAt)) {
			e.PlacedSeconds = lifetimePtr(float64(*s.createdAt) - start)
			coverage.CreationTimeKnown++
			if float64(*s.createdAt) > c.clock(s.firstTick)+c.interval || c.clock(s.firstTick)-float64(*s.createdAt) > 2*c.interval {
				e.ObservationComplete = false
			}
		} else {
			e.ObservationComplete = false
		}
		if !s.ownerConflicted {
			if p := uniqueWardHero(players, s.owner, s.team); p != nil {
				e.OwnerHero = lifetimePtr(p.Hero)
				if p.SteamID > 76561197960265728 {
					e.OwnerSteamID = lifetimePtr(fmt.Sprint(p.SteamID))
				}
				coverage.OwnerResolved++
			}
		}
		if s.position != nil {
			coverage.PositionObserved++
		}
		if s.positionMoved {
			coverage.MovedEntities++
		}
		if s.deathTick != nil {
			e.DeathObservedSeconds = lifetimePtr(clock(*s.deathTick))
			coverage.DeathObserved++
			if s.deathFromTick != nil && *s.deathFromTick <= *s.deathTick {
				e.DeathObservationWindow = &wardLifetimeWindow{clock(*s.deathFromTick), clock(*s.deathTick)}
				span := e.DeathObservationWindow.To - e.DeathObservationWindow.From
				if coverage.MaxDeathObservationWindowSeconds == nil || span > *coverage.MaxDeathObservationWindowSeconds {
					coverage.MaxDeathObservationWindowSeconds = lifetimePtr(span)
				}
			} else {
				e.ObservationComplete = false
			}
		}
		if s.deletedTick != nil {
			e.DeletedObservedSeconds = lifetimePtr(clock(*s.deletedTick))
		}
		if s.leftTick != nil {
			e.LeftObservedSeconds = lifetimePtr(clock(*s.leftTick))
		}
		if c.ended && s.present && s.deathTick == nil {
			tolerance := math.Max(c.interval, c.lastPacketSpan) + math.Abs(float64(math.Nextafter32(float32(c.endRaw), float32(math.Inf(1))))-c.endRaw)
			if !c.havePacket || math.Abs(c.clock(c.lastPacket)-c.endRaw) > tolerance {
				e.ObservationComplete = false
			}
		}
		if c.ended && e.ObservationComplete {
			if s.deathTick != nil {
				e.AliveAtEnd = lifetimePtr(false)
			} else if s.present && s.life != nil && *s.life == 0 {
				e.AliveAtEnd = lifetimePtr(true)
			}
		}
		out.Entries = append(out.Entries, e)
		states = append(states, s)
	}
	coverage.EntitiesStored = len(out.Entries)
	// Mutual uniqueness matters: duplicate combat rows or simultaneous matching wards reject both pairings.
	candidate := make([][]int, len(c.deaths))
	reverse := make([][]int, len(states))
	for i, d := range c.deaths {
		if float64(d.ts) < start || (c.ended && float64(d.ts) > c.endRaw) {
			continue
		}
		for j, s := range states {
			e := &out.Entries[j]
			if !e.ObservationComplete || e.OwnerHero == nil || e.Team == nil || e.Kind != d.kind || *e.Team != d.targetTeam || normalizedHero(*e.OwnerHero) != normalizedHero(d.targetOwner) || !strings.HasPrefix(d.targetOwner, "npc_dota_hero_") || s.deathLastDamage == nil || *s.deathLastDamage <= 0 || math.Float32bits(*s.deathLastDamage) != math.Float32bits(d.ts) || s.deathTick == nil || s.deathFromTick == nil {
				continue
			}
			// One float32 ULP on either boundary accounts for network float precision; no arbitrary time fuzz.
			low, high := float32(c.clock(*s.deathFromTick)), float32(c.clock(*s.deathTick))
			if d.ts < math.Nextafter32(low, float32(math.Inf(-1))) || d.ts > math.Nextafter32(high, float32(math.Inf(1))) {
				continue
			}
			candidate[i] = append(candidate[i], j)
			reverse[j] = append(reverse[j], i)
		}
	}
	for i, js := range candidate {
		if len(js) != 1 {
			if len(js) > 1 {
				coverage.AmbiguousKillerMatches++
			}
			continue
		}
		j := js[0]
		if len(reverse[j]) != 1 {
			coverage.AmbiguousKillerMatches++
			continue
		}
		d := c.deaths[i]
		k := &wardLifetimeKiller{Attacker: d.attacker, AttackerTeam: lifetimeSide(d.attackerTeam), CombatSeconds: float64(d.ts) - start, Source: "unique-last-damage-match", SourceIllusion: d.illusion}
		if owner := uniqueWardHero(players, d.owner, d.attackerTeam); owner != nil {
			k.AttackerHero = lifetimePtr(owner.Hero)
			k.SourceControlled = d.illusion || normalizedHero(d.attacker) != normalizedHero(owner.Hero)
		}
		out.Entries[j].Killer = k
		coverage.KillerMatched++
	}
	return out
}

// All entity states in a PacketEntities message are decoded before OnEntity handlers.
// Reading GameRules here therefore uses the same packet's pause state, regardless of entity order.
func lifetimeNativeClock(rules *manta.Entity, tick uint32, interval float64) (float64, bool) {
	if rules == nil || interval <= 0 || !lifetimeFinite(interval) {
		return 0, false
	}
	if old, ok := rules.GetFloat32("m_pGameRules.m_fGameTime"); ok {
		return float64(old), lifetimeFinite(float64(old))
	}
	paused, ok := rules.Get("m_pGameRules.m_bGamePaused").(bool)
	if !ok {
		return 0, false
	}
	total, ok := lifetimeUint(rules.Get("m_pGameRules.m_nTotalPausedTicks"))
	if !ok {
		return 0, false
	}
	pauseStart, ok := lifetimeUint(rules.Get("m_pGameRules.m_nPauseStartTick"))
	if !ok {
		return 0, false
	}
	return lifetimePauseClock(tick, total, pauseStart, paused, interval)
}
func lifetimeUint(v any) (uint32, bool) {
	switch n := v.(type) {
	case uint32:
		return n, true
	case int32:
		if n >= 0 {
			return uint32(n), true
		}
	case uint64:
		if n <= math.MaxUint32 {
			return uint32(n), true
		}
	case int64:
		if n >= 0 && n <= math.MaxUint32 {
			return uint32(n), true
		}
	}
	return 0, false
}
func lifetimePauseClock(tick, total, pauseStart uint32, paused bool, interval float64) (float64, bool) {
	effective := tick
	if paused {
		if pauseStart > tick {
			return 0, false
		}
		effective = pauseStart
	}
	if total > effective || interval <= 0 || !lifetimeFinite(interval) {
		return 0, false
	}
	return float64(float32(effective-total) * float32(interval)), true
}
func (c *wardLifetimeCollector) sampleClock(tick uint32, v float64, ok bool) {
	if c.ended {
		return
	}
	if !ok || !lifetimeFinite(v) {
		if len(c.states) > 0 {
			c.clockGap = true
		}
		return
	}
	if c.nativeTimes == nil {
		c.nativeTimes = map[uint32]float64{}
	}
	if old, exists := c.nativeTimes[tick]; exists {
		if old != v {
			c.clockGap = true
		}
		return
	}
	if len(c.nativeTimes) >= maxWardClockSamples {
		c.clockSamplesDropped++
		c.clockGap = true
		return
	}
	if c.haveSample {
		// A pause can make time stand still; a backward jump or faster-than-ticks jump cannot be trusted.
		epsilon := math.Abs(float64(math.Nextafter32(float32(v), float32(math.Inf(1))))-v) * 2
		if tick < c.sampleTick || v < c.sampleTime-epsilon || v-c.sampleTime > float64(tick-c.sampleTick)*c.interval+epsilon {
			c.clockGap = true
			return
		}
	}
	c.nativeTimes[tick] = v
	c.sampleTick = tick
	c.sampleTime = v
	c.haveSample = true
}
