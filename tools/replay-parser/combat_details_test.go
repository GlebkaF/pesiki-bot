package main

import (
	"github.com/dotabuff/manta/dota"
	"testing"
)

func ptrCombat[T any](v T) *T { return &v }
func TestCombatHealingAndDamage(t *testing.T) {
	players := map[string]*Player{}
	a := "npc_dota_hero_crystal_maiden"
	b := "npc_dota_hero_pudge"
	e := &dota.CMsgDOTACombatLogEntry{Type: ptrCombat(dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_HEAL), Value: ptrCombat(uint32(100)), IsTargetHero: ptrCombat(true)}
	collectCombat(e, 1, a, a, "", players, nil)
	collectCombat(e, 2, a, b, "", players, nil)
	e.IsTargetIllusion = ptrCombat(true)
	collectCombat(e, 3, a, b, "", players, nil)
	collectCombat(e, 3, a, a, "", players, nil)
	d := combatFor(players[a])
	if d.Healing.ByTarget["pudge"] != 100 || d.Healing.ByTarget["illusion:pudge"] != 100 || d.Healing.ByTarget["crystal_maiden"] != 100 || d.Healing.ByTarget["illusion:crystal_maiden"] != 100 || !d.Coverage.HealingTargetIdentity {
		t.Fatal("healing recipients conflate real heroes and same-name illusions")
	}
	if d.Healing.Self != 100 || d.Healing.OtherHeroes != 100 || d.Healing.Units != 200 {
		t.Fatalf("wrong healing partitions: %+v", d.Healing)
	}
	e.Type = ptrCombat(dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_DAMAGE)
	collectCombat(e, 4, a, b, "test", players, nil)
	if len(d.Damage.ByAbility) != 0 {
		t.Fatal("illusion target counted as real hero damage")
	}
	e.IsTargetIllusion = ptrCombat(false)
	collectCombat(e, 5, a, b, "test", players, nil)
	if d.Damage.ByAbility["test"] != 100 || d.Damage.ByTarget["pudge"] != 100 || d.Damage.ByType["unknown"] != 100 {
		t.Fatal("damage partitions disagree")
	}
}
func TestCombatMissingFieldsRemainUnavailable(t *testing.T) {
	players := map[string]*Player{}
	a := "npc_dota_hero_crystal_maiden"
	e := &dota.CMsgDOTACombatLogEntry{Type: ptrCombat(dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_ABILITY)}
	collectCombat(e, 1, a, "", "crystal_maiden_freezing_field", players, nil)
	p := players[a]
	finalizeCombat(p)
	if p.CombatDetails.Coverage.UltimateClassification {
		t.Fatal("missing ultimate flag cannot imply zero ultimate casts")
	}
	if point(e, 1).X != nil {
		t.Fatal("missing location cannot become origin")
	}
	e.LocationX = ptrCombat(float32(0))
	e.LocationY = ptrCombat(float32(0))
	if point(e, 1).X == nil {
		t.Fatal("explicit zero is a valid coordinate")
	}
	e.Type = ptrCombat(dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_XP)
	e.Value = ptrCombat(uint32(50))
	collectCombat(e, 1, "", a, "", players, nil)
	p.LastHits = 4
	p.Denies = 2
	sampleCombat(players)
	finalizeCombat(p)
	if !p.CombatDetails.Coverage.XP || p.CombatDetails.XPByMinute[0] != 50 || p.CombatDetails.LastHitsByMinute[0] != 4 || p.CombatDetails.DeniesByMinute[0] != 2 {
		t.Fatal("minute samples mismatch")
	}
}
func TestCombatSignedGoldAndBoundedLogs(t *testing.T) {
	players := map[string]*Player{}
	a := "npc_dota_hero_pudge"
	e := &dota.CMsgDOTACombatLogEntry{Type: ptrCombat(dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_GOLD), Value: ptrCombat(uint32(0xffffff9c))}
	collectCombat(e, 1, "", a, "", players, nil)
	d := players[a].CombatDetails
	if d.Gold[0].Value != -100 {
		t.Fatal("signed gold loss converted into billions")
	}
	e.Type = ptrCombat(dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_ABILITY)
	for i := 0; i < 5001; i++ {
		collectCombat(e, 1, a, "", "spell", players, nil)
	}
	if len(d.Casts) != 5000 || d.DroppedEvents != 1 {
		t.Fatal("cast log is unbounded or truncation hidden")
	}
}

func TestDeathIncomingWindowAndLifeBoundary(t *testing.T) {
	p := &Player{}
	d := combatFor(p)
	d.recordIncoming(1, "npc_dota_hero_pudge", "pudge_rot", 10)
	d.recordIncoming(2, "npc_dota_creep", "", 20)
	d.recordIncoming(10, "npc_dota_hero_pudge", "pudge_rot", 30)
	s := d.deathIncoming(10)
	if s.Total != 50 || s.ByAttacker["npc_dota_creep"] != 20 || s.ByAbility["pudge_rot"] != 30 || !s.Complete {
		t.Fatalf("wrong last-eight-second window: %+v", s)
	}
	d.recordIncoming(11, "npc_dota_hero_pudge", "pudge_rot", 5)
	if d.deathIncoming(12).Total != 5 {
		t.Fatal("damage from previous life leaked across deaths")
	}
	for i := 0; i < 4097; i++ {
		d.recordIncoming(20, "npc_dota_creep", "", 1)
	}
	s = d.deathIncoming(21)
	if s.Complete || s.Total != 4096 {
		t.Fatal("rolling buffer truncation must be explicit")
	}
}
