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
