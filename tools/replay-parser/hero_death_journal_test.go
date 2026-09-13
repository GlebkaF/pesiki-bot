package main

import (
	"github.com/dotabuff/manta/dota"
	"testing"
)

func testHeroJournal() (*heroDeathJournalCollector, []*Player) {
	players := []*Player{{Hero: "kunkka", Team: "radiant", SteamID: 76561198000000001}, {Hero: "pudge", Team: "dire", SteamID: 76561198000000002}, {Hero: "undying", Team: "dire", SteamID: 76561198000000003}}
	c := &heroDeathJournalCollector{clock: &wardLifetimeCollector{haveSample: true}, histories: map[int]*heroCounterHistory{}, ended: false}
	return c, players
}
func testJournalSample(c *heroDeathJournalCollector, players []*Player, t float64, ks, ds []int) {
	for i, p := range players {
		c.sample(scoreboardCandidate{hero: p.Hero, team: p.Team, steam: p.SteamID, value: ReplayScoreboard{ResourceSlot: i, Kills: ks[i], Deaths: ds[i]}}, t)
	}
}
func testJournalEvent(target, source, targetTeam, attackerTeam string) *heroJournalRaw {
	return &heroJournalRaw{ts: 100.025, target: "npc_dota_hero_" + target, attacker: "npc_dota_hero_" + source, source: "npc_dota_hero_" + source, targetTeam: targetTeam, attackerTeam: attackerTeam}
}
func TestHeroJournalVerifiedDoubleKillIndependentCounters(t *testing.T) {
	c, ps := testHeroJournal()
	testJournalSample(c, ps, 100, []int{0, 0, 0}, []int{0, 0, 0})
	testJournalSample(c, ps, 100.067, []int{2, 0, 0}, []int{0, 1, 1})
	c.events = []heroJournalRaw{*testJournalEvent("pudge", "kunkka", "dire", "radiant"), *testJournalEvent("undying", "kunkka", "dire", "radiant")}
	c.raw = 2
	out := c.finish(ps, 0)
	if out.Coverage.VerifiedDeaths != 2 || out.Coverage.VerifiedKills != 2 {
		t.Fatal(out.Coverage)
	}
	for _, e := range out.Entries {
		if e.WillReincarnate != nil || e.KillCounter.Delta != 2 || e.KillerResourceSlot == nil || *e.KillerResourceSlot != 0 || e.DeathCounter.Delta != 1 {
			t.Fatalf("bad counter evidence %+v", e)
		}
	}
	// Final scoreboard is audit only: deliberately incompatible totals must never manufacture or erase events.
	c.ended = true
	c.endRaw = 200
	ps[0].ReplayScoreboard = &ReplayScoreboard{Complete: true, Kills: 99, Deaths: 0}
	out = c.finish(ps, 0)
	if out.Coverage.VerifiedKills != 2 || out.Coverage.FinalAudit[0].KillsMatch == nil || *out.Coverage.FinalAudit[0].KillsMatch {
		t.Fatal("audit altered journal", out.Coverage)
	}
}
func TestHeroJournalExplicitReturnAndContradiction(t *testing.T) {
	for _, death := range []int{0, 1} {
		c, ps := testHeroJournal()
		testJournalSample(c, ps, 100, []int{0, 0, 0}, []int{0, 0, 0})
		testJournalSample(c, ps, 100.067, []int{0, 0, 0}, []int{0, death, 0})
		e := testJournalEvent("pudge", "kunkka", "dire", "radiant")
		e.reincarnate = lifetimePtr(true)
		c.events = []heroJournalRaw{*e}
		out := c.finish(ps, 0)
		expected := "verified_reincarnation"
		if death == 1 {
			expected = "contradiction"
		}
		if out.Entries[0].Status != expected || out.Entries[0].KillerHero != nil {
			t.Fatal(out.Entries[0])
		}
	}
}
func TestHeroJournalRejectsDuplicateAndUnexhaustedBatch(t *testing.T) {
	for _, duplicate := range []bool{true, false} {
		c, ps := testHeroJournal()
		testJournalSample(c, ps, 100, []int{0, 0, 0}, []int{0, 0, 0})
		testJournalSample(c, ps, 100.067, []int{2, 0, 0}, []int{0, 1, 0})
		e := *testJournalEvent("pudge", "kunkka", "dire", "radiant")
		c.events = []heroJournalRaw{e}
		if duplicate {
			c.events = append(c.events, e)
		}
		out := c.finish(ps, 0)
		if out.Coverage.VerifiedKills != 0 {
			t.Fatal("guessed batch kill", out.Coverage)
		}
		if duplicate && out.Coverage.VerifiedDeaths != 0 {
			t.Fatal("dedup hid duplicate", out.Coverage)
		}
	}
}
func TestHeroJournalDenySelfEnvironmentAndUnknown(t *testing.T) {
	for _, source := range []string{"undying", "pudge", "npc_dota_neutral_black_dragon", "dota_unknown"} {
		c, ps := testHeroJournal()
		testJournalSample(c, ps, 100, []int{0, 0, 0}, []int{0, 0, 0})
		testJournalSample(c, ps, 100.067, []int{0, 0, 0}, []int{0, 1, 0})
		e := testJournalEvent("pudge", source, "dire", "dire")
		want := "allied_deny"
		if source == "pudge" {
			want = "self"
		}
		if source == "npc_dota_neutral_black_dragon" {
			e.attacker = source
			e.source = source
			e.attackerTeam = ""
			want = "environment"
		}
		if source == "dota_unknown" {
			e.attacker = source
			e.source = source
			want = "unknown"
		}
		c.events = []heroJournalRaw{*e}
		out := c.finish(ps, 0)
		if out.Entries[0].Attribution != want || out.Entries[0].KillCounter != nil {
			t.Fatal(out.Entries[0])
		}
	}
}
func TestHeroJournalControlledSourceRequiresCounterAndEnemyTeam(t *testing.T) {
	for _, goodTeam := range []bool{true, false} {
		c, ps := testHeroJournal()
		testJournalSample(c, ps, 100, []int{0, 0, 0}, []int{0, 0, 0})
		testJournalSample(c, ps, 100.067, []int{1, 0, 0}, []int{0, 1, 0})
		e := testJournalEvent("pudge", "kunkka", "dire", "radiant")
		e.attacker = "npc_dota_controlled_summon"
		e.illusion = true
		if !goodTeam {
			e.attackerTeam = "dire"
		}
		c.events = []heroJournalRaw{*e}
		out := c.finish(ps, 0)
		if goodTeam {
			if !out.Entries[0].SourceControlled || !out.Entries[0].SourceIllusion || out.Entries[0].KillerHero == nil {
				t.Fatal(out.Entries[0])
			}
		} else if out.Coverage.VerifiedKills != 0 {
			t.Fatal("team contradiction ignored")
		}
	}
}
func TestHeroJournalClockGapResetMissingOwnerAndCap(t *testing.T) {
	for _, mode := range []string{"clock", "reset", "identity", "cap"} {
		c, ps := testHeroJournal()
		testJournalSample(c, ps, 100, []int{0, 0, 0}, []int{0, 0, 0})
		testJournalSample(c, ps, 100.067, []int{1, 0, 0}, []int{0, 1, 0})
		c.events = []heroJournalRaw{*testJournalEvent("pudge", "kunkka", "dire", "radiant")}
		switch mode {
		case "clock":
			c.clock.clockGap = true
		case "reset":
			testJournalSample(c, ps, 99, []int{0, 0, 0}, []int{0, 0, 0})
		case "identity":
			ps[1].SteamID++
		case "cap":
			c.sampleDropped = 1
		}
		out := c.finish(ps, 0)
		if out.Coverage.VerifiedKills != 0 || out.Coverage.VerifiedDeaths != 0 {
			t.Fatal(mode, out.Coverage)
		}
	}
}
func TestHeroJournalRawFlagsAndEndFreeze(t *testing.T) {
	c, _ := testHeroJournal()
	names := map[uint32]string{1: "npc_dota_hero_pudge", 2: "npc_dota_hero_kunkka"}
	name := func(i uint32) string { return names[i] }
	typ := dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_DEATH
	e := &dota.CMsgDOTACombatLogEntry{Type: &typ, Timestamp: lifetimePtr(float32(100)), TargetName: lifetimePtr(uint32(1)), AttackerName: lifetimePtr(uint32(2)), IsTargetHero: lifetimePtr(true), IsTargetIllusion: lifetimePtr(true)}
	c.observeDeath(e, name)
	if len(c.events) != 0 {
		t.Fatal("illusion accepted")
	}
	e.IsTargetIllusion = lifetimePtr(false)
	c.observeDeath(e, name)
	if len(c.events) != 1 || c.events[0].reincarnate != nil || c.events[0].source != "" {
		t.Fatal("absent flags invented")
	}
	c.ended = true
	c.observeDeath(e, name)
	if len(c.events) != 1 {
		t.Fatal("postgame event accepted")
	}
}
func TestHeroJournalPausedZeroWidthCounterBracket(t *testing.T) {
	c, ps := testHeroJournal()
	testJournalSample(c, ps, 100, []int{0, 0, 0}, []int{0, 0, 0})
	testJournalSample(c, ps, 100, []int{1, 0, 0}, []int{0, 1, 0})
	e := testJournalEvent("pudge", "kunkka", "dire", "radiant")
	e.ts = 100
	c.events = []heroJournalRaw{*e}
	out := c.finish(ps, 0)
	if out.Coverage.VerifiedKills != 1 || out.Entries[0].DeathCounter.From != out.Entries[0].DeathCounter.To || out.Coverage.CounterResets != 0 {
		t.Fatal(out.Coverage)
	}
}
func TestHeroJournalUnknownVictimCannotBeDroppedToFitKillDelta(t *testing.T) {
	c, ps := testHeroJournal()
	testJournalSample(c, ps, 100, []int{0, 0, 0}, []int{0, 0, 0})
	testJournalSample(c, ps, 100.067, []int{1, 0, 0}, []int{0, 1, 0})
	c.events = []heroJournalRaw{*testJournalEvent("pudge", "kunkka", "dire", "radiant"), *testJournalEvent("undying", "kunkka", "dire", "radiant")}
	out := c.finish(ps, 0)
	if out.Coverage.VerifiedDeaths != 1 || out.Coverage.VerifiedKills != 0 {
		t.Fatal("unknown counter silently removed", out.Coverage)
	}
}
func TestHeroJournalUnknownDuplicateVictimBlocksDeathAssignment(t *testing.T) {
	c, ps := testHeroJournal()
	testJournalSample(c, ps, 100, []int{0, 0, 0}, []int{0, 0, 0})
	testJournalSample(c, ps, 100.067, []int{1, 0, 0}, []int{0, 1, 0})
	known := *testJournalEvent("pudge", "kunkka", "dire", "radiant")
	unknown := known
	unknown.targetTeam = ""
	c.events = []heroJournalRaw{known, unknown}
	out := c.finish(ps, 0)
	if out.Coverage.VerifiedDeaths != 0 || out.Coverage.VerifiedKills != 0 {
		t.Fatal("unknown duplicate removed", out.Coverage)
	}
}
func TestHeroJournalUnknownRawAttackerDoesNotProveControlledUnit(t *testing.T) {
	c, ps := testHeroJournal()
	testJournalSample(c, ps, 100, []int{0, 0, 0}, []int{0, 0, 0})
	testJournalSample(c, ps, 100.067, []int{1, 0, 0}, []int{0, 1, 0})
	e := testJournalEvent("pudge", "kunkka", "dire", "radiant")
	e.attacker = "dota_unknown"
	c.events = []heroJournalRaw{*e}
	out := c.finish(ps, 0)
	if out.Coverage.VerifiedKills != 1 || out.Entries[0].SourceControlled {
		t.Fatal("unknown attacker called controlled", out.Entries[0])
	}
}
