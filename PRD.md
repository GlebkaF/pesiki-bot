# Product Requirements Document

## Overview

Deploy the Pesiki Bot (Dota 2 statistics Telegram bot) to Railway platform.

## Goals

- Deploy the bot to Railway with all environment variables configured
- Ensure the bot runs continuously and sends daily stats at 23:55 MSK
- Verify deployment works end-to-end

## Tech Stack

- **Runtime**: Node.js 20+ (Alpine)
- **Build**: Multi-stage Dockerfile
- **Platform**: Railway (free tier)
- **Bot**: grammy + node-cron

## Project Status

The bot is fully implemented with:
- Daily stats at 23:55 MSK via cron
- /stats, /weekly, /monthly commands
- Hero names and player nicknames display
- Beautiful formatted messages with emojis

## Features

### Phase 1: Railway Deployment

- [ ] Verify local build works (npm run build && npm start)
- [ ] Initialize git repository and create initial commit
- [ ] Create Railway account and project
- [ ] Connect GitHub/GitLab repo to Railway (or use Railway CLI)
- [ ] Configure environment variables on Railway:
  - BOT_TOKEN (from @BotFather)
  - CHAT_ID (target Telegram chat)
  - TZ=Europe/Moscow
- [ ] Deploy and verify bot starts successfully
- [ ] Test /stats command to verify bot is responding
- [ ] Verify cron job works (check logs around 23:55 MSK)

### Phase 2: Monitoring & Maintenance

- [ ] Set up Railway alerts for deployment failures
- [ ] Add health check logging
- [ ] Document deployment process in README

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| BOT_TOKEN | Telegram bot token from @BotFather | Yes |
| CHAT_ID | Target Telegram chat ID | Yes |
| TZ | Timezone for cron (Europe/Moscow) | Yes |
| RUN_NOW | Set to "true" to send stats immediately on start | No |

## Railway Configuration

The project already includes:
- `Dockerfile` - Multi-stage build (builder → production)
- `railway.json` - Dockerfile builder with restart policy

## Deployment Steps (Manual)

1. Create Railway account at https://railway.app
2. Create new project → Deploy from GitHub
3. Connect your repository
4. Add environment variables in Settings → Variables
5. Deploy

## Alternative: Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Set variables
railway variables set BOT_TOKEN=your_token
railway variables set CHAT_ID=your_chat_id
railway variables set TZ=Europe/Moscow

# Deploy
railway up
```

## Definition of Done

- [ ] Bot is deployed and running on Railway
- [ ] Bot responds to /stats command
- [ ] Daily stats are sent at 23:55 MSK
