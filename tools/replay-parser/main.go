// Собственный парсер Dota 2 реплеев для pesiki-bot.
// Читает .dem (Source 2) и выдаёт JSON максимально подробных данных о матче:
// лейнинг, экономика по минутам, тимфайты, тайминги предметов и зданий, выкупы,
// мультикиллы, стаки лагерей, спасения союзников, прерванные касты.
package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"sort"
	"strings"

	"github.com/dotabuff/manta"
	"github.com/dotabuff/manta/dota"
)

// Снимок позиций всех героев в один момент игрового времени.
type posSampleT struct {
	sec float64
	pos map[string][2]float64
}

type ItemBuy struct {
	Item string  `json:"item"`
	Min  float64 `json:"min"`
}

type Player struct {
	CombatDetails *CombatDetails `json:"combat_details,omitempty"`
	ActionCounts  map[string]int `json:"action_counts"`
	Actions       *int           `json:"actions,omitempty"`
	APM           *int           `json:"actions_per_min,omitempty"`
	SteamID       uint64         `json:"steam_id,string"`
	Name          string         `json:"name"`
	Hero          string         `json:"hero"`
	Team          string         `json:"team"`
	Slot          int            `json:"slot"`
	Lane          string         `json:"lane"`
	LaneRole      string         `json:"lane_role"`

	Kills   int `json:"kills"`
	Deaths  int `json:"deaths"`
	Assists int `json:"assists"`

	LastHits int `json:"last_hits"`
	Denies   int `json:"denies"`
	CS10     int `json:"cs_at_10"`
	CS20     int `json:"cs_at_20"`

	NW10       int   `json:"networth_at_10"`
	NW20       int   `json:"networth_at_20"`
	NWFinal    int   `json:"networth_final"`
	GPM        int   `json:"gpm"`
	XPM        int   `json:"xpm"`
	NWByMinute []int `json:"networth_by_minute"`

	HeroDamage  int `json:"hero_damage"`
	DamageTaken int `json:"damage_taken"`
	Healing     int `json:"healing"`
	TowerDamage int `json:"tower_damage"`

	GoldLostToDeath int `json:"gold_lost_to_death"`
	GoldOnSupport   int `json:"gold_spent_on_support"`

	Level      int            `json:"level_final"`
	Buybacks   int            `json:"buybacks"`
	MaxStreak  int            `json:"max_killstreak"`
	Multikills map[string]int `json:"multikills,omitempty"`

	ObsPlaced   int `json:"obs_wards_placed"`
	SenPlaced   int `json:"sentry_wards_placed"`
	WardsKilled int `json:"wards_killed"`

	EnemyHalfPct   float64 `json:"enemy_half_pct"`
	AvgAllyDist    int     `json:"avg_ally_distance"`
	DeathIsolation int     `json:"death_isolation"`
	DistanceRun    int     `json:"distance_run"`

	Items      []ItemBuy      `json:"item_timings"`
	DeathTimes []float64      `json:"death_times_min"`
	KilledBy   map[string]int `json:"killed_by,omitempty"`
	Killed     map[string]int `json:"killed,omitempty"`
	TopSpells  map[string]int `json:"top_spells,omitempty"`
}

type Kill struct {
	Min     float64 `json:"min"`
	Killer  string  `json:"killer"`
	Victim  string  `json:"victim"`
	Assists int     `json:"assists"`
	Long    bool    `json:"long_range,omitempty"`
}

type Building struct {
	Min  float64 `json:"min"`
	Name string  `json:"name"`
	Team string  `json:"killed_by_team"`
}

type Teamfight struct {
	StartMin   float64  `json:"start_min"`
	EndMin     float64  `json:"end_min"`
	Deaths     int      `json:"deaths"`
	RadiantDie int      `json:"radiant_died"`
	DireDie    int      `json:"dire_died"`
	Winner     string   `json:"winner"`
	HeroesDied []string `json:"heroes_died"`
}

type Output struct {
	AnalyticsVersion string      `json:"analytics_version,omitempty"`
	ParserVersion    string      `json:"parser_version"`
	APMVersion       string      `json:"apm_version,omitempty"`
	APMDuration      float64     `json:"apm_duration_seconds,omitempty"`
	MatchID          uint64      `json:"match_id"`
	DurationM        float64     `json:"duration_min"`
	Winner           string      `json:"winner"`
	GameMode         string      `json:"game_mode"`
	Players          []*Player   `json:"players"`
	FirstBlood       *Kill       `json:"first_blood"`
	Kills            []Kill      `json:"kills"`
	Teamfights       []Teamfight `json:"teamfights"`
	Buildings        []Building  `json:"buildings"`
	Roshans          []float64   `json:"roshan_kills_min"`
	ParseStats       struct {
		CombatLogEntries int     `json:"combat_log_entries"`
		ParseSeconds     float64 `json:"-"`
	} `json:"parse_stats"`
}

const (
	// Координаты Source 2: клетка 128 юнитов, отсчёт смещён на половину карты.
	CellWidth  = 128.0
	CellOffset = 16384.0
	// Тик — 1/30 секунды. Позиции снимаем раз в 5 секунд: хватает для метрик
	// и почти не влияет на время разбора.
	TickInterval      = 1.0 / 30.0
	SampleIntervalSec = 5.0
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: parser <replay.dem>")
		os.Exit(1)
	}
	f, err := os.Open(os.Args[1])
	if err != nil {
		panic(err)
	}
	defer f.Close()

	p, err := manta.NewStreamParser(f)
	if err != nil {
		panic(err)
	}

	out := &Output{ParserVersion: "pesiki-replay-v6", AnalyticsVersion: analyticsVersion}
	byHero := map[string]*Player{}
	bySlot := map[int]*Player{}
	var gameStart float64 = -1
	var lastTS, endTS float64
	gameEnded := false
	radiantWin := false
	apm := newAPMCounter(p, func() bool { return gameStart >= 0 && !gameEnded })
	wards := newWardCollector(p, func() bool { return gameStart >= 0 && !gameEnded }, func() float64 { return (lastTS - gameStart) / 60 })

	p.Callbacks.OnCDemoFileInfo(func(m *dota.CDemoFileInfo) error {
		gi := m.GetGameInfo().GetDota()
		out.MatchID = uint64(gi.GetMatchId())
		radiantWin = gi.GetGameWinner() == 2
		out.GameMode = fmt.Sprintf("mode_%d", gi.GetGameMode())
		for i, pi := range gi.GetPlayerInfo() {
			hero := pi.GetHeroName()
			pl := getOrCreate(byHero, hero)
			pl.SteamID = pi.GetSteamid()
			pl.Name = pi.GetPlayerName()
			pl.Team = "dire"
			if pi.GetGameTeam() == 2 {
				pl.Team = "radiant"
			}
			pl.Slot = i
			bySlot[i] = pl
		}
		return nil
	})

	// Экономика из entity-стейта команд.
	var curNW, curLost, curSupport [10]int32
	var finNW, finLost, finSupport [10]int32
	readTeam := func(e *manta.Entity, base int) {
		for i := 0; i < 5; i++ {
			if v, ok := e.GetInt32(fmt.Sprintf("m_vecDataTeam.%04d.m_iNetWorth", i)); ok {
				curNW[base+i] = v
			}
			if v, ok := e.GetInt32(fmt.Sprintf("m_vecDataTeam.%04d.m_iGoldLostToDeath", i)); ok {
				curLost[base+i] = v
			}
			if v, ok := e.GetInt32(fmt.Sprintf("m_vecDataTeam.%04d.m_iGoldSpentOnSupport", i)); ok {
				curSupport[base+i] = v
			}
		}
	}
	heroLevels := map[string]int{}
	// Позиции героев. Иллюзии (Manta и пр.) имеют тот же класс, что и оригинал,
	// поэтому держимся за индекс сущности, увиденный первым — это всегда сам герой.
	type liveHero struct {
		hero     string
		cellX    uint32
		cellY    uint32
		vecX     float32
		vecY     float32
		haveCell bool
		haveVec  bool
	}
	live := map[int32]*liveHero{}
	canonical := map[string]int32{}

	p.OnEntity(func(e *manta.Entity, op manta.EntityOp) error {
		cn := e.GetClassName()
		if strings.HasPrefix(cn, "CDOTA_Unit_Hero_") {
			idx := e.GetIndex()
			hn := classToHero(cn)
			if seen, ok := canonical[hn]; ok && seen != idx {
				return nil
			}
			if _, ok := canonical[hn]; !ok {
				canonical[hn] = idx
			}
			lh := live[idx]
			if lh == nil {
				lh = &liveHero{hero: hn}
				live[idx] = lh
			}
			if v, ok := e.GetUint32("CBodyComponent.m_cellX"); ok {
				lh.cellX, lh.haveCell = v, true
			}
			if v, ok := e.GetUint32("CBodyComponent.m_cellY"); ok {
				lh.cellY, lh.haveCell = v, true
			}
			if v, ok := e.GetFloat32("CBodyComponent.m_vecX"); ok {
				lh.vecX, lh.haveVec = v, true
			}
			if v, ok := e.GetFloat32("CBodyComponent.m_vecY"); ok {
				lh.vecY, lh.haveVec = v, true
			}
		}
		switch cn {
		case "CDOTA_DataRadiant":
			readTeam(e, 0)
		case "CDOTA_DataDire":
			readTeam(e, 5)
		default:
			if strings.HasPrefix(cn, "CDOTA_Unit_Hero_") {
				if lvl, ok := e.GetInt32("m_iCurrentLevel"); ok && int(lvl) > heroLevels[classToHero(cn)] {
					heroLevels[classToHero(cn)] = int(lvl)
				}
			}
		}
		return nil
	})

	deathPoint := func(e *dota.CMsgDOTACombatLogEntry, min float64, target string) combatPoint {
		pt := point(e, min)
		if pt.X != nil && pt.Y != nil {
			return pt
		}
		idx, ok := canonical[short(target)]
		if !ok {
			for key, value := range canonical {
				if normalizedHero(key) == normalizedHero(target) {
					idx, ok = value, true
					break
				}
			}
		}
		if ok {
			if lh := live[idx]; lh != nil && lh.haveCell && lh.haveVec {
				x := float32(float64(lh.cellX)*CellWidth + float64(lh.vecX) - CellOffset)
				y := float32(float64(lh.cellY)*CellWidth + float64(lh.vecY) - CellOffset)
				pt.X, pt.Y, pt.CoordinatesSource = &x, &y, "hero_entity"
			}
		}
		return pt
	}
	name := func(idx int32) string {
		s, _ := p.LookupStringByIndex("CombatLogNames", idx)
		return s
	}
	hero := func(n string) *Player {
		if !strings.HasPrefix(n, "npc_dota_hero_") {
			return nil
		}
		return getOrCreate(byHero, n)
	}

	var nwCurve [10][]int
	lastDeath := map[string]float64{}
	nextMinute := 1
	// Координаты ранних добиваний — по ним определяем линию.
	laneSamples := map[string][][2]int32{}
	var assistCnt, buybackCnt [10]int

	p.Callbacks.OnCMsgDOTACombatLogEntry(func(e *dota.CMsgDOTACombatLogEntry) error {
		out.ParseStats.CombatLogEntries++
		ts := float64(e.GetTimestamp())
		typ := e.GetType()

		if typ == dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_GAME_STATE {
			if e.GetValue() == 5 && gameStart < 0 {
				gameStart = ts
			}
			if e.GetValue() == 6 && gameStart >= 0 && !gameEnded {
				gameEnded, endTS = true, ts
				finNW, finLost, finSupport = curNW, curLost, curSupport
			}
		}
		if gameEnded || gameStart < 0 {
			return nil
		}
		lastTS = ts
		min := (ts - gameStart) / 60

		for min >= float64(nextMinute) {
			for i := 0; i < 10; i++ {
				nwCurve[i] = append(nwCurve[i], int(curNW[i]))
			}
			sampleCombat(byHero)
			nextMinute++
		}

		// Позиции ранних событий -> определение линии.
		if min >= 1 && min <= 10 {
			if x, y := e.GetLocationX(), e.GetLocationY(); x != 0 || y != 0 {
				for _, idx := range []uint32{e.GetAttackerName(), e.GetTargetName()} {
					if h := name(int32(idx)); strings.HasPrefix(h, "npc_dota_hero_") {
						laneSamples[short(h)] = append(laneSamples[short(h)], [2]int32{int32(x), int32(y)})
					}
				}
			}
		}

		target := name(int32(e.GetTargetName()))
		attacker := name(int32(e.GetAttackerName()))
		inflictor := name(int32(e.GetInflictorName()))

		collectCombat(e, min, attacker, target, inflictor, byHero, bySlot)
		switch typ {
		case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_DAMAGE:
			if e.GetIsTargetHero() && !e.GetIsTargetIllusion() {
				if ap := hero(attacker); ap != nil && !e.GetIsAttackerIllusion() {
					ap.HeroDamage += int(e.GetValue())
				}
				if tp := hero(target); tp != nil {
					tp.DamageTaken += int(e.GetValue())
				}
			}
			if e.GetIsTargetBuilding() {
				if ap := hero(attacker); ap != nil {
					ap.TowerDamage += int(e.GetValue())
				}
			}

		case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_HEAL:
			if ap := hero(attacker); ap != nil {
				ap.Healing += int(e.GetValue())
			}

		case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_DEATH:
			switch {
			case e.GetIsTargetHero() && !e.GetIsTargetIllusion():
				// Одна смерть иногда логируется несколько раз (реинкарнация, аегис,
				// добивание уже мёртвого) — схлопываем повторы в пределах двух секунд.
				if last, ok := lastDeath[target]; ok && ts-last < 2.0 {
					break
				}
				lastDeath[target] = ts
				vp, ap := hero(target), hero(attacker)
				if vp != nil {
					d := combatFor(vp)
					d.Deaths = append(d.Deaths, deathEvent{combatPoint: deathPoint(e, min, target), Killer: short(attacker), Incoming: d.deathIncoming(min * 60)})
					vp.Deaths++
					vp.DeathTimes = append(vp.DeathTimes, round(min, 2))
					if ap != nil {
						inc(&vp.KilledBy, ap.Hero)
					}
				}
				if ap != nil && !e.GetIsAttackerIllusion() {
					ap.Kills++
					if vp != nil {
						inc(&ap.Killed, vp.Hero)
					}
				}
				for _, ai := range e.GetAssistPlayers() {
					if ai >= 0 && ai < 10 {
						assistCnt[ai]++
					}
				}
				// Уровни героев едут прямо в записи о смерти.
				if ap != nil && int(e.GetAttackerHeroLevel()) > ap.Level {
					ap.Level = int(e.GetAttackerHeroLevel())
				}
				if vp != nil && int(e.GetTargetHeroLevel()) > vp.Level {
					vp.Level = int(e.GetTargetHeroLevel())
				}
				k := Kill{Min: round(min, 2), Killer: short(attacker), Victim: short(target),
					Assists: len(e.GetAssistPlayers()), Long: e.GetLongRangeKill()}
				out.Kills = append(out.Kills, k)

			case e.GetIsTargetBuilding():
				out.Buildings = append(out.Buildings, Building{
					Min: round(min, 2), Name: short(target), Team: teamName(e.GetAttackerTeam())})

			case strings.Contains(target, "roshan"):
				out.Roshans = append(out.Roshans, round(min, 2))

			case strings.Contains(target, "ward"):
				if ap := hero(attacker); ap != nil {
					ap.WardsKilled++
				}

			case isCreep(target) && e.GetIsAttackerHero() && !e.GetIsAttackerIllusion():
				ap := hero(attacker)
				if ap == nil {
					break
				}
				// Деней — добивание крипа своей команды.
				if sameTeam(target, e.GetAttackerTeam()) {
					ap.Denies++
					break
				}
				ap.LastHits++
				if min <= 10 {
					ap.CS10++
				}
				if min <= 20 {
					ap.CS20++
				}
			}

		case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_PURCHASE:
			item := name(int32(e.GetValue()))
			if pl := hero(target); pl != nil && !isConsumable(item) {
				pl.Items = append(pl.Items, ItemBuy{Item: strings.TrimPrefix(item, "item_"), Min: round(min, 2)})
			}
			if pl := hero(target); pl != nil {
				switch item {
				case "item_ward_observer":
					d := combatFor(pl)
					d.Wards = append(d.Wards, wardEvent{combatPoint: point(e, min), Kind: "observer", Event: "purchase"})
					pl.ObsPlaced++
				case "item_ward_sentry":
					d := combatFor(pl)
					d.Wards = append(d.Wards, wardEvent{combatPoint: point(e, min), Kind: "sentry", Event: "purchase"})
					pl.SenPlaced++
				}
			}

		case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_BUYBACK:
			if v := int(e.GetValue()); v >= 0 && v < 10 {
				buybackCnt[v]++
			}

		case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_KILLSTREAK:
			if pl := hero(target); pl != nil && int(e.GetValue()) > pl.MaxStreak {
				pl.MaxStreak = int(e.GetValue())
			}

		case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_MULTIKILL:
			if pl := hero(target); pl != nil {
				inc(&pl.Multikills, fmt.Sprintf("x%d", e.GetValue()))
			}

		case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_ABILITY:
			if pl := hero(attacker); pl != nil && inflictor != "" && inflictor != "dota_unknown" {
				inc(&pl.TopSpells, inflictor)
			}

		case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_FIRST_BLOOD:
			if out.FirstBlood == nil && len(out.Kills) > 0 {
				k := out.Kills[len(out.Kills)-1]
				out.FirstBlood = &k
			}
		}
		return nil
	})

	// Снимок позиций всех героев раз в SampleIntervalSec игрового времени.
	var track []posSampleT
	var startTick int32 = -1
	lastSample := -1e9

	p.Callbacks.OnCDemoPacket(func(m *dota.CDemoPacket) error {
		if gameStart < 0 || gameEnded {
			return nil
		}
		if startTick < 0 {
			startTick = int32(p.Tick)
		}
		elapsed := float64(int32(p.Tick)-startTick) * TickInterval
		if elapsed-lastSample < SampleIntervalSec {
			return nil
		}
		lastSample = elapsed

		snap := make(map[string][2]float64, len(canonical))
		for hn, idx := range canonical {
			lh := live[idx]
			if lh == nil || !lh.haveCell || !lh.haveVec {
				continue
			}
			snap[hn] = [2]float64{
				float64(lh.cellX)*CellWidth + float64(lh.vecX) - CellOffset,
				float64(lh.cellY)*CellWidth + float64(lh.vecY) - CellOffset,
			}
		}
		track = append(track, posSampleT{sec: elapsed, pos: snap})
		return nil
	})

	if err := p.Start(); err != nil {
		panic(err)
	}

	if endTS > 0 {
		lastTS = endTS
	}
	out.DurationM = round((lastTS-gameStart)/60, 2)
	if gameEnded && endTS > gameStart {
		apm.apply(out, byHero, endTS-gameStart)
	}
	out.Winner = "dire"
	if radiantWin {
		out.Winner = "radiant"
	}
	if out.FirstBlood == nil && len(out.Kills) > 0 {
		k := out.Kills[0]
		out.FirstBlood = &k
	}

	for _, pl := range byHero {
		if pl.Team == "" {
			continue
		}
		if s := pl.Slot; s >= 0 && s < 10 {
			pl.NWFinal = int(finNW[s])
			pl.GoldLostToDeath = int(finLost[s])
			pl.GoldOnSupport = int(finSupport[s])
			pl.NWByMinute = nwCurve[s]
			pl.Assists = assistCnt[s]
			pl.Buybacks = buybackCnt[s]
			if len(nwCurve[s]) >= 10 {
				pl.NW10 = nwCurve[s][9]
			}
			if len(nwCurve[s]) >= 20 {
				pl.NW20 = nwCurve[s][19]
			}
			if out.DurationM > 0 {
				pl.GPM = int(float64(pl.NWFinal) / out.DurationM)
			}
		}
		pl.Lane = detectLane(laneSamples[pl.Hero])
		if lv := heroLevels[pl.Hero]; lv > pl.Level {
			pl.Level = lv
		}
		finalizeCombat(pl)
		pl.TopSpells = topN(pl.TopSpells, 4)
		out.Players = append(out.Players, pl)
	}
	sort.Slice(out.Players, func(i, j int) bool { return out.Players[i].Slot < out.Players[j].Slot })
	wards.apply(out.Players)
	assignRoles(out.Players)
	computeMapStats(out.Players, track, out.Kills)
	out.Teamfights = detectTeamfights(out.Kills, out.Players)

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.Encode(out)
}

// Метрики перемещений: где игрок проводил время и насколько отрывался от команды.
// Сторону карты определяем эмпирически по первой минуте — так надёжнее, чем хардкодить.
func computeMapStats(players []*Player, track []posSampleT, kills []Kill) {
	if len(track) == 0 {
		return
	}
	teamOf := map[string]string{}
	for _, p := range players {
		teamOf[p.Hero] = p.Team
	}

	homeSign := map[string]float64{}
	sum, cnt := map[string]float64{}, map[string]int{}
	for _, s := range track {
		if s.sec > 60 {
			break
		}
		for hero, xy := range s.pos {
			t := teamOf[hero]
			if t == "" {
				continue
			}
			sum[t] += xy[0] + xy[1]
			cnt[t]++
		}
	}
	for t, v := range sum {
		if cnt[t] > 0 && v/float64(cnt[t]) >= 0 {
			homeSign[t] = 1
		} else {
			homeSign[t] = -1
		}
	}

	for _, p := range players {
		var samples, enemyHalf int
		var allyDistSum, distRun float64
		var allyDistCnt int
		var prev [2]float64
		havePrev := false

		for _, s := range track {
			me, ok := s.pos[p.Hero]
			if !ok {
				continue
			}
			samples++
			// Своя половина — та, где стоит фонтан команды.
			if sign := homeSign[p.Team]; sign != 0 && (me[0]+me[1])*sign < 0 {
				enemyHalf++
			}
			if havePrev {
				distRun += dist(prev, me)
			}
			prev, havePrev = me, true

			if d, ok := nearestAlly(p, s.pos, teamOf); ok {
				allyDistSum += d
				allyDistCnt++
			}
		}

		if samples > 0 {
			p.EnemyHalfPct = round(float64(enemyHalf)/float64(samples)*100, 1)
			p.DistanceRun = int(distRun)
		}
		if allyDistCnt > 0 {
			p.AvgAllyDist = int(allyDistSum / float64(allyDistCnt))
		}
		p.DeathIsolation = deathIsolation(p, track, teamOf)
	}
}

// Насколько далеко от своих игрок умирал: усреднённая дистанция до ближайшего
// союзника в момент смерти. Большое число — ловили одного.
func deathIsolation(p *Player, track []posSampleT, teamOf map[string]string) int {
	if len(p.DeathTimes) == 0 {
		return 0
	}
	var sum float64
	var n int
	for _, deathMin := range p.DeathTimes {
		target := deathMin * 60
		var best *posSampleT
		bestDiff := 1e9
		for i := range track {
			if d := abs(track[i].sec - target); d < bestDiff {
				bestDiff, best = d, &track[i]
			}
		}
		if best == nil || bestDiff > SampleIntervalSec*2 {
			continue
		}
		if d, ok := nearestAlly(p, best.pos, teamOf); ok {
			sum += d
			n++
		}
	}
	if n == 0 {
		return 0
	}
	return int(sum / float64(n))
}

func nearestAlly(p *Player, pos map[string][2]float64, teamOf map[string]string) (float64, bool) {
	me, ok := pos[p.Hero]
	if !ok {
		return 0, false
	}
	best := 1e9
	found := false
	for hero, xy := range pos {
		if hero == p.Hero || teamOf[hero] != p.Team {
			continue
		}
		if d := dist(me, xy); d < best {
			best, found = d, true
		}
	}
	return best, found
}

func dist(a, b [2]float64) float64 {
	dx, dy := a[0]-b[0], a[1]-b[1]
	return math.Sqrt(dx*dx + dy*dy)
}

func abs(f float64) float64 {
	if f < 0 {
		return -f
	}
	return f
}

func getOrCreate(m map[string]*Player, heroName string) *Player {
	if pl, ok := m[heroName]; ok {
		return pl
	}
	pl := &Player{Hero: strings.TrimPrefix(heroName, "npc_dota_hero_"), Slot: -1}
	m[heroName] = pl
	return pl
}

func inc(m *map[string]int, k string) {
	if *m == nil {
		*m = map[string]int{}
	}
	(*m)[k]++
}

func topN(m map[string]int, n int) map[string]int {
	if len(m) <= n {
		return m
	}
	type kv struct {
		k string
		v int
	}
	var s []kv
	for k, v := range m {
		s = append(s, kv{k, v})
	}
	sort.Slice(s, func(i, j int) bool { return s[i].v > s[j].v })
	r := map[string]int{}
	for _, e := range s[:n] {
		r[e.k] = e.v
	}
	return r
}

// Линия по медиане координат ранних добиваний: mid — вдоль диагонали x≈y.
func detectLane(pts [][2]int32) string {
	if len(pts) < 5 {
		return "unknown"
	}
	xs := make([]int, 0, len(pts))
	ys := make([]int, 0, len(pts))
	for _, p := range pts {
		xs = append(xs, int(p[0]))
		ys = append(ys, int(p[1]))
	}
	sort.Ints(xs)
	sort.Ints(ys)
	x, y := xs[len(xs)/2], ys[len(ys)/2]
	d := x - y
	switch {
	case d > 1800:
		return "bot"
	case d < -1800:
		return "top"
	default:
		return "mid"
	}
}

// Роль внутри линии: самый богатый на линии — кор, остальные саппорты.
func assignRoles(players []*Player) {
	byLane := map[string][]*Player{}
	for _, p := range players {
		byLane[p.Team+"_"+p.Lane] = append(byLane[p.Team+"_"+p.Lane], p)
	}
	for _, group := range byLane {
		sort.Slice(group, func(i, j int) bool { return group[i].NW10 > group[j].NW10 })
		for i, p := range group {
			if i == 0 {
				p.LaneRole = "core"
			} else {
				p.LaneRole = "support"
			}
		}
	}
}

func detectTeamfights(kills []Kill, players []*Player) []Teamfight {
	var fights []Teamfight
	if len(kills) == 0 {
		return fights
	}
	teamOf := map[string]string{}
	for _, p := range players {
		teamOf[p.Hero] = p.Team
	}
	cur := []Kill{kills[0]}
	flush := func() {
		if len(cur) < 3 {
			return
		}
		tf := Teamfight{StartMin: cur[0].Min, EndMin: cur[len(cur)-1].Min, Deaths: len(cur)}
		for _, k := range cur {
			tf.HeroesDied = append(tf.HeroesDied, k.Victim)
			switch teamOf[k.Victim] {
			case "radiant":
				tf.RadiantDie++
			case "dire":
				tf.DireDie++
			}
		}
		tf.Winner = "dire"
		if tf.DireDie > tf.RadiantDie {
			tf.Winner = "radiant"
		} else if tf.DireDie == tf.RadiantDie {
			tf.Winner = "draw"
		}
		fights = append(fights, tf)
	}
	for _, k := range kills[1:] {
		if (k.Min-cur[len(cur)-1].Min)*60 <= 20 {
			cur = append(cur, k)
		} else {
			flush()
			cur = []Kill{k}
		}
	}
	flush()
	return fights
}

func isCreep(n string) bool {
	return strings.HasPrefix(n, "npc_dota_creep") ||
		strings.HasPrefix(n, "npc_dota_neutral") ||
		strings.Contains(n, "_siege")
}

// Крип принадлежит команде атакующего -> это деней.
func sameTeam(creep string, attackerTeam uint32) bool {
	if strings.Contains(creep, "goodguys") {
		return attackerTeam == 2
	}
	if strings.Contains(creep, "badguys") {
		return attackerTeam == 3
	}
	return false
}

func isConsumable(item string) bool {
	switch item {
	case "item_tango", "item_clarity", "item_flask", "item_enchanted_mango", "item_branches",
		"item_ward_observer", "item_ward_sentry", "item_ward_dispenser", "item_smoke_of_deceit",
		"item_dust", "item_tpscroll", "item_bottle", "item_faerie_fire", "item_blood_grenade":
		return true
	}
	return strings.HasPrefix(item, "item_recipe_")
}

func teamName(t uint32) string {
	if t == 2 {
		return "radiant"
	}
	return "dire"
}

// CDOTA_Unit_Hero_CrystalMaiden -> crystal_maiden.
// У части героев подчёркивание в имени класса уже есть (Void_Spirit, Legion_Commander),
// поэтому второе подряд не добавляем.
func classToHero(cn string) string {
	n := strings.TrimPrefix(cn, "CDOTA_Unit_Hero_")
	var b strings.Builder
	for i, r := range n {
		if r >= 'A' && r <= 'Z' {
			if i > 0 && n[i-1] != '_' {
				b.WriteByte('_')
			}
			b.WriteRune(r + 32)
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func short(n string) string { return strings.TrimPrefix(n, "npc_dota_hero_") }

func round(f float64, d int) float64 {
	p := 1.0
	for i := 0; i < d; i++ {
		p *= 10
	}
	return float64(int(f*p+0.5)) / p
}
