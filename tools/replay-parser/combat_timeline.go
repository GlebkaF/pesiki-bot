package main

import (
	"encoding/json"
	"github.com/dotabuff/manta/dota"
	"math"
	"sort"
)

const combatTimelineVersion = "combat-timeline-v1"
const maxTimelineBuckets = 65536

// Preserve ordinary long matches; pathological traces still use the explicit partial prefix.
const maxTimelineJSONBytes = 1024 * 1024

// Row: [second, sourceIndex, explicitOwnerHeroIndex, targetHeroIndex,
// abilityIndex, damageType (-1 if absent), flags (bit 0: attacker illusion), amount].
// The one-second bucket must not be presented as an exact sub-second interval.
type TimelineRow [8]int64
type CombatTimeline struct {
	Version       string        `json:"version"`
	BucketSeconds int           `json:"bucket_seconds"`
	Heroes        []string      `json:"heroes"`
	Sources       []string      `json:"sources"`
	Abilities     []string      `json:"abilities"`
	Damage        []TimelineRow `json:"damage"`
	Healing       []TimelineRow `json:"healing"`
	Coverage      struct {
		TargetScope            string `json:"target_scope"`
		DamageEvents           int    `json:"damage_events"`
		HealingEvents          int    `json:"healing_events"`
		StoredDamageEvents     int    `json:"stored_damage_events"`
		StoredHealingEvents    int    `json:"stored_healing_events"`
		OwnerKnownDamageEvents int    `json:"owner_known_damage_events"`
		DamageRows             int    `json:"damage_rows"`
		HealingRows            int    `json:"healing_rows"`
		DroppedEvents          int    `json:"dropped_events"`
		Truncated              bool   `json:"truncated"`
		CompleteUntilSecond    *int   `json:"complete_until_second"`
		RowLimit               int    `json:"row_limit"`
		ByteLimit              int    `json:"byte_limit"`
	} `json:"coverage"`
}
type timelineKey struct {
	second                         int
	healing                        bool
	source, owner, target, ability string
	damageType                     int
	flags                          int
}
type timelineValue struct {
	amount int64
	events int
}
type timelineEntry struct {
	key           timelineKey
	value         timelineValue
	owner, target int
}
type combatTimelineCounter struct {
	buckets                                    map[timelineKey]timelineValue
	damageEvents, healingEvents, droppedEvents int
	firstIncomplete                            *int
}

func newCombatTimeline() *combatTimelineCounter {
	return &combatTimelineCounter{buckets: map[timelineKey]timelineValue{}}
}
func (c *combatTimelineCounter) drop(second, events int) {
	c.droppedEvents += events
	if c.firstIncomplete == nil || second < *c.firstIncomplete {
		v := second
		c.firstIncomplete = &v
	}
}
func (c *combatTimelineCounter) observe(e *dota.CMsgDOTACombatLogEntry, seconds float64, name func(uint32) string) {
	healing := e.GetType() == dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_HEAL
	if !healing && e.GetType() != dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_DAMAGE {
		return
	}
	if !e.GetIsTargetHero() || e.GetIsTargetIllusion() || seconds < 0 || math.IsNaN(seconds) || math.IsInf(seconds, 0) {
		return
	}
	if healing {
		c.healingEvents++
	} else {
		c.damageEvents++
	}
	source, target, ability := name(e.GetAttackerName()), name(e.GetTargetName()), name(e.GetInflictorName())
	if source == "" || source == "dota_unknown" {
		source = "unknown"
	}
	if ability == "" || ability == "dota_unknown" {
		ability = "unknown_or_attack"
		if healing {
			ability = "unknown"
		}
	}
	owner := ""
	if e.DamageSourceName != nil {
		owner = name(e.GetDamageSourceName())
	}
	damageType := -1
	if !healing && e.DamageType != nil {
		damageType = int(e.GetDamageType())
	}
	flags := 0
	if e.GetIsAttackerIllusion() {
		flags = 1
	}
	key := timelineKey{int(math.Floor(seconds)), healing, source, owner, target, ability, damageType, flags}
	value, exists := c.buckets[key]
	if !exists && len(c.buckets) >= maxTimelineBuckets {
		c.drop(key.second, 1)
		return
	}
	value.amount += int64(e.GetValue())
	value.events++
	c.buckets[key] = value
}
func (c *combatTimelineCounter) finish(players []*Player) *CombatTimeline {
	heroes := make([]string, len(players))
	indices := map[string]int{}
	ambiguous := map[string]bool{}
	for i, p := range players {
		heroes[i] = p.Hero
		k := normalizedHero(p.Hero)
		if _, exists := indices[k]; exists {
			ambiguous[k] = true
		}
		indices[k] = i
	}
	resolve := func(name string) int {
		if name == "" || name == "unknown" || name == "dota_unknown" {
			return -1
		}
		k := normalizedHero(name)
		if ambiguous[k] {
			return -1
		}
		if i, ok := indices[k]; ok {
			return i
		}
		return -1
	}
	droppedEvents := c.droppedEvents
	var firstIncomplete *int
	if c.firstIncomplete != nil {
		v := *c.firstIncomplete
		firstIncomplete = &v
	}
	entries := make([]timelineEntry, 0, len(c.buckets))
	for k, v := range c.buckets {
		target := resolve(k.target)
		if target < 0 {
			droppedEvents += v.events
			if firstIncomplete == nil || k.second < *firstIncomplete {
				v := k.second
				firstIncomplete = &v
			}
			continue
		}
		entries = append(entries, timelineEntry{k, v, resolve(k.owner), target})
	}
	sort.Slice(entries, func(i, j int) bool {
		a, b := entries[i].key, entries[j].key
		if a.second != b.second {
			return a.second < b.second
		}
		if a.healing != b.healing {
			return !a.healing
		}
		if a.source != b.source {
			return a.source < b.source
		}
		if a.owner != b.owner {
			return a.owner < b.owner
		}
		if a.target != b.target {
			return a.target < b.target
		}
		if a.ability != b.ability {
			return a.ability < b.ability
		}
		if a.damageType != b.damageType {
			return a.damageType < b.damageType
		}
		return a.flags < b.flags
	})
	build := func(keep int) *CombatTimeline {
		t := &CombatTimeline{Version: combatTimelineVersion, BucketSeconds: 1, Heroes: heroes, Sources: []string{}, Abilities: []string{}, Damage: []TimelineRow{}, Healing: []TimelineRow{}}
		sourceSet, abilitySet := map[string]bool{}, map[string]bool{}
		for _, e := range entries[:keep] {
			sourceSet[e.key.source] = true
			abilitySet[e.key.ability] = true
		}
		for s := range sourceSet {
			t.Sources = append(t.Sources, s)
		}
		for s := range abilitySet {
			t.Abilities = append(t.Abilities, s)
		}
		sort.Strings(t.Sources)
		sort.Strings(t.Abilities)
		sources, abilities := map[string]int{}, map[string]int{}
		for i, s := range t.Sources {
			sources[s] = i
		}
		for i, s := range t.Abilities {
			abilities[s] = i
		}
		t.Coverage.TargetScope = "real-heroes"
		t.Coverage.DamageEvents = c.damageEvents
		t.Coverage.HealingEvents = c.healingEvents
		t.Coverage.DroppedEvents = droppedEvents
		t.Coverage.RowLimit = maxTimelineBuckets
		t.Coverage.ByteLimit = maxTimelineJSONBytes
		if firstIncomplete != nil {
			v := *firstIncomplete
			t.Coverage.CompleteUntilSecond = &v
		}
		for _, e := range entries[:keep] {
			k := e.key
			row := TimelineRow{int64(k.second), int64(sources[k.source]), int64(e.owner), int64(e.target), int64(abilities[k.ability]), int64(k.damageType), int64(k.flags), e.value.amount}
			if k.healing {
				t.Healing = append(t.Healing, row)
				t.Coverage.StoredHealingEvents += e.value.events
			} else {
				t.Damage = append(t.Damage, row)
				t.Coverage.StoredDamageEvents += e.value.events
				if e.owner >= 0 {
					t.Coverage.OwnerKnownDamageEvents += e.value.events
				}
			}
		}
		for _, e := range entries[keep:] {
			t.Coverage.DroppedEvents += e.value.events
			if t.Coverage.CompleteUntilSecond == nil || e.key.second < *t.Coverage.CompleteUntilSecond {
				v := e.key.second
				t.Coverage.CompleteUntilSecond = &v
			}
		}
		t.Coverage.Truncated = t.Coverage.DroppedEvents > 0
		t.Coverage.DamageRows = len(t.Damage)
		t.Coverage.HealingRows = len(t.Healing)
		return t
	}
	t := build(len(entries))
	if b, _ := json.Marshal(t); len(b) <= maxTimelineJSONBytes {
		return t
	}
	// Preserve a chronological prefix. Never hide a partial late window behind zeroes.
	lo, hi := 0, len(entries)
	for lo < hi {
		mid := (lo + hi + 1) / 2
		b, _ := json.Marshal(build(mid))
		if len(b) <= maxTimelineJSONBytes {
			lo = mid
		} else {
			hi = mid - 1
		}
	}
	return build(lo)
}
