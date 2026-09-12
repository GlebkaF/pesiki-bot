package main

import (
	"github.com/dotabuff/manta"
	"github.com/dotabuff/manta/dota"
	"math"
	"strings"
)

// One spectator order message is one action, independent of units selected.
// Includes repeated orders. Counts only between combat-log game states 5 and 6.
// This is our versioned definition, not a promise of OpenDota parity.
const apmVersion = "spectator-orders-v1"

type apmCounter struct {
	counts     map[string]int
	seen       bool
	unresolved bool
}

func newAPMCounter(p *manta.Parser, active func() bool) *apmCounter {
	c := &apmCounter{counts: map[string]int{}}
	p.Callbacks.OnCDOTAUserMsg_SpectatorPlayerUnitOrders(func(m *dota.CDOTAUserMsg_SpectatorPlayerUnitOrders) error {
		if !active() {
			return nil
		}
		c.seen = true
		// Entindex is the controller, NOT a player slot. Resolve its assigned hero.
		controller := p.FindEntity(m.GetEntindex())
		if controller == nil || controller.GetClassName() != "CDOTAPlayerController" {
			c.unresolved = true
			return nil
		}
		handle, ok := controller.GetUint64("m_hAssignedHero")
		if !ok {
			c.unresolved = true
			return nil
		}
		hero := p.FindEntityByHandle(handle)
		if hero == nil || !strings.HasPrefix(hero.GetClassName(), "CDOTA_Unit_Hero_") {
			c.unresolved = true
			return nil
		}
		c.counts["npc_dota_hero_"+classToHero(hero.GetClassName())]++
		return nil
	})
	return c
}
func (c *apmCounter) apply(out *Output, players map[string]*Player, duration float64) {
	if !c.seen || c.unresolved || duration <= 0 {
		return
	}
	// Unknown hero aliases must not silently become somebody else's zero APM.
	for hero := range c.counts {
		if players[hero] == nil || players[hero].Team == "" {
			return
		}
	}
	out.APMVersion, out.APMDuration = apmVersion, duration
	for hero, player := range players {
		if player.Team == "" {
			continue
		}
		actions := c.counts[hero]
		apm := int(math.Floor(float64(actions) * 60 / duration))
		player.Actions, player.APM = &actions, &apm
	}
}
