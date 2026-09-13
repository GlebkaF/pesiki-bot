package main

import (
	"github.com/dotabuff/manta"
	"strings"
)

type wardCollector struct {
	events     map[string][]wardEvent
	seen       int
	unresolved int
}

func normalizedHero(s string) string {
	return strings.ReplaceAll(strings.TrimPrefix(s, "npc_dota_hero_"), "_", "")
}
func newWardCollector(p *manta.Parser, active func() bool, minute func() float64) *wardCollector {
	c := &wardCollector{events: map[string][]wardEvent{}}
	p.OnEntity(func(e *manta.Entity, op manta.EntityOp) error {
		cn := e.GetClassName()
		if !active() || !op.Flag(manta.EntityOpCreated) || (cn != "CDOTA_NPC_Observer_Ward" && cn != "CDOTA_NPC_Observer_Ward_TrueSight") {
			return nil
		}
		c.seen++
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
		cx, okX := e.GetUint32("CBodyComponent.m_cellX")
		cy, okY := e.GetUint32("CBodyComponent.m_cellY")
		vx, okVX := e.GetFloat32("CBodyComponent.m_vecX")
		vy, okVY := e.GetFloat32("CBodyComponent.m_vecY")
		if !okX || !okY || !okVX || !okVY {
			c.unresolved++
			return nil
		}
		x, y := float32(float64(cx)*CellWidth+float64(vx)-CellOffset), float32(float64(cy)*CellWidth+float64(vy)-CellOffset)
		kind := "observer"
		if strings.HasSuffix(cn, "_TrueSight") {
			kind = "sentry"
		}
		key := normalizedHero(classToHero(owner.GetClassName()))
		c.events[key] = append(c.events[key], wardEvent{combatPoint: combatPoint{Min: round(minute(), 3), X: &x, Y: &y, CoordinatesSource: "ward_entity"}, Kind: kind, Event: "place"})
		return nil
	})
	return c
}
func (c *wardCollector) apply(players []*Player) {
	for _, p := range players {
		d := combatFor(p)
		d.Wards = append(d.Wards, c.events[normalizedHero(p.Hero)]...)
		d.Coverage.WardPlacements = c.seen > 0 && c.unresolved == 0
	}
}
