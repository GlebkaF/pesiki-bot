package main

import (
	"encoding/json"
	"fmt"
	"github.com/dotabuff/manta/dota"
	"testing"
)

func TestTimelineAttributionAndBoundaries(t *testing.T) {
	c := newCombatTimeline()
	names := map[uint32]string{1: "npc_dota_warlock_golem", 2: "npc_dota_hero_warlock", 3: "npc_dota_hero_pudge", 4: "warlock_golem_permanent_immolation", 5: "npc_dota_hero_antimage"}
	lookup := func(n uint32) string { return names[n] }
	e := &dota.CMsgDOTACombatLogEntry{Type: ptrCombat(dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_DAMAGE), AttackerName: ptrCombat(uint32(1)), DamageSourceName: ptrCombat(uint32(2)), TargetName: ptrCombat(uint32(3)), InflictorName: ptrCombat(uint32(4)), DamageType: ptrCombat(uint32(2)), IsTargetHero: ptrCombat(true), Value: ptrCombat(uint32(10))}
	c.observe(e, 1, lookup)
	c.observe(e, 1.99, lookup)
	c.observe(e, 2, lookup)
	e.AttackerName = ptrCombat(uint32(5))
	e.DamageSourceName = ptrCombat(uint32(5))
	e.IsAttackerIllusion = ptrCombat(true)
	c.observe(e, 2, lookup)
	e.IsTargetIllusion = ptrCombat(true)
	c.observe(e, 3, lookup)
	e.IsTargetIllusion = ptrCombat(false)
	e.DamageSourceName = nil
	c.observe(e, 3, lookup)
	e.Type = ptrCombat(dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_HEAL)
	e.IsAttackerIllusion = ptrCombat(false)
	c.observe(e, 3, lookup)
	out := c.finish([]*Player{{Hero: "pudge"}, {Hero: "warlock"}, {Hero: "antimage"}})
	if len(out.Damage) != 4 || len(out.Healing) != 1 || out.Coverage.DamageEvents != 5 || out.Coverage.HealingEvents != 1 {
		t.Fatalf("bad scope/counts: %+v", out.Coverage)
	}
	for _, r := range out.Damage {
		if r[3] != 0 {
			t.Fatal("target index does not follow actual roster order")
		}
		if r[0] == 1 && (r[2] != 1 || r[7] != 20) {
			t.Fatal("explicit controlled owner or one-second aggregation lost")
		}
		if r[0] == 3 && r[2] != -1 {
			t.Fatal("missing owner cannot be inferred from hero attacker name")
		}
	}
	if out.Healing[0][5] != -1 {
		t.Fatal("healing must not inherit damage type")
	}
	foundIllusion := false
	for _, r := range out.Damage {
		if r[6]&1 != 0 {
			foundIllusion = true
		}
	}
	if !foundIllusion {
		t.Fatal("attacker illusion provenance lost")
	}
	a, _ := json.Marshal(out)
	b, _ := json.Marshal(c.finish([]*Player{{Hero: "pudge"}, {Hero: "warlock"}, {Hero: "antimage"}}))
	if string(a) != string(b) {
		t.Fatal("timeline finalization is not deterministic")
	}
}
func TestTimelineUnknownTargetsAndZero(t *testing.T) {
	c := newCombatTimeline()
	c.buckets[timelineKey{second: 2, target: "not_in_roster"}] = timelineValue{amount: 7, events: 1}
	c.buckets[timelineKey{second: 3, target: "npc_dota_hero_pudge", source: "unknown", ability: "unknown"}] = timelineValue{amount: 0, events: 1}
	c.damageEvents = 2
	a := c.finish([]*Player{{Hero: "pudge"}})
	b := c.finish([]*Player{{Hero: "pudge"}})
	if a.Coverage.DroppedEvents != 1 || b.Coverage.DroppedEvents != 1 || a.Coverage.CompleteUntilSecond == nil || *a.Coverage.CompleteUntilSecond != 2 {
		t.Fatal("unresolved target must be counted once and break completeness")
	}
	if len(a.Damage) != 1 || a.Damage[0][7] != 0 || a.Coverage.StoredDamageEvents != 1 {
		t.Fatal("measured zero vanished")
	}
}
func TestTimelineHardByteBudgetAndPrefix(t *testing.T) {
	c := newCombatTimeline()
	const events = maxTimelineBuckets / 2
	for i := 0; i < events; i++ {
		c.buckets[timelineKey{second: i, target: "npc_dota_hero_pudge", source: "npc_dota_hero_pudge", owner: "npc_dota_hero_pudge", ability: fmt.Sprintf("ability_%05d", i), damageType: 2}] = timelineValue{amount: 100, events: 1}
	}
	c.damageEvents = events
	out := c.finish([]*Player{{Hero: "pudge"}})
	data, _ := json.Marshal(out)
	if len(data) > maxTimelineJSONBytes || !out.Coverage.Truncated || out.Coverage.DroppedEvents == 0 {
		t.Fatalf("byte budget/truncation failed: %d %+v", len(data), out.Coverage)
	}
	if out.Coverage.StoredDamageEvents+out.Coverage.DroppedEvents != events {
		t.Fatal("event accounting does not reconcile")
	}
	if out.Coverage.CompleteUntilSecond == nil || int(out.Damage[len(out.Damage)-1][0]) >= *out.Coverage.CompleteUntilSecond {
		t.Fatal("complete chronological prefix is incorrect")
	}
}
func TestTimelineCounterRowBudget(t *testing.T) {
	c := newCombatTimeline()
	e := &dota.CMsgDOTACombatLogEntry{Type: ptrCombat(dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_DAMAGE), IsTargetHero: ptrCombat(true), Value: ptrCombat(uint32(1))}
	name := func(uint32) string { return "npc_dota_hero_pudge" }
	for i := 0; i < maxTimelineBuckets+1; i++ {
		c.observe(e, float64(i), name)
	}
	if len(c.buckets) != maxTimelineBuckets || c.droppedEvents != 1 || c.firstIncomplete == nil || *c.firstIncomplete != maxTimelineBuckets {
		t.Fatal("streaming aggregate memory bound not enforced")
	}
}

func TestTimelineOrdinaryLongMatchRetainsLateEvents(t *testing.T) {
	c := newCombatTimeline()
	const events = 14000
	for i := 0; i < events; i++ {
		c.buckets[timelineKey{second: i, target: "npc_dota_hero_pudge", source: "npc_dota_hero_pudge", owner: "npc_dota_hero_pudge", ability: "attack", damageType: 1}] = timelineValue{amount: 100, events: 1}
	}
	c.damageEvents = events
	out := c.finish([]*Player{{Hero: "pudge"}})
	data, _ := json.Marshal(out)
	if len(data) <= 200*1024 || len(data) > maxTimelineJSONBytes || out.Coverage.Truncated || out.Coverage.DroppedEvents != 0 || out.Coverage.CompleteUntilSecond != nil || len(out.Damage) != events {
		t.Fatalf("ordinary long match unnecessarily truncated: bytes=%d coverage=%+v", len(data), out.Coverage)
	}
	if out.Damage[len(out.Damage)-1][0] != events-1 || out.Coverage.ByteLimit != 1024*1024 || out.Coverage.RowLimit != 65536 {
		t.Fatal("late event or advertised budget lost")
	}
}
