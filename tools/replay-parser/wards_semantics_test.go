package main

import (
	"github.com/dotabuff/manta/dota"
	"reflect"
	"testing"
)

func wardPtr[T any](v T) *T { return &v }
func TestWardDestroySemantics(t *testing.T) {
	names := map[uint32]string{1: "npc_dota_hero_nevermore", 2: "npc_dota_observer_wards", 3: "npc_dota_hero_rubick", 4: "npc_dota_clinkz_skeleton_archer", 5: "npc_dota_hero_clinkz", 6: "npc_dota_hero_treant", 7: "npc_dota_creep_badguys_melee", 8: "npc_dota_sentry_wards", 9: "npc_dota_pugna_nether_ward"}
	name := func(i uint32) string { return names[i] }
	makeDeath := func(attacker, owner, targetOwner, team, targetTeam uint32) *dota.CMsgDOTACombatLogEntry {
		return &dota.CMsgDOTACombatLogEntry{Type: wardPtr(dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_DEATH), AttackerName: wardPtr(attacker), TargetName: wardPtr(uint32(2)), DamageSourceName: wardPtr(owner), TargetSourceName: wardPtr(targetOwner), AttackerTeam: wardPtr(team), TargetTeam: wardPtr(targetTeam)}
	}
	players := []*Player{{Hero: "nevermore", Team: "radiant", Kills: 5, Deaths: 4, Assists: 3, WardsKilled: 99}, {Hero: "rubick", Team: "radiant"}, {Hero: "clinkz", Team: "dire"}, {Hero: "treant", Team: "radiant"}}
	c := &wardCollector{}
	ownDeny := makeDeath(1, 1, 3, 2, 2)
	ownDeny.TargetIsSelf = wardPtr(true)
	c.observeDeath(ownDeny, 7.3, name)                // owner-self marker cannot turn a hero attack into ward expiry
	c.observeDeath(makeDeath(4, 5, 6, 3, 2), 8, name) // explicitly owned skeleton
	c.observeDeath(makeDeath(7, 7, 6, 3, 2), 9, name) // actual creep: no fabricated owner
	expiry := makeDeath(2, 3, 3, 2, 2)
	expiry.TargetIsSelf = wardPtr(true)
	c.observeDeath(expiry, 10, name)
	other := makeDeath(1, 1, 3, 2, 3)
	other.TargetName = wardPtr(uint32(9))
	c.observeDeath(other, 10, name)
	illusion := makeDeath(5, 5, 6, 3, 2)
	illusion.IsAttackerIllusion = wardPtr(true)
	c.observeDeath(illusion, 11, name)
	unknown := makeDeath(1, 1, 3, 2, 3)
	unknown.DamageSourceName = nil
	unknown.AttackerTeam = nil
	c.observeDeath(unknown, 12, name)
	unowned := c.apply(players, 100, 1000)
	if len(unowned) != 2 || unowned[0].AttackerHero != "" || unowned[0].Attacker != names[7] || unowned[1].DestroyKind != "unknown" {
		t.Fatalf("unowned: %+v", unowned)
	}
	sf := players[0]
	if sf.WardsKilled != 0 || len(sf.CombatDetails.Wards) != 1 || sf.CombatDetails.Wards[0].DestroyKind != "allied_deny" {
		t.Fatalf("deny attributed as deward: %+v", sf.CombatDetails.Wards)
	}
	clinkz := players[2]
	if clinkz.WardsKilled != 2 || len(clinkz.CombatDetails.Wards) != 2 {
		t.Fatal("controlled dewards missing")
	}
	for _, e := range clinkz.CombatDetails.Wards {
		if !e.SourceControlled || e.AttackerHero != "clinkz" || e.TargetOwnerHero != "treant" {
			t.Fatalf("invalid ownership: %+v", e)
		}
	}
	if !clinkz.CombatDetails.Wards[1].SourceIllusion {
		t.Fatal("illusion flag lost")
	}
	if !reflect.DeepEqual([]int{sf.Kills, sf.Deaths, sf.Assists}, []int{5, 4, 3}) {
		t.Fatal("KDA modified")
	}
	for _, p := range players {
		if !p.CombatDetails.Coverage.WardDestroySemantics {
			t.Fatal("missing semantic coverage")
		}
	}
}
func TestWardOwnerMustBeUniqueAndTeamConsistent(t *testing.T) {
	players := []*Player{{Hero: "clinkz", Team: "radiant"}}
	if uniqueWardHero(players, "npc_dota_hero_clinkz", "dire") != nil || uniqueWardHero(players, "npc_dota_hero_clinkz", "") != nil || uniqueWardHero(players, "clinkz", "radiant") != nil {
		t.Fatal("unverified owner accepted")
	}
	players = append(players, &Player{Hero: "clinkz", Team: "radiant"})
	if uniqueWardHero(players, "npc_dota_hero_clinkz", "radiant") != nil {
		t.Fatal("ambiguous owner")
	}
}
func TestWardPreHornCreationAndCoordinatePreservation(t *testing.T) {
	x, y := float32(-534), float32(-283.53125)
	p := &Player{Hero: "crystal_maiden", Team: "dire"}
	c := &wardCollector{seen: 2, placements: []wardPlacement{{hero: "crystal_maiden", team: "dire", created: 135, kind: "sentry", point: combatPoint{X: &x, Y: &y, CoordinatesSource: "ward_entity"}}, {hero: "crystal_maiden", team: "dire", created: 3000, kind: "observer"}}}
	c.apply([]*Player{p}, 163, 2126)
	if len(p.CombatDetails.Wards) != 1 {
		t.Fatal("postgame event accepted")
	}
	e := p.CombatDetails.Wards[0]
	if e.Min != -0.467 || e.X == nil || *e.X != x || e.Y == nil || *e.Y != y {
		t.Fatalf("pregame placement lost: %+v", e)
	}
}

func TestHeroAndAbilityWardsAreNotVisionWards(t *testing.T) {
	for _, name := range []string{"npc_dota_hero_arc_warden", "npc_dota_venomancer_plague_ward_4", "npc_dota_witch_doctor_death_ward", "npc_dota_juggernaut_healing_ward", "npc_dota_pugna_nether_ward"} {
		if actualWardKind(name) != "" {
			t.Fatalf("not a vision ward: %s", name)
		}
	}
	if actualWardKind("npc_dota_observer_wards") != "observer" || actualWardKind("npc_dota_sentry_wards") != "sentry" {
		t.Fatal("real vision wards missing")
	}
}
