package main

import (
	"fmt"
	"github.com/dotabuff/manta/dota"
	"strings"
)

const analyticsVersion = "combat-log-v3"

type combatPoint struct {
	CoordinatesSource string   `json:"coordinates_source,omitempty"`
	Min               float64  `json:"min"`
	X                 *float32 `json:"x,omitempty"`
	Y                 *float32 `json:"y,omitempty"`
}
type castEvent struct {
	Min      float64 `json:"min"`
	Ability  string  `json:"ability"`
	Target   string  `json:"target,omitempty"`
	Ultimate bool    `json:"ultimate,omitempty"`
	Item     bool    `json:"item,omitempty"`
}
type deathEvent struct {
	combatPoint
	Killer   string          `json:"killer"`
	Incoming *incomingDamage `json:"incoming,omitempty"`
}
type wardEvent struct {
	combatPoint
	Kind             string `json:"kind"`
	Event            string `json:"event"`
	DestroyKind      string `json:"destroy_kind,omitempty"`
	Attacker         string `json:"attacker,omitempty"`
	AttackerHero     string `json:"attacker_hero,omitempty"`
	AttackerTeam     string `json:"attacker_team,omitempty"`
	TargetTeam       string `json:"target_team,omitempty"`
	TargetOwnerHero  string `json:"target_owner_hero,omitempty"`
	SourceControlled bool   `json:"source_controlled,omitempty"`
	SourceIllusion   bool   `json:"source_illusion,omitempty"`
}
type goldEvent struct {
	Min    float64 `json:"min"`
	Value  int32   `json:"value"`
	Reason *uint32 `json:"reason,omitempty"`
}
type modifierEvent struct {
	Min      float64  `json:"min"`
	Target   string   `json:"target"`
	Modifier string   `json:"modifier"`
	Stun     *float32 `json:"stun,omitempty"`
	Slow     *float32 `json:"slow,omitempty"`
	Elapsed  *float32 `json:"elapsed,omitempty"`
	Silence  bool     `json:"silence,omitempty"`
	Root     bool     `json:"root,omitempty"`
}
type CombatDetails struct {
	Coverage struct {
		UltimateClassification bool `json:"ultimate_classification"`
		DeathPositions         bool `json:"death_positions"`
		XP                     bool `json:"xp"`
		WardPlacements         bool `json:"ward_placements"`
		WardDestroySemantics   bool `json:"ward_destroy_semantics"`
		HealingTargetIdentity  bool `json:"healing_target_identity"`
	} `json:"coverage"`
	recentDamage    []damageObservation
	droppedDamageAt float64
	abilityEvents   int
	abilityFlags    int
	Version         string `json:"version"`
	Healing         struct {
		Self        int            `json:"self"`
		OtherHeroes int            `json:"other_heroes"`
		Units       int            `json:"units"`
		ByTarget    map[string]int `json:"by_target"`
		ByAbility   map[string]int `json:"by_ability"`
	} `json:"healing"`
	Damage struct {
		ByAbility map[string]int `json:"by_ability"`
		ByTarget  map[string]int `json:"by_target"`
		ByType    map[string]int `json:"by_type"`
	} `json:"damage"`
	Casts            []castEvent     `json:"casts"`
	Deaths           []deathEvent    `json:"deaths"`
	Wards            []wardEvent     `json:"wards"`
	Buybacks         []combatPoint   `json:"buybacks"`
	Gold             []goldEvent     `json:"gold"`
	XPByMinute       []int           `json:"xp_by_minute"`
	LastHitsByMinute []int           `json:"last_hits_by_minute"`
	DeniesByMinute   []int           `json:"denies_by_minute"`
	Modifiers        []modifierEvent `json:"modifiers"`
	DroppedEvents    int             `json:"dropped_events"`
	XPEvents         int             `json:"xp_events"`
	xp               int
}

func combatFor(p *Player) *CombatDetails {
	if p.CombatDetails == nil {
		d := &CombatDetails{droppedDamageAt: -1e30, Version: analyticsVersion, Casts: []castEvent{}, Deaths: []deathEvent{}, Wards: []wardEvent{}, Buybacks: []combatPoint{}, Gold: []goldEvent{}, Modifiers: []modifierEvent{}, XPByMinute: []int{}, LastHitsByMinute: []int{}, DeniesByMinute: []int{}}
		d.Coverage.HealingTargetIdentity = true
		d.Healing.ByTarget = map[string]int{}
		d.Healing.ByAbility = map[string]int{}
		d.Damage.ByAbility = map[string]int{}
		d.Damage.ByTarget = map[string]int{}
		d.Damage.ByType = map[string]int{}
		p.CombatDetails = d
	}
	return p.CombatDetails
}
func point(e *dota.CMsgDOTACombatLogEntry, min float64) combatPoint {
	return combatPoint{Min: round(min, 3), X: e.LocationX, Y: e.LocationY}
}
func wardKind(name string) string {
	if strings.Contains(name, "sentry") || strings.Contains(name, "true_sight") {
		return "sentry"
	}
	if strings.Contains(name, "observer") {
		return "observer"
	}
	return "other"
}

// Only explicit combat-log fields are retained. Modifier elapsed durations are
// observations (possibly overlapping), not seconds of unique crowd control.
func collectCombat(e *dota.CMsgDOTACombatLogEntry, min float64, attacker, target, inflictor string, byHero map[string]*Player, bySlot map[int]*Player) {
	get := func(name string) *CombatDetails {
		if !strings.HasPrefix(name, "npc_dota_hero_") {
			return nil
		}
		return combatFor(getOrCreate(byHero, name))
	}
	ap, tp := get(attacker), get(target)
	switch e.GetType() {
	case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_DAMAGE:
		if tp != nil && e.GetIsTargetHero() && !e.GetIsTargetIllusion() {
			tp.recordIncoming(min*60, attacker, inflictor, int(e.GetValue()))
		}
		if ap != nil && !e.GetIsAttackerIllusion() && e.GetIsTargetHero() && !e.GetIsTargetIllusion() {
			ability := inflictor
			if ability == "" || ability == "dota_unknown" {
				ability = "unknown_or_attack"
			}
			typ := "unknown"
			if e.DamageType != nil {
				typ = fmt.Sprint(e.GetDamageType())
			}
			ap.Damage.ByAbility[ability] += int(e.GetValue())
			ap.Damage.ByTarget[short(target)] += int(e.GetValue())
			ap.Damage.ByType[typ] += int(e.GetValue())
		}
	case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_HEAL:
		if ap != nil && !e.GetIsAttackerIllusion() {
			v := int(e.GetValue())
			targetKey := short(target)
			if e.GetIsTargetIllusion() {
				targetKey = "illusion:" + targetKey
			}
			ap.Healing.ByTarget[targetKey] += v
			ability := inflictor
			if ability == "" || ability == "dota_unknown" {
				ability = "unknown"
			}
			ap.Healing.ByAbility[ability] += v
			if (e.GetTargetIsSelf() || attacker == target) && !e.GetIsTargetIllusion() {
				ap.Healing.Self += v
			} else if e.GetIsTargetHero() && !e.GetIsTargetIllusion() {
				ap.Healing.OtherHeroes += v
			} else {
				ap.Healing.Units += v
			}
		}
	case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_ABILITY, dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_ITEM:
		if ap != nil && !e.GetIsAttackerIllusion() && inflictor != "" && inflictor != "dota_unknown" {
			if e.GetType() == dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_ABILITY {
				ap.abilityEvents++
				if e.IsUltimateAbility != nil {
					ap.abilityFlags++
				}
			}
			if len(ap.Casts) < 5000 {
				ap.Casts = append(ap.Casts, castEvent{Min: round(min, 3), Ability: inflictor, Target: short(target), Ultimate: e.GetIsUltimateAbility(), Item: e.GetType() == dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_ITEM})
			} else {
				ap.DroppedEvents++
			}
		}
	case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_MODIFIER_REMOVE:
		if ap != nil && !e.GetIsAttackerIllusion() && e.GetIsTargetHero() && !e.GetIsTargetIllusion() && (e.GetStunDuration() > 0 || e.GetSlowDuration() > 0 || e.GetSilenceModifier() || e.GetRootModifier()) {
			if len(ap.Modifiers) < 2000 {
				ap.Modifiers = append(ap.Modifiers, modifierEvent{Min: round(min, 3), Target: short(target), Modifier: inflictor, Stun: e.StunDuration, Slow: e.SlowDuration, Elapsed: e.ModifierElapsedDuration, Silence: e.GetSilenceModifier(), Root: e.GetRootModifier()})
			} else {
				ap.DroppedEvents++
			}
		}
	case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_XP:
		if tp != nil {
			tp.xp += int(e.GetValue())
			tp.XPEvents++
		}
	case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_GOLD:
		if tp != nil {
			if len(tp.Gold) < 10000 {
				tp.Gold = append(tp.Gold, goldEvent{Min: round(min, 3), Value: int32(e.GetValue()), Reason: e.GoldReason})
			} else {
				tp.DroppedEvents++
			}
		}
	case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_BUYBACK:
		if p := bySlot[int(e.GetValue())]; p != nil {
			d := combatFor(p)
			d.Buybacks = append(d.Buybacks, point(e, min))
		}

	}
}
func sampleCombat(players map[string]*Player) {
	for _, p := range players {
		d := combatFor(p)
		d.XPByMinute = append(d.XPByMinute, d.xp)
		d.LastHitsByMinute = append(d.LastHitsByMinute, p.LastHits)
		d.DeniesByMinute = append(d.DeniesByMinute, p.Denies)
	}
}

func finalizeCombat(p *Player) {
	d := combatFor(p)
	d.Coverage.UltimateClassification = d.abilityEvents > 0 && d.abilityEvents == d.abilityFlags
	d.Coverage.XP = d.XPEvents > 0
	d.Coverage.DeathPositions = len(d.Deaths) > 0
	for _, e := range d.Deaths {
		if e.X == nil || e.Y == nil {
			d.Coverage.DeathPositions = false
		}
	}
}

// Bounded rolling window. Summaries include damage from units/illusions as
// observed; no owner or damage-before-mitigation is inferred.
type damageObservation struct {
	sec      float64
	attacker string
	ability  string
	value    int
}
type incomingDamage struct {
	WindowSeconds int            `json:"window_seconds"`
	Total         int            `json:"total"`
	ByAttacker    map[string]int `json:"by_attacker"`
	ByAbility     map[string]int `json:"by_ability"`
	Complete      bool           `json:"complete"`
}

func (d *CombatDetails) pruneIncoming(sec float64) {
	i := 0
	for i < len(d.recentDamage) && d.recentDamage[i].sec < sec-8 {
		i++
	}
	d.recentDamage = d.recentDamage[i:]
}
func (d *CombatDetails) recordIncoming(sec float64, attacker, ability string, value int) {
	d.pruneIncoming(sec)
	if len(d.recentDamage) >= 4096 {
		d.droppedDamageAt = d.recentDamage[0].sec
		d.recentDamage = d.recentDamage[1:]
		d.DroppedEvents++
	}
	if attacker == "" || attacker == "dota_unknown" {
		attacker = "unknown"
	}
	if ability == "" || ability == "dota_unknown" {
		ability = "unknown_or_attack"
	}
	d.recentDamage = append(d.recentDamage, damageObservation{sec, short(attacker), ability, value})
}
func (d *CombatDetails) deathIncoming(sec float64) *incomingDamage {
	d.pruneIncoming(sec)
	s := &incomingDamage{WindowSeconds: 8, ByAttacker: map[string]int{}, ByAbility: map[string]int{}, Complete: d.droppedDamageAt < sec-8}
	for _, v := range d.recentDamage {
		if v.sec > sec {
			continue
		}
		s.Total += v.value
		s.ByAttacker[v.attacker] += v.value
		s.ByAbility[v.ability] += v.value
	}
	d.recentDamage = nil
	d.droppedDamageAt = -1e30
	return s
}
