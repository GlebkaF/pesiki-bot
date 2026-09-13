package main

import (
	"fmt"
	"github.com/dotabuff/manta"
	"strings"
)

// ReplayScoreboard is the final replicated scoreboard, not a combat-log recount.
// It is additive: legacy KDA and APM stay unchanged for historical comparisons.
type ReplayScoreboard struct {
	Version          string `json:"version"`
	Source           string `json:"source"`
	ResourceSlot     int    `json:"resource_slot"`
	TeamSlot         int    `json:"team_slot"`
	HeroID           int    `json:"hero_id"`
	Kills            int    `json:"kills"`
	Deaths           int    `json:"deaths"`
	Assists          int    `json:"assists"`
	Complete         bool   `json:"complete"`
	EndStateObserved bool   `json:"end_state_observed"`
}
type scoreboardCandidate struct {
	steam      uint64
	team, hero string
	value      ReplayScoreboard
}
type replayScoreboardCollector struct {
	resource *manta.Entity
	parser   *manta.Parser
}

func newReplayScoreboard(p *manta.Parser) *replayScoreboardCollector {
	c := &replayScoreboardCollector{parser: p}
	p.OnEntity(func(e *manta.Entity, op manta.EntityOp) error {
		if e.GetClassName() == "CDOTA_PlayerResource" {
			c.resource = e
		}
		return nil
	})
	return c
}
func scoreboardInteger(v interface{}) (int, bool) {
	switch n := v.(type) {
	case int32:
		if n >= 0 {
			return int(n), true
		}
	case uint32:
		if uint64(n) <= uint64(^uint(0)>>1) {
			return int(n), true
		}
	case uint64:
		if n <= uint64(^uint(0)>>1) {
			return int(n), true
		}
	}
	return 0, false
}

// Identity is resolved through the selected hero entity's serial-checked handle.
// Resource array positions need not equal final player order or DataTeam PlayerID.
func readReplayScoreboard(get func(string) interface{}, heroForHandle func(uint64) string) []scoreboardCandidate {
	out := []scoreboardCandidate{}
	for slot := 0; slot < 64; slot++ {
		data := fmt.Sprintf("m_vecPlayerData.%04d.", slot)
		teamData := fmt.Sprintf("m_vecPlayerTeamData.%04d.", slot)
		steam, ok := get(data + "m_iPlayerSteamID").(uint64)
		if !ok || steam == 0 {
			continue
		}
		side, ok := scoreboardInteger(get(data + "m_iPlayerTeam"))
		if !ok || (side != 2 && side != 3) {
			continue
		}
		teamSlot, ts := scoreboardInteger(get(teamData + "m_iTeamSlot"))
		heroID, a := scoreboardInteger(get(teamData + "m_nSelectedHeroID"))
		kills, b := scoreboardInteger(get(teamData + "m_iKills"))
		deaths, c := scoreboardInteger(get(teamData + "m_iDeaths"))
		assists, d := scoreboardInteger(get(teamData + "m_iAssists"))
		handle, e := scoreboardInteger(get(teamData + "m_hSelectedHero"))
		if !ts || teamSlot > 4 || !a || heroID <= 0 || !b || !c || !d || !e {
			continue
		}
		hero := heroForHandle(uint64(handle))
		if hero == "" {
			continue
		}
		team := "radiant"
		if side == 3 {
			team = "dire"
		}
		out = append(out, scoreboardCandidate{steam: steam, team: team, hero: hero, value: ReplayScoreboard{Version: "player-resource-v1", Source: "CDOTA_PlayerResource", ResourceSlot: slot, TeamSlot: teamSlot, HeroID: heroID, Kills: kills, Deaths: deaths, Assists: assists, Complete: true, EndStateObserved: true}})
	}
	return out
}
func applyReplayScoreboard(players []*Player, rows []scoreboardCandidate, endStateObserved bool) {
	if !endStateObserved {
		return
	}
	for _, p := range players {
		var found *ReplayScoreboard
		matches := 0
		steamRows := 0
		rosterCopies := 0
		for _, q := range players {
			if q.SteamID == p.SteamID {
				rosterCopies++
			}
		}
		for _, r := range rows {
			if r.steam == p.SteamID {
				steamRows++
			}
			if r.steam == p.SteamID && strings.ReplaceAll(r.hero, "_", "") == strings.ReplaceAll(p.Hero, "_", "") && r.team == p.Team {
				v := r.value
				found = &v
				matches++
			}
		}
		if matches == 1 && steamRows == 1 && rosterCopies == 1 {
			p.ReplayScoreboard = found
		}
	}
}
func (c *replayScoreboardCollector) apply(players []*Player, endStateObserved bool) {
	if c.resource == nil || !endStateObserved {
		return
	}
	rows := readReplayScoreboard(c.resource.Get, func(handle uint64) string {
		e := c.parser.FindEntityByHandle(handle)
		if e == nil || !strings.HasPrefix(e.GetClassName(), "CDOTA_Unit_Hero_") {
			return ""
		}
		return classToHero(e.GetClassName())
	})
	applyReplayScoreboard(players, rows, endStateObserved)
}
