package main

import (
	"math"
	"strings"
	"testing"
)

func testLifetimeCollector() *wardLifetimeCollector {
	c := &wardLifetimeCollector{interval: 1.0 / 30, nativeTimes: map[uint32]float64{}, haveSample: true}
	for tick := uint32(0); tick <= 6000; tick++ {
		c.nativeTimes[tick] = float64(float32(tick) * float32(c.interval))
	}
	return c
}
func testLifetimeObservation(index, serial int32, tick uint32) wardLifetimeObservation {
	return wardLifetimeObservation{index: index, serial: serial, tick: tick, kind: "observer", team: "radiant", owner: "npc_dota_hero_warlock", created: true, createdAt: lifetimePtr(float32(100)), life: lifetimePtr(uint32(0)), position: &wardLifetimePosition{10, 20, "ward_entity"}}
}
func testLifetimePlayers() []*Player {
	return []*Player{{Hero: "warlock", Team: "radiant", SteamID: 76561198054280368}, {Hero: "clinkz", Team: "dire", SteamID: 76561198000000001}}
}
func testLifetimeDied(c *wardLifetimeCollector, index int32) {
	o := testLifetimeObservation(index, 1, 3004)
	o.created = false
	o.life = lifetimePtr(uint32(1))
	o.lastDamage = lifetimePtr(float32(100.1))
	c.observeEntity(o)
}
func testLifetimeKill() wardLifetimeDeath {
	return wardLifetimeDeath{ts: float32(100.1), kind: "observer", targetOwner: "npc_dota_hero_warlock", targetTeam: "radiant", attacker: "npc_dota_clinkz_skeleton_archer", owner: "npc_dota_hero_clinkz", attackerTeam: "dire"}
}
func TestWardLifetimeNativeObservationAndSafeKiller(t *testing.T) {
	c := testLifetimeCollector()
	c.observeEntity(testLifetimeObservation(1, 1, 3000))
	c.confirmPacket(3002)
	testLifetimeDied(c, 1)
	// Entity deletion is later than death and must remain a separate fact.
	o := testLifetimeObservation(1, 1, 3300)
	o.created = false
	o.deleted = true
	o.left = true
	o.life = lifetimePtr(uint32(2))
	c.observeEntity(o)
	c.deaths = []wardLifetimeDeath{testLifetimeKill()}
	c.end(200)
	out := c.finish(testLifetimePlayers(), 110)
	if len(out.Entries) != 1 {
		t.Fatal(out)
	}
	e := out.Entries[0]
	if e.PlacedSeconds == nil || *e.PlacedSeconds != -10 || e.DeathObservedSeconds == nil || e.DeletedObservedSeconds == nil || *e.DeletedObservedSeconds <= *e.DeathObservedSeconds {
		t.Fatalf("native times: %+v", e)
	}
	if e.DeathObservationWindow == nil || e.DeathObservationWindow.To <= e.DeathObservationWindow.From || e.DeathObservationWindow.To-e.DeathObservationWindow.From > .068 {
		t.Fatal("invalid observed bracket")
	}
	// This kill is before the requested match start, so it cannot leak into the match's kill attribution.
	if e.Killer != nil {
		t.Fatal("pre-horn kill matched unexpectedly")
	}
	out = c.finish(testLifetimePlayers(), 0)
	e = out.Entries[0]
	if e.Killer == nil || e.Killer.Source != "unique-last-damage-match" || e.Killer.AttackerHero == nil || *e.Killer.AttackerHero != "clinkz" || !e.Killer.SourceControlled {
		t.Fatalf("lost controlled kill: %+v", e.Killer)
	}
	if e.AliveAtEnd == nil || *e.AliveAtEnd || !e.ObservationComplete || e.LeftObservedSeconds != nil {
		t.Fatal("deleted+left must not imply a transmission gap when explicit death is known")
	}
}
func TestWardLifetimeAmbiguousJoinRejected(t *testing.T) {
	for _, duplicateWard := range []bool{true, false} {
		c := testLifetimeCollector()
		c.observeEntity(testLifetimeObservation(1, 1, 3000))
		if duplicateWard {
			c.observeEntity(testLifetimeObservation(2, 1, 3000))
		}
		c.confirmPacket(3002)
		testLifetimeDied(c, 1)
		if duplicateWard {
			testLifetimeDied(c, 2)
		}
		c.deaths = []wardLifetimeDeath{testLifetimeKill()}
		if !duplicateWard {
			c.deaths = append(c.deaths, testLifetimeKill())
		}
		c.end(200)
		out := c.finish(testLifetimePlayers(), 0)
		if out.Coverage.KillerMatched != 0 || out.Coverage.AmbiguousKillerMatches == 0 {
			t.Fatal("ambiguous association accepted")
		}
	}
}
func TestWardLifetimeJoinRejectsWeakEvidence(t *testing.T) {
	for _, kind := range []string{"time", "owner", "team", "zero-damage", "gap"} {
		c := testLifetimeCollector()
		c.observeEntity(testLifetimeObservation(1, 1, 3000))
		c.confirmPacket(3002)
		testLifetimeDied(c, 1)
		d := testLifetimeKill()
		switch kind {
		case "time":
			d.ts = math.Nextafter32(d.ts, float32(math.Inf(1)))
		case "owner":
			d.targetOwner = "npc_dota_hero_other"
		case "team":
			d.targetTeam = "dire"
		case "zero-damage":
			c.states[0].deathLastDamage = lifetimePtr(float32(0))
		case "gap":
			c.states[0].complete = false
		}
		c.deaths = []wardLifetimeDeath{d}
		c.end(200)
		if c.finish(testLifetimePlayers(), 0).Coverage.KillerMatched != 0 {
			t.Fatal("weak match accepted:", kind)
		}
	}
}
func TestWardLifetimeEndFreezeMissingEndAndLeft(t *testing.T) {
	c := testLifetimeCollector()
	c.observeEntity(testLifetimeObservation(1, 1, 3000))
	c.confirmPacket(3002)
	if c.finish(testLifetimePlayers(), 0).Entries[0].AliveAtEnd != nil {
		t.Fatal("missing end invented")
	}
	c.end(c.clock(3002))
	testLifetimeDied(c, 1)
	c.confirmPacket(6000)
	e := c.finish(testLifetimePlayers(), 0).Entries[0]
	if e.DeathObservedSeconds != nil || e.AliveAtEnd == nil || !*e.AliveAtEnd || e.LastObservedSeconds > 101 {
		t.Fatal("postgame cleanup leaked")
	}
	c = testLifetimeCollector()
	o := testLifetimeObservation(1, 1, 3000)
	c.observeEntity(o)
	o.tick = 3002
	o.created = false
	o.left = true
	c.observeEntity(o)
	o.tick = 3004
	o.left = false
	c.observeEntity(o)
	c.end(200)
	e = c.finish(testLifetimePlayers(), 0).Entries[0]
	if e.ObservationComplete || e.LeftObservedSeconds == nil || e.AliveAtEnd != nil {
		t.Fatal("left/reentered interval declared continuous")
	}
}
func TestWardLifetimeReuseOutOfOrderAndMovement(t *testing.T) {
	c := testLifetimeCollector()
	o := testLifetimeObservation(1, 1, 3000)
	c.observeEntity(o)
	o.created = false
	o.tick = 3002
	o.deleted = true
	c.observeEntity(o)
	o = testLifetimeObservation(1, 1, 3300)
	o.createdAt = lifetimePtr(float32(110))
	c.observeEntity(o)
	o.created = false
	o.tick = 3302
	o.position = &wardLifetimePosition{11, 20, "ward_entity"}
	c.observeEntity(o)
	c.end(200)
	out := c.finish(testLifetimePlayers(), 0)
	if len(out.Entries) != 2 || out.Entries[0].ID == out.Entries[1].ID || !strings.HasSuffix(out.Entries[1].ID, ":2") || !out.Entries[1].PositionMoved || out.Entries[1].Position.X != 10 {
		t.Fatal("entity reuse or movement lost")
	}
	c = testLifetimeCollector()
	o = testLifetimeObservation(1, 1, 3000)
	c.observeEntity(o)
	o.created = false
	o.tick = 2999
	c.observeEntity(o)
	c.end(200)
	if c.finish(testLifetimePlayers(), 0).Entries[0].ObservationComplete {
		t.Fatal("out of order accepted")
	}
}
func TestWardLifetimeCapsAndUnknownCreation(t *testing.T) {
	c := testLifetimeCollector()
	for i := 0; i < maxWardLifetimes+1; i++ {
		c.observeEntity(testLifetimeObservation(int32(i), 1, 3000))
	}
	o := testLifetimeObservation(maxWardLifetimes, 1, 3002)
	o.created = false
	for i := 0; i < 5; i++ {
		c.observeEntity(o)
	}
	c.end(200)
	out := c.finish(testLifetimePlayers(), 0)
	if len(out.Entries) != maxWardLifetimes || out.Coverage.DroppedEntities != 1 || out.Coverage.EntitiesSeen != maxWardLifetimes+1 || !out.Coverage.Truncated {
		t.Fatal("cap/drop accounting wrong")
	}
	c = testLifetimeCollector()
	o = testLifetimeObservation(1, 1, 3000)
	o.createdAt = nil
	c.observeEntity(o)
	c.end(200)
	e := c.finish(testLifetimePlayers(), 0).Entries[0]
	if e.PlacedSeconds != nil || e.ObservationComplete || e.AliveAtEnd != nil {
		t.Fatal("unknown creation became complete")
	}
	c.interval = 0
	if len(c.finish(testLifetimePlayers(), 0).Entries) != 0 {
		t.Fatal("missing clock fabricated times")
	}
}

func TestWardLifetimeMissingFinalPacketStaysUnknown(t *testing.T) {
	c := testLifetimeCollector()
	c.observeEntity(testLifetimeObservation(1, 1, 3000))
	c.confirmPacket(3002)
	c.end(200)
	e := c.finish(testLifetimePlayers(), 0).Entries[0]
	if e.AliveAtEnd != nil || e.ObservationComplete {
		t.Fatal("stale state at final boundary became known alive")
	}
}

func TestWardLifetimeUnknownPositionCannotImplyStationaryCoverage(t *testing.T) {
	c := testLifetimeCollector()
	o := testLifetimeObservation(1, 1, 3000)
	o.position = nil
	c.observeEntity(o)
	o.created = false
	o.tick = 3002
	o.position = &wardLifetimePosition{5, 6, "ward_entity"}
	c.observeEntity(o)
	c.confirmPacket(3002)
	c.end(c.clock(3002))
	e := c.finish(testLifetimePlayers(), 0).Entries[0]
	if e.Position == nil || e.PositionMoved || e.ObservationComplete || e.AliveAtEnd != nil {
		t.Fatal("unknown early position became complete stationary interval")
	}
}

func TestWardLifetimeNativePauseClock(t *testing.T) {
	c := testLifetimeCollector()
	c.nativeTimes = nil
	c.haveSample = false
	for _, s := range []struct {
		tick, total, start uint32
		paused             bool
	}{{48015, 0, 0, false}, {48017, 0, 48017, true}, {48181, 0, 48017, true}, {48183, 166, 0, false}, {48345, 166, 0, false}} {
		v, ok := lifetimePauseClock(s.tick, s.total, s.start, s.paused, c.interval)
		if !ok {
			t.Fatal("clock rejected")
		}
		c.sampleClock(s.tick, v, ok)
	}
	if c.clockGap {
		t.Fatal("valid pause treated as gap")
	}
	if c.clock(48017) != c.clock(48181) || c.clock(48181) != c.clock(48183) {
		t.Fatal("pause did not freeze")
	}
	if math.Abs(c.clock(48345)-1605.9668) > .001 {
		t.Fatal(c.clock(48345))
	}
	if math.Abs(c.clock(48015)-1600.5) > .001 {
		t.Fatal("historical sample changed after pause")
	}
	if _, ok := lifetimePauseClock(10, 20, 0, false, c.interval); ok {
		t.Fatal("invalid total")
	}
	if _, ok := lifetimePauseClock(10, 0, 20, true, c.interval); ok {
		t.Fatal("future pause")
	}
}
func TestWardLifetimeUnknownNativeClockAndJumps(t *testing.T) {
	c := testLifetimeCollector()
	c.nativeTimes = nil
	c.haveSample = false
	c.observeEntity(testLifetimeObservation(1, 1, 3000))
	out := c.finish(testLifetimePlayers(), 0)
	if len(out.Entries) != 0 || out.Coverage.DroppedEntities != 1 || out.Coverage.ClockComplete || !out.Coverage.Truncated {
		t.Fatalf("unknown clock fabricated data: %+v", out)
	}
	for _, jump := range []float64{99, 102} {
		c = testLifetimeCollector()
		c.nativeTimes = nil
		c.haveSample = false
		c.sampleClock(3000, 100, true)
		c.sampleClock(3002, jump, true)
		if !c.clockGap {
			t.Fatal("clock jump accepted", jump)
		}
	}
	c = testLifetimeCollector()
	c.nativeTimes = nil
	c.haveSample = false
	c.sampleClock(3000, 100, true)
	c.observeEntity(testLifetimeObservation(1, 1, 3000))
	c.sampleClock(3002, 0, false)
	c.confirmPacket(3002)
	c.end(101)
	out = c.finish(testLifetimePlayers(), 0)
	if len(out.Entries) != 1 || out.Entries[0].AliveAtEnd != nil || out.Entries[0].ObservationComplete || out.Coverage.ClockComplete {
		t.Fatal("gap extended known alive", out)
	}
}

func TestWardLifetimeClockCapNeverExtendsAlive(t *testing.T) {
	c := testLifetimeCollector()
	c.nativeTimes = make(map[uint32]float64, maxWardClockSamples)
	for tick := uint32(0); tick < maxWardClockSamples; tick++ {
		c.nativeTimes[tick] = float64(float32(tick) * float32(c.interval))
	}
	c.observeEntity(testLifetimeObservation(1, 1, 3000))
	c.sampleClock(maxWardClockSamples, 7000, true)
	c.confirmPacket(maxWardClockSamples)
	c.end(7000)
	out := c.finish(testLifetimePlayers(), 0)
	if out.Coverage.ClockSamplesDropped != 1 || out.Coverage.ClockComplete || !out.Coverage.Truncated || out.Entries[0].AliveAtEnd != nil {
		t.Fatal("clock cap fabricated final alive", out)
	}
}
