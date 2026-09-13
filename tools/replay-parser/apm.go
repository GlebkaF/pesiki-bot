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
	orders     map[string]map[string]int
	seen       bool
	unresolved bool
}

func newAPMCounter(p *manta.Parser, active func() bool) *apmCounter {
	c := &apmCounter{counts: map[string]int{}, orders: map[string]map[string]int{}}
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
		key := "npc_dota_hero_" + classToHero(hero.GetClassName())
		c.counts[key]++
		if c.orders[key] == nil {
			c.orders[key] = map[string]int{}
		}
		c.orders[key][dota.DotaunitorderT(m.GetOrderType()).String()]++
		return nil
	})
	return c
}
func (c *apmCounter) apply(out *Output, players map[string]*Player, duration float64) {
	if !c.seen || c.unresolved || duration <= 0 {
		return
	}
	// Entity classes use AntiMage/QueenOfPain, demo metadata uses antimage/queenofpain.
	// Resolve punctuation differences against the actual roster; never guess a slot.
	normalized := map[string]*Player{}
	for hero, player := range players {
		if player.Team == "" {
			continue
		}
		key := strings.ReplaceAll(hero, "_", "")
		if normalized[key] != nil {
			return
		}
		normalized[key] = player
	}
	counts := map[*Player]int{}
	orders := map[*Player]map[string]int{}
	for hero, count := range c.counts {
		player := normalized[strings.ReplaceAll(hero, "_", "")]
		if player == nil {
			return
		}
		counts[player] += count
		if c.orders != nil {
			if orders[player] == nil {
				orders[player] = map[string]int{}
			}
			for kind, n := range c.orders[hero] {
				orders[player][kind] += n
			}
		}
	}
	out.APMVersion, out.APMDuration = apmVersion, duration
	for _, player := range players {
		if player.Team == "" {
			continue
		}
		actions := counts[player]
		apm := int(math.Floor(float64(actions) * 60 / duration))
		player.Actions, player.APM = &actions, &apm
		if c.orders != nil {
			player.ActionCounts = orders[player]
			if player.ActionCounts == nil {
				player.ActionCounts = map[string]int{}
			}
		}
	}
}
