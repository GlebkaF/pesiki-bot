package main

import (
	"fmt"
	"github.com/dotabuff/manta"
	"github.com/dotabuff/manta/dota"
	"math"
	"sort"
	"strings"
)

const maxHeroJournalEvents = 4096
const maxHeroCounterSamples = 2000000

type HeroDeathCounter struct {
	From   float64 `json:"from"`
	To     float64 `json:"to"`
	Before int     `json:"before"`
	After  int     `json:"after"`
	Delta  int     `json:"delta"`
	Source string  `json:"source"`
}
type HeroDeathJournalEntry struct {
	VictimResourceSlot *int              `json:"victim_resource_slot"`
	KillerResourceSlot *int              `json:"killer_resource_slot"`
	ID                 string            `json:"id"`
	Seconds            float64           `json:"seconds"`
	VictimHero         *string           `json:"victim_hero"`
	VictimSteamID      *string           `json:"victim_steam_id"`
	VictimTeam         *string           `json:"victim_team"`
	RawTarget          string            `json:"raw_target"`
	RawAttacker        string            `json:"raw_attacker"`
	RawSource          *string           `json:"raw_source"`
	AttackerTeam       *string           `json:"attacker_team"`
	WillReincarnate    *bool             `json:"will_reincarnate"`
	Status             string            `json:"status"`
	DeathCounter       *HeroDeathCounter `json:"death_counter"`
	KillerHero         *string           `json:"killer_hero"`
	KillerSteamID      *string           `json:"killer_steam_id"`
	KillerTeam         *string           `json:"killer_team"`
	KillCounter        *HeroDeathCounter `json:"kill_counter"`
	Attribution        string            `json:"attribution"`
	SourceControlled   bool              `json:"source_controlled"`
	SourceIllusion     bool              `json:"source_illusion"`
}
type HeroDeathAudit struct {
	Hero          string `json:"hero"`
	DeathEvents   int    `json:"death_events"`
	CounterDeaths *int   `json:"counter_deaths"`
	KillEvents    int    `json:"kill_events"`
	CounterKills  *int   `json:"counter_kills"`
	DeathsMatch   *bool  `json:"deaths_match"`
	KillsMatch    *bool  `json:"kills_match"`
}
type HeroDeathJournal struct {
	Version  string                  `json:"version"`
	Entries  []HeroDeathJournalEntry `json:"entries"`
	Coverage struct {
		ClockSource            string           `json:"clock_source"`
		ClockComplete          bool             `json:"clock_complete"`
		GameEndObserved        bool             `json:"game_end_observed"`
		RawDeaths              int              `json:"raw_deaths"`
		EntriesStored          int              `json:"entries_stored"`
		VerifiedDeaths         int              `json:"verified_deaths"`
		VerifiedReincarnations int              `json:"verified_reincarnations"`
		VerifiedKills          int              `json:"verified_kills"`
		Unverified             int              `json:"unverified"`
		Contradictions         int              `json:"contradictions"`
		CounterResets          int              `json:"counter_resets"`
		Truncated              bool             `json:"truncated"`
		DroppedEvents          int              `json:"dropped_events"`
		DroppedCounterSamples  int              `json:"dropped_counter_samples"`
		FinalAudit             []HeroDeathAudit `json:"final_audit"`
	} `json:"coverage"`
}
type heroCounterSample struct {
	time          float64
	kills, deaths int
}
type heroCounterHistory struct {
	slot       int
	hero, team string
	steam      uint64
	samples    []heroCounterSample
	invalid    bool
}
type heroJournalRaw struct {
	ts                                                 float32
	target, attacker, source, targetTeam, attackerTeam string
	reincarnate                                        *bool
	illusion                                           bool
}
type heroDeathJournalCollector struct {
	clock                                            *wardLifetimeCollector
	histories                                        map[int]*heroCounterHistory
	events                                           []heroJournalRaw
	ended                                            bool
	endRaw                                           float64
	raw, dropped, sampleCount, sampleDropped, resets int
	clockMissing                                     bool
}

func newHeroDeathJournal(p *manta.Parser, clock *wardLifetimeCollector) *heroDeathJournalCollector {
	c := &heroDeathJournalCollector{clock: clock, histories: map[int]*heroCounterHistory{}}
	var resource *manta.Entity
	var rows []scoreboardCandidate
	dirty := false
	p.OnEntity(func(e *manta.Entity, op manta.EntityOp) error {
		if e.GetClassName() == "CDOTA_PlayerResource" {
			resource = e
			dirty = true
		}
		return nil
	})
	p.Callbacks.OnCSVCMsg_PacketEntities(func(_ *dota.CSVCMsg_PacketEntities) error {
		if c.ended || resource == nil {
			return nil
		}
		if dirty {
			rows = readReplayScoreboard(resource.Get, func(h uint64) string {
				if e := p.FindEntityByHandle(h); e != nil && strings.HasPrefix(e.GetClassName(), "CDOTA_Unit_Hero_") {
					return classToHero(e.GetClassName())
				}
				return ""
			})
			dirty = false
		}
		t := clock.clock(p.NetTick)
		if !lifetimeFinite(t) {
			if len(c.events) > 0 {
				c.clockMissing = true
			}
			return nil
		}
		for _, r := range rows {
			c.sample(r, t)
		}
		return nil
	})
	p.Callbacks.OnCMsgDOTACombatLogEntry(func(e *dota.CMsgDOTACombatLogEntry) error {
		if c.ended {
			return nil
		}
		if e.GetType() == dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_GAME_STATE && e.GetValue() == 6 {
			c.ended = true
			c.endRaw = float64(e.GetTimestamp())
			return nil
		}
		name := func(i uint32) string { s, _ := p.LookupStringByIndex("CombatLogNames", int32(i)); return s }
		c.observeDeath(e, name)
		return nil
	})
	return c
}
func (c *heroDeathJournalCollector) sample(r scoreboardCandidate, t float64) {
	if c.ended || !lifetimeFinite(t) {
		return
	}
	h := c.histories[r.value.ResourceSlot]
	if h == nil {
		h = &heroCounterHistory{slot: r.value.ResourceSlot, hero: r.hero, team: r.team, steam: r.steam}
		c.histories[r.value.ResourceSlot] = h
	}
	if h.hero != r.hero || h.team != r.team || h.steam != r.steam {
		h.invalid = true
		return
	}
	if len(h.samples) > 0 {
		last := h.samples[len(h.samples)-1]
		if t < last.time || r.value.Kills < last.kills || r.value.Deaths < last.deaths {
			c.resets++
			h.invalid = true
			return
		}
		// Pauses freeze native time. A delayed replicated counter update at the same
		// native instant is a zero-width observed bracket, not a clock reset.
		if t == last.time && last.kills == r.value.Kills && last.deaths == r.value.Deaths {
			return
		}
	}
	if c.sampleCount >= maxHeroCounterSamples {
		c.sampleDropped++
		return
	}
	h.samples = append(h.samples, heroCounterSample{t, r.value.Kills, r.value.Deaths})
	c.sampleCount++
}
func (c *heroDeathJournalCollector) observeDeath(e *dota.CMsgDOTACombatLogEntry, name func(uint32) string) {
	if c.ended || e.GetType() != dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_DEATH || !e.GetIsTargetHero() || e.GetIsTargetIllusion() || e.Timestamp == nil || !lifetimeFinite(float64(e.GetTimestamp())) {
		return
	}
	target := name(e.GetTargetName())
	if !strings.HasPrefix(target, "npc_dota_hero_") {
		return
	}
	c.raw++
	if len(c.events) >= maxHeroJournalEvents {
		c.dropped++
		return
	}
	r := heroJournalRaw{ts: e.GetTimestamp(), target: target, attacker: name(e.GetAttackerName()), reincarnate: e.WillReincarnate, illusion: e.GetIsAttackerIllusion()}
	if e.DamageSourceName != nil {
		r.source = name(e.GetDamageSourceName())
	}
	if e.TargetTeam != nil {
		r.targetTeam = wardTeam(e.GetTargetTeam())
	}
	if e.AttackerTeam != nil {
		r.attackerTeam = wardTeam(e.GetAttackerTeam())
	}
	c.events = append(c.events, r)
}
func heroJournalInside(ts float32, from, to float64) bool {
	return ts >= math.Nextafter32(float32(from), float32(math.Inf(-1))) && ts <= math.Nextafter32(float32(to), float32(math.Inf(1)))
}
func heroJournalBracket(a, b heroCounterSample, kill bool, start float64) *HeroDeathCounter {
	before, after := a.deaths, b.deaths
	if kill {
		before, after = a.kills, b.kills
	}
	return &HeroDeathCounter{a.time - start, b.time - start, before, after, after - before, "CDOTA_PlayerResource"}
}
func heroJournalIdentity(players []*Player, h *heroCounterHistory) *Player {
	p := uniqueWardHero(players, "npc_dota_hero_"+h.hero, h.team)
	if p == nil || p.SteamID != h.steam {
		return nil
	}
	return p
}
func (c *heroDeathJournalCollector) finish(players []*Player, start float64) *HeroDeathJournal {
	out := &HeroDeathJournal{Version: "hero-death-journal-v1", Entries: []HeroDeathJournalEntry{}}
	cov := &out.Coverage
	cov.ClockSource = "gamerules"
	cov.ClockComplete = c.clock != nil && !c.clock.clockGap && !c.clock.clockInvalid && c.clock.haveSample && !c.clockMissing && c.clock.clockSamplesDropped == 0
	cov.GameEndObserved = c.ended
	cov.RawDeaths = c.raw
	cov.DroppedEvents = c.dropped
	cov.DroppedCounterSamples = c.sampleDropped
	cov.CounterResets = c.resets
	cov.Truncated = c.dropped > 0 || c.sampleDropped > 0
	cov.FinalAudit = []HeroDeathAudit{}
	if !lifetimeFinite(start) || start < 0 {
		cov.DroppedEvents += len(c.events)
		cov.Truncated = true
		return out
	}
	events := []heroJournalRaw{}
	for _, r := range c.events {
		if c.ended && float64(r.ts) > c.endRaw {
			continue
		}
		events = append(events, r)
	}
	sort.SliceStable(events, func(i, j int) bool { return events[i].ts < events[j].ts })
	for i, r := range events {
		e := HeroDeathJournalEntry{ID: fmt.Sprintf("death-%d", i+1), Seconds: float64(r.ts) - start, RawTarget: r.target, RawAttacker: r.attacker, AttackerTeam: lifetimeSide(r.attackerTeam), WillReincarnate: r.reincarnate, Status: "unverified", Attribution: "unknown", SourceIllusion: r.illusion}
		if r.source != "" {
			e.RawSource = lifetimePtr(r.source)
		}
		if p := uniqueWardHero(players, r.target, r.targetTeam); p != nil {
			e.VictimHero = lifetimePtr(p.Hero)
			e.VictimSteamID = lifetimePtr(fmt.Sprint(p.SteamID))
			e.VictimTeam = lifetimeSide(p.Team)
		}
		out.Entries = append(out.Entries, e)
	}
	// Each positive counter delta must be exhausted by a unique set of event candidates.
	// No final total participates in this join.
	type match struct {
		indices []int
		bracket *HeroDeathCounter
		h       *heroCounterHistory
	}
	deathMatches := []match{}
	deathUses := make([]int, len(events))
	histories := []*heroCounterHistory{}
	for _, h := range c.histories {
		if !h.invalid && heroJournalIdentity(players, h) != nil {
			histories = append(histories, h)
		}
	}
	if cov.ClockComplete && !cov.Truncated {
		for _, h := range histories {
			for j := 1; j < len(h.samples); j++ {
				a, b := h.samples[j-1], h.samples[j]
				if b.deaths <= a.deaths {
					continue
				}
				indices := []int{}
				for i, r := range events {
					if normalizedHero(r.target) == normalizedHero(h.hero) && (r.targetTeam == h.team || r.targetTeam == "") && heroJournalInside(r.ts, a.time, b.time) {
						indices = append(indices, i)
					}
				}
				if len(indices) != b.deaths-a.deaths {
					continue
				}
				identitiesKnown := true
				for _, i := range indices {
					if out.Entries[i].VictimHero == nil || events[i].targetTeam != h.team {
						identitiesKnown = false
					}
				}
				if !identitiesKnown {
					continue
				}
				m := match{indices, heroJournalBracket(a, b, false, start), h}
				deathMatches = append(deathMatches, m)
				for _, i := range indices {
					deathUses[i]++
				}
			}
		}
		for _, m := range deathMatches {
			valid := true
			for _, i := range m.indices {
				if deathUses[i] != 1 {
					valid = false
				}
			}
			if !valid {
				continue
			}
			for _, i := range m.indices {
				e := &out.Entries[i]
				e.DeathCounter = m.bracket
				e.VictimResourceSlot = lifetimePtr(m.h.slot)
				if e.WillReincarnate != nil && *e.WillReincarnate {
					e.Status = "contradiction"
				} else {
					e.Status = "verified_death"
				}
			}
		}
		// An explicit return flag needs an independently observed unchanged counter bracket.
		for i, r := range events {
			e := &out.Entries[i]
			if e.Status != "unverified" || r.reincarnate == nil || !*r.reincarnate || e.VictimHero == nil {
				continue
			}
			for _, h := range histories {
				if normalizedHero(h.hero) != normalizedHero(*e.VictimHero) || h.team != r.targetTeam {
					continue
				}
				j := sort.Search(len(h.samples), func(j int) bool { return float32(h.samples[j].time) >= r.ts })
				if j > 0 && j < len(h.samples) {
					a, b := h.samples[j-1], h.samples[j]
					if a.deaths == b.deaths && heroJournalInside(r.ts, a.time, b.time) {
						e.Status = "verified_reincarnation"
						e.VictimResourceSlot = lifetimePtr(h.slot)
						e.DeathCounter = heroJournalBracket(a, b, false, start)
					}
				}
			}
		}
		killMatches := []match{}
		killUses := make([]int, len(events))
		for _, h := range histories {
			for j := 1; j < len(h.samples); j++ {
				a, b := h.samples[j-1], h.samples[j]
				if b.kills <= a.kills {
					continue
				}
				indices := []int{}
				for i, r := range events {
					e := &out.Entries[i]
					if strings.HasPrefix(r.source, "npc_dota_hero_") && normalizedHero(r.source) == normalizedHero(h.hero) && heroJournalInside(r.ts, a.time, b.time) {
						// Unknown victim/counter evidence cannot be silently removed to make
						// the remaining candidates fit a kill delta.
						if e.Status == "verified_reincarnation" {
							continue
						}
						if e.VictimTeam != nil && *e.VictimTeam == h.team && r.attackerTeam == h.team {
							continue
						}
						indices = append(indices, i)
					}
				}
				if len(indices) != b.kills-a.kills {
					continue
				}
				allVerified := true
				for _, i := range indices {
					e := out.Entries[i]
					if e.Status != "verified_death" || events[i].attackerTeam != h.team || e.VictimTeam == nil || *e.VictimTeam == h.team {
						allVerified = false
					}
				}
				if !allVerified {
					continue
				}
				killMatches = append(killMatches, match{indices, heroJournalBracket(a, b, true, start), h})
				for _, i := range indices {
					killUses[i]++
				}
			}
		}
		for _, m := range killMatches {
			valid := true
			for _, i := range m.indices {
				if killUses[i] != 1 {
					valid = false
				}
			}
			if !valid {
				continue
			}
			for _, i := range m.indices {
				e := &out.Entries[i]
				e.KillerResourceSlot = lifetimePtr(m.h.slot)
				e.KillerHero = lifetimePtr(heroJournalIdentity(players, m.h).Hero)
				e.KillerSteamID = lifetimePtr(fmt.Sprint(m.h.steam))
				e.KillerTeam = lifetimeSide(m.h.team)
				e.KillCounter = m.bracket
				e.Attribution = "verified_enemy_kill"
				rawAttacker := events[i].attacker
				e.SourceControlled = e.SourceIllusion || (rawAttacker != "" && rawAttacker != "dota_unknown" && rawAttacker != "unknown" && normalizedHero(rawAttacker) != normalizedHero(m.h.hero))
			}
		}
	}
	for i := range out.Entries {
		e := &out.Entries[i]
		r := events[i]
		if e.Status == "verified_death" && e.Attribution == "unknown" && e.VictimTeam != nil {
			if p := uniqueWardHero(players, r.source, r.attackerTeam); p != nil && p.Team == *e.VictimTeam {
				if e.VictimHero != nil && p.Hero == *e.VictimHero {
					e.Attribution = "self"
				} else {
					e.Attribution = "allied_deny"
				}
			} else if !strings.HasPrefix(r.attacker, "npc_dota_hero_") && r.source != "" && r.source == r.attacker && (strings.HasPrefix(r.attacker, "npc_dota_neutral_") || strings.HasPrefix(r.attacker, "npc_dota_goodguys_") || strings.HasPrefix(r.attacker, "npc_dota_badguys_") || r.attacker == "dota_fountain" || r.attacker == "npc_dota_roshan") {
				e.Attribution = "environment"
			}
		}
		switch e.Status {
		case "verified_death":
			cov.VerifiedDeaths++
		case "verified_reincarnation":
			cov.VerifiedReincarnations++
		case "contradiction":
			cov.Contradictions++
		default:
			cov.Unverified++
		}
		if e.Attribution == "verified_enemy_kill" {
			cov.VerifiedKills++
		}
	}
	cov.EntriesStored = len(out.Entries)
	for _, p := range players {
		a := HeroDeathAudit{Hero: p.Hero}
		for _, e := range out.Entries {
			if e.Status == "verified_death" && e.VictimHero != nil && *e.VictimHero == p.Hero {
				a.DeathEvents++
			}
			if e.Attribution == "verified_enemy_kill" && e.KillerHero != nil && *e.KillerHero == p.Hero {
				a.KillEvents++
			}
		}
		if c.ended && p.ReplayScoreboard != nil && p.ReplayScoreboard.Complete {
			a.CounterDeaths = lifetimePtr(p.ReplayScoreboard.Deaths)
			a.CounterKills = lifetimePtr(p.ReplayScoreboard.Kills)
			a.DeathsMatch = lifetimePtr(a.DeathEvents == *a.CounterDeaths)
			a.KillsMatch = lifetimePtr(a.KillEvents == *a.CounterKills)
		}
		cov.FinalAudit = append(cov.FinalAudit, a)
	}
	return out
}
