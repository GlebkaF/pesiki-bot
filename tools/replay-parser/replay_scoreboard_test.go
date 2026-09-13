package main

import "testing"

func scoreboardFixture() map[string]interface{} {
	return map[string]interface{}{
		"m_vecPlayerData.0007.m_iPlayerSteamID":      uint64(76561198000000001),
		"m_vecPlayerData.0007.m_iPlayerTeam":         uint32(2),
		"m_vecPlayerTeamData.0007.m_iTeamSlot":       uint32(1),
		"m_vecPlayerTeamData.0007.m_nSelectedHeroID": uint32(37),
		"m_vecPlayerTeamData.0007.m_iKills":          uint32(0),
		"m_vecPlayerTeamData.0007.m_iDeaths":         uint32(3),
		"m_vecPlayerTeamData.0007.m_iAssists":        uint32(27),
		"m_vecPlayerTeamData.0007.m_hSelectedHero":   uint32(12345),
	}
}
func readScoreFixture(m map[string]interface{}) []scoreboardCandidate {
	return readReplayScoreboard(func(k string) interface{} { return m[k] }, func(h uint64) string {
		if h == 12345 {
			return "warlock"
		}
		return ""
	})
}
func TestReplayScoreboardIdentityAndZero(t *testing.T) {
	rows := readScoreFixture(scoreboardFixture())
	if len(rows) != 1 {
		t.Fatalf("read failed %+v", rows)
	}
	player := &Player{SteamID: 76561198000000001, Hero: "warlock", Team: "radiant", Slot: 1, Kills: 99, Deaths: 99, Assists: 99}
	other := &Player{SteamID: 76561198000000002, Hero: "pudge", Team: "dire", Slot: 7}
	applyReplayScoreboard([]*Player{other, player}, rows, true)
	s := player.ReplayScoreboard
	if s == nil || s.ResourceSlot != 7 || s.Kills != 0 || s.Deaths != 3 || s.Assists != 27 || !s.Complete || !s.EndStateObserved {
		t.Fatalf("scoreboard missing or reordered incorrectly %+v", s)
	}
	if player.Kills != 99 || player.Deaths != 99 || player.Assists != 99 || other.ReplayScoreboard != nil {
		t.Fatal("legacy KDA changed or resource slot confused with player identity")
	}
}
func TestReplayScoreboardRequiresEndAndExactIdentity(t *testing.T) {
	rows := readScoreFixture(scoreboardFixture())
	p := &Player{SteamID: 76561198000000001, Hero: "warlock", Team: "radiant"}
	applyReplayScoreboard([]*Player{p}, rows, false)
	if p.ReplayScoreboard != nil {
		t.Fatal("unfinished replay cannot advertise final scoreboard")
	}
	for _, bad := range []Player{{SteamID: p.SteamID, Hero: "pudge", Team: p.Team}, {SteamID: p.SteamID, Hero: p.Hero, Team: "dire"}, {SteamID: p.SteamID + 1, Hero: p.Hero, Team: p.Team}} {
		applyReplayScoreboard([]*Player{&bad}, rows, true)
		if bad.ReplayScoreboard != nil {
			t.Fatal("mismatched identity accepted")
		}
	}
	applyReplayScoreboard([]*Player{p}, append(rows, rows[0]), true)
	if p.ReplayScoreboard != nil {
		t.Fatal("ambiguous resource identity accepted")
	}
	copy := *p
	applyReplayScoreboard([]*Player{p, &copy}, rows, true)
	if p.ReplayScoreboard != nil || copy.ReplayScoreboard != nil {
		t.Fatal("duplicate output identity accepted")
	}
}
func TestReplayScoreboardMissingIsNotZero(t *testing.T) {
	for _, key := range []string{"m_iKills", "m_iDeaths", "m_iAssists", "m_nSelectedHeroID", "m_hSelectedHero"} {
		m := scoreboardFixture()
		delete(m, "m_vecPlayerTeamData.0007."+key)
		if len(readScoreFixture(m)) != 0 {
			t.Fatalf("missing %s interpreted as zero", key)
		}
	}
	for _, bad := range []interface{}{int32(-1), float64(3), "3", nil} {
		m := scoreboardFixture()
		m["m_vecPlayerTeamData.0007.m_iAssists"] = bad
		if len(readScoreFixture(m)) != 0 {
			t.Fatal("invalid counter accepted")
		}
	}
	m := scoreboardFixture()
	m["m_vecPlayerTeamData.0007.m_hSelectedHero"] = uint32(999)
	if len(readScoreFixture(m)) != 0 {
		t.Fatal("unresolved selected hero accepted")
	}
	m = scoreboardFixture()
	m["m_vecPlayerData.0007.m_iPlayerTeam"] = uint32(1)
	if len(readScoreFixture(m)) != 0 {
		t.Fatal("spectator accepted")
	}
}

func TestReplayScoreboardHeroClassAliasAndAmbiguousSteam(t *testing.T) {
	rows := readScoreFixture(scoreboardFixture())
	rows[0].hero = "queen_of_pain"
	p := &Player{SteamID: rows[0].steam, Hero: "queenofpain", Team: "radiant"}
	applyReplayScoreboard([]*Player{p}, rows, true)
	if p.ReplayScoreboard == nil {
		t.Fatal("canonical underscore alias not matched")
	}
	p.ReplayScoreboard = nil
	other := rows[0]
	other.hero = "pudge"
	applyReplayScoreboard([]*Player{p}, append(rows, other), true)
	if p.ReplayScoreboard != nil {
		t.Fatal("duplicate SteamID with conflicting hero cannot be resolved by choosing convenient row")
	}
}
