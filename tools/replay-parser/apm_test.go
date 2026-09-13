package main

import (
	"testing"
)

func TestAPMDefinition(t *testing.T) {
	players := map[string]*Player{"npc_dota_hero_pudge": {Team: "dire"}, "npc_dota_hero_invoker": {Team: "radiant"}}
	c := &apmCounter{seen: true, counts: map[string]int{"npc_dota_hero_pudge": 2184}}
	out := &Output{}
	c.apply(out, players, 1064.9333953857422)
	if out.APMVersion != apmVersion || *players["npc_dota_hero_pudge"].APM != 123 {
		t.Fatal("APM must use exact duration, floor once")
	}
	if *players["npc_dota_hero_invoker"].APM != 0 {
		t.Fatal("zero actions is a valid measurement")
	}
}
func TestAPMUnavailable(t *testing.T) {
	for _, c := range []*apmCounter{
		{counts: map[string]int{}},
		{seen: true, unresolved: true, counts: map[string]int{}},
		{seen: true, counts: map[string]int{"unknown_alias": 5}},
	} {
		out := &Output{}
		c.apply(out, map[string]*Player{}, 100)
		if out.APMVersion != "" {
			t.Fatal("missing or unresolved stream must not look like zero APM")
		}
	}
}

func TestAPMRosterSpelling(t *testing.T) {
	players := map[string]*Player{"npc_dota_hero_antimage": {Team: "dire"}, "npc_dota_hero_queenofpain": {Team: "radiant"}}
	c := &apmCounter{seen: true, counts: map[string]int{"npc_dota_hero_anti_mage": 200, "npc_dota_hero_queen_of_pain": 300}}
	out := &Output{}
	c.apply(out, players, 60)
	if out.APMVersion == "" || *players["npc_dota_hero_antimage"].APM != 200 || *players["npc_dota_hero_queenofpain"].APM != 300 {
		t.Fatal("class spelling must resolve to metadata roster")
	}
}

func TestActionBreakdownFollowsRoster(t *testing.T) {
	players := map[string]*Player{"npc_dota_hero_antimage": {Team: "dire"}, "npc_dota_hero_pudge": {Team: "radiant"}}
	c := &apmCounter{seen: true, counts: map[string]int{"npc_dota_hero_anti_mage": 7}, orders: map[string]map[string]int{
		"npc_dota_hero_anti_mage": {"DOTA_UNIT_ORDER_MOVE_TO_POSITION": 5, "DOTA_UNIT_ORDER_CAST_NO_TARGET": 2},
	}}
	out := &Output{}
	c.apply(out, players, 60)
	p := players["npc_dota_hero_antimage"]
	if p.ActionCounts["DOTA_UNIT_ORDER_MOVE_TO_POSITION"] != 5 || p.ActionCounts["DOTA_UNIT_ORDER_CAST_NO_TARGET"] != 2 || *p.Actions != 7 || *p.APM != 7 {
		t.Fatal("breakdown must preserve types and total across hero aliases")
	}
	if players["npc_dota_hero_pudge"].ActionCounts == nil || len(players["npc_dota_hero_pudge"].ActionCounts) != 0 {
		t.Fatal("measured zero is an empty map; unavailable is nil")
	}
}
