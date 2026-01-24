# Product Requirements Document

## Overview

Telegram bot that sends daily Dota 2 win/loss statistics for a group of 7 players using OpenDota API data.

## Goals

- Automatically send daily stats to a Telegram chat at the end of each day
- Track wins and losses for each player from the configured list
- Show percentage and total matches played

## Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **Bot Framework**: grammy
- **HTTP Client**: fetch (built-in)
- **Scheduler**: node-cron
- **Deploy**: Railway (free tier)

## Players

| Steam ID   | OpenDota Link                                |
|------------|----------------------------------------------|
| 93921511   | https://www.opendota.com/players/93921511    |
| 167818283  | https://www.opendota.com/players/167818283   |
| 94014640   | https://www.opendota.com/players/94014640    |
| 1869377945 | https://www.opendota.com/players/1869377945  |
| 126449680  | https://www.opendota.com/players/126449680   |
| 92126977   | https://www.opendota.com/players/92126977    |
| 40087920   | https://www.opendota.com/players/40087920    |

## Features

### Tracer Bullet 1: End-to-end for ONE player (console output)

- [x] Set up project (package.json, tsconfig, .env.example) and fetch ONE player's matches from OpenDota, calculate W/L for today, print to console

### Tracer Bullet 2: Telegram integration

- [x] Send the stats message to Telegram chat (hardcoded one player)

### Phase 1: Full MVP

- [x] Add all 7 players with config module
- [x] Format beautiful message with all players stats
- [x] Add cron job for daily stats at 23:55 MSK
- [x] Add Dockerfile and railway.json for deployment

### Phase 2: Enhancements

- [x] Add /stats command for manual stats request
- [ ] Show heroes played in statistics
- [ ] Add weekly/monthly reports
- [ ] Display player nicknames instead of IDs

## Non-Goals

- Real-time match notifications
- Match history storage/database
- Web interface
- Multiple chat support (single chat only for MVP)

## Technical Notes

### OpenDota API

Endpoint: `GET https://api.opendota.com/api/players/{account_id}/recentMatches`

Returns last 20 matches with:
- `match_id` - match identifier
- `player_slot` - player slot (0-127 = Radiant, 128-255 = Dire)
- `radiant_win` - whether Radiant won
- `start_time` - Unix timestamp of match start

Win detection: `(player_slot < 128) === radiant_win`

### Project Structure

```
src/
├── config.ts      # Configuration (player IDs, bot token)
├── opendota.ts    # OpenDota API client
├── stats.ts       # Stats calculation logic
├── formatter.ts   # Message formatting
├── bot.ts         # Telegram bot setup
└── index.ts       # Entry point with cron
```

### Example Output

```
📊 Dota Stats for 24.01.2026

🎮 Player1: 3W / 1L (75%)
🎮 Player2: 2W / 2L (50%)
🎮 Player3: 0W / 0L (did not play)
...

Total matches: 8
```

## Definition of Done

- [ ] All Phase 1 features implemented
- [ ] Bot successfully sends daily stats
- [ ] Deployed to Railway and running
