package main

import (
	"fmt"
	"github.com/dotabuff/manta"
	"github.com/dotabuff/manta/dota"
	"math"
	"strings"
)

type wardPlacement struct {
	hero    string
	team    string
	created float64
	point   combatPoint
	kind    string
}
type wardDeathObservation struct {
	event       wardEvent
	owner       string
	targetOwner string
}
type wardCollector struct {
	placements []wardPlacement
	deaths     []wardDeathObservation
	seen       int
	unresolved int
	identities map[string]bool
}

func normalizedHero(s string) string {
	return strings.ReplaceAll(strings.TrimPrefix(s, "npc_dota_hero_"), "_", "")
}
func wardTeam(n uint32) string {
	if n == 2 {
		return "radiant"
	}
	if n == 3 {
		return "dire"
	}
	return ""
}
func actualWardKind(s string) string {
	switch s {
	case "npc_dota_observer_wards":
		return "observer"
	case "npc_dota_sentry_wards":
		return "sentry"
	}
	return ""
}
func newWardCollector(p *manta.Parser, ended func() bool) *wardCollector {
	c := &wardCollector{identities: map[string]bool{}}
	p.OnEntity(func(e *manta.Entity, op manta.EntityOp) error {
		cn := e.GetClassName()
		if ended() || !op.Flag(manta.EntityOpCreated) || (cn != "CDOTA_NPC_Observer_Ward" && cn != "CDOTA_NPC_Observer_Ward_TrueSight") {
			return nil
		}
		id := fmt.Sprintf("%d:%d", e.GetIndex(), e.GetSerial())
		if c.identities[id] {
			return nil
		}
		c.identities[id] = true
		c.seen++
		created, ok := e.GetFloat32("m_flCreateTime")
		if !ok || math.IsNaN(float64(created)) || math.IsInf(float64(created), 0) {
			c.unresolved++
			return nil
		}
		h, ok := e.GetUint64("m_hOwnerEntity")
		if !ok {
			c.unresolved++
			return nil
		}
		owner := p.FindEntityByHandle(h)
		if owner == nil {
			c.unresolved++
			return nil
		}
		if owner.GetClassName() == "CDOTAPlayerController" {
			assigned, ok := owner.GetUint64("m_hAssignedHero")
			if !ok {
				c.unresolved++
				return nil
			}
			owner = p.FindEntityByHandle(assigned)
		}
		if owner == nil || !strings.HasPrefix(owner.GetClassName(), "CDOTA_Unit_Hero_") {
			c.unresolved++
			return nil
		}
		cx, a := e.GetUint32("CBodyComponent.m_cellX")
		cy, b := e.GetUint32("CBodyComponent.m_cellY")
		vx, d := e.GetFloat32("CBodyComponent.m_vecX")
		vy, f := e.GetFloat32("CBodyComponent.m_vecY")
		team, haveTeam := e.GetUint32("m_iTeamNum")
		if !a || !b || !d || !f || !haveTeam || wardTeam(team) == "" {
			c.unresolved++
			return nil
		}
		x, y := float32(float64(cx)*CellWidth+float64(vx)-CellOffset), float32(float64(cy)*CellWidth+float64(vy)-CellOffset)
		if math.IsNaN(float64(x)) || math.IsNaN(float64(y)) || math.IsInf(float64(x), 0) || math.IsInf(float64(y), 0) {
			c.unresolved++
			return nil
		}
		kind := "observer"
		if strings.HasSuffix(cn, "_TrueSight") {
			kind = "sentry"
		}
		c.placements = append(c.placements, wardPlacement{hero: classToHero(owner.GetClassName()), team: wardTeam(team), created: float64(created), point: combatPoint{X: &x, Y: &y, CoordinatesSource: "ward_entity"}, kind: kind})
		return nil
	})
	return c
}

// Lifetime expiry is a ward killing itself. It is not a player's deward.
// No raw hero-name fallback: explicit damage-source identity follows v7 ownership.
func (c *wardCollector) observeDeath(e *dota.CMsgDOTACombatLogEntry, min float64, name func(uint32) string) {
	if e.GetType() != dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_DEATH || math.IsNaN(min) || math.IsInf(min, 0) || min < 0 {
		return
	}
	target, attacker := name(e.GetTargetName()), name(e.GetAttackerName())
	kind := actualWardKind(target)
	if kind == "" || e.GetIsTargetIllusion() || attacker == target {
		return
	}
	event := wardEvent{combatPoint: point(e, min), Kind: kind, Event: "destroy", DestroyKind: "unknown", Attacker: attacker, SourceIllusion: e.GetIsAttackerIllusion()}
	if e.AttackerTeam != nil {
		event.AttackerTeam = wardTeam(e.GetAttackerTeam())
	}
	if e.TargetTeam != nil {
		event.TargetTeam = wardTeam(e.GetTargetTeam())
	}
	if event.AttackerTeam != "" && event.TargetTeam != "" {
		event.DestroyKind = "enemy_deward"
		if event.AttackerTeam == event.TargetTeam {
			event.DestroyKind = "allied_deny"
		}
	}
	owner, targetOwner := "", ""
	if e.DamageSourceName != nil {
		owner = name(e.GetDamageSourceName())
	}
	if e.TargetSourceName != nil {
		targetOwner = name(e.GetTargetSourceName())
	}
	c.deaths = append(c.deaths, wardDeathObservation{event, owner, targetOwner})
}
func uniqueWardHero(players []*Player, hero, team string) *Player {
	if !strings.HasPrefix(hero, "npc_dota_hero_") || team == "" {
		return nil
	}
	var found *Player
	for _, p := range players {
		if normalizedHero(p.Hero) == normalizedHero(hero) {
			if found != nil || p.Team != team {
				return nil
			}
			found = p
		}
	}
	return found
}
func (c *wardCollector) apply(players []*Player, start, end float64) []wardEvent {
	unowned := []wardEvent{}
	// Only prescribed ward counter is replaced; official KDA/APM and old non-ward fields untouched.
	for _, p := range players {
		p.WardsKilled = 0
		combatFor(p).Coverage.WardDestroySemantics = true
	}
	for _, o := range c.deaths {
		event := o.event
		owner := uniqueWardHero(players, o.owner, event.AttackerTeam)
		target := uniqueWardHero(players, o.targetOwner, event.TargetTeam)
		if target != nil {
			event.TargetOwnerHero = target.Hero
		}
		if owner != nil {
			event.AttackerHero = owner.Hero
			event.SourceControlled = event.SourceIllusion || normalizedHero(event.Attacker) != normalizedHero(owner.Hero)
			combatFor(owner).Wards = append(combatFor(owner).Wards, event)
			if event.DestroyKind == "enemy_deward" {
				owner.WardsKilled++
			}
		} else {
			unowned = append(unowned, event)
		}
	}
	for _, o := range c.placements {
		if start < 0 || (end > 0 && o.created > end) {
			continue
		}
		owner := uniqueWardHero(players, "npc_dota_hero_"+short(o.hero), o.team)
		if owner == nil {
			c.unresolved++
			continue
		}
		point := o.point
		point.Min = math.Round((o.created-start)/60*1000) / 1000
		combatFor(owner).Wards = append(combatFor(owner).Wards, wardEvent{combatPoint: point, Kind: o.kind, Event: "place"})
	}
	for _, p := range players {
		combatFor(p).Coverage.WardPlacements = c.seen > 0 && c.unresolved == 0
	}
	return unowned
}
