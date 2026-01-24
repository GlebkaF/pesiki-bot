import cron from "node-cron";
import { PLAYER_IDS } from "./config.js";
import { fetchRecentMatches, fetchPlayerProfile, fetchPlayerTotals } from "./opendota.js";
import { calculateStats, type PlayerStats, type StatsPeriod } from "./stats.js";
import { createBot, sendMessage, setupCommands, startBot } from "./bot.js";
import { formatStatsMessage, stripHtml } from "./formatter.js";

// Health check configuration
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const startTime = Date.now();
let commandsReceived = 0;
let dailyStatsSent = 0;

/**
 * Formats uptime duration into human-readable string
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Logs health check status with uptime and stats
 */
function logHealthCheck(): void {
  const uptime = Date.now() - startTime;
  const memUsage = process.memoryUsage();
  const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
  
  console.log(
    `[HEALTH] ✅ Bot alive | Uptime: ${formatUptime(uptime)} | ` +
    `Commands: ${commandsReceived} | Daily stats sent: ${dailyStatsSent} | ` +
    `Memory: ${heapUsedMB}MB`
  );
}

/**
 * Increments the command counter (called from bot.ts via callback)
 */
export function incrementCommandCounter(): void {
  commandsReceived++;
}

/**
 * Increments the daily stats counter
 */
function incrementDailyStatsCounter(): void {
  dailyStatsSent++;
}

/**
 * Fetches player nickname from OpenDota API
 * Falls back to player ID if nickname is not available
 */
async function getPlayerName(playerId: number): Promise<string> {
  try {
    const playerData = await fetchPlayerProfile(playerId);
    return playerData.profile?.personaname || String(playerId);
  } catch (error) {
    console.warn(`Failed to fetch profile for player ${playerId}:`, error);
    return String(playerId);
  }
}

/**
 * Converts StatsPeriod to date parameter for OpenDota API
 * Returns number of days to look back
 */
function getPeriodDateParam(period: StatsPeriod): number {
  switch (period) {
    case "today":
      return 1;
    case "yesterday":
      return 2; // Includes yesterday and today
    case "week":
      return 7;
    case "month":
      return 30;
  }
}

/**
 * Fetches average APM for a player from OpenDota totals
 * Returns undefined if APM data is not available
 */
async function getPlayerAvgApm(playerId: number, period: StatsPeriod): Promise<number | undefined> {
  try {
    const dateParam = getPeriodDateParam(period);
    const totals = await fetchPlayerTotals(playerId, dateParam);
    const apmTotal = totals.find((t) => t.field === "actions_per_min");
    
    if (apmTotal && apmTotal.n > 0) {
      return Math.round(apmTotal.sum / apmTotal.n);
    }
    return undefined;
  } catch (error) {
    console.warn(`Failed to fetch APM for player ${playerId}:`, error);
    return undefined;
  }
}

/**
 * Fetches stats for all configured players for a given period
 */
async function fetchAllPlayersStats(
  period: StatsPeriod = "today"
): Promise<PlayerStats[]> {
  const statsPromises = PLAYER_IDS.map(async (playerId) => {
    console.log(`Fetching data for player ${playerId}...`);
    
    // Fetch profile, matches, and APM in parallel
    const [playerName, matches, avgApm] = await Promise.all([
      getPlayerName(playerId),
      fetchRecentMatches(playerId),
      getPlayerAvgApm(playerId, period),
    ]);
    
    console.log(`  Player: ${playerName}, Found ${matches.length} recent matches, APM: ${avgApm ?? "N/A"}`);
    return calculateStats(playerId, playerName, matches, period, avgApm);
  });

  return Promise.all(statsPromises);
}

/**
 * Fetches stats and returns formatted message for a given period
 */
async function getFormattedStats(period: StatsPeriod = "today"): Promise<string> {
  console.log(`Fetching ${period} stats for ${PLAYER_IDS.length} players...`);
  const allStats = await fetchAllPlayersStats(period);
  console.log("Fetching hero names...");
  return await formatStatsMessage(allStats, period);
}

/**
 * Sends daily stats to Telegram (used by cron job)
 */
async function sendDailyStats(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Sending daily stats...`);

  try {
    const message = await getFormattedStats("yesterday");

    // Print to console
    console.log("\n" + stripHtml(message) + "\n");

    // Send to Telegram
    console.log("Sending message to Telegram...");
    const bot = createBot();
    await sendMessage(bot, message);
    console.log("Message sent successfully!");
    incrementDailyStatsCounter();
  } catch (error) {
    console.error("[ERROR] Failed to send daily stats:", error);
  }
}

/**
 * Main entry point: Set up cron job and bot commands
 * Cron expression: 0 4 * * * = 04:00 UTC = 07:00 MSK
 */
async function main(): Promise<void> {
  console.log("🤖 Pesiki Bot starting...");
  console.log(`[STARTUP] Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`[STARTUP] Timezone: ${process.env.TZ || "not set (using system default)"}`);
  console.log(`[STARTUP] Configured players: ${PLAYER_IDS.length}`);
  console.log(`[STARTUP] Health check interval: ${HEALTH_CHECK_INTERVAL_MS / 1000}s`);

  // Create bot instance
  const bot = createBot();

  // Set up /stats command handler with callback to track commands
  setupCommands(bot, getFormattedStats, incrementCommandCounter);

  // Schedule daily stats at 07:00 MSK (04:00 UTC)
  console.log("📅 Daily stats scheduled for 07:00 MSK (04:00 UTC)");
  cron.schedule("0 4 * * *", () => {
    sendDailyStats();
  });

  // Start periodic health check logging
  setInterval(logHealthCheck, HEALTH_CHECK_INTERVAL_MS);
  console.log(`[STARTUP] Health check logging started (every ${HEALTH_CHECK_INTERVAL_MS / 1000 / 60} minutes)`);

  // Send stats immediately if RUN_NOW environment variable is set (for testing)
  if (process.env.RUN_NOW === "true") {
    console.log("🚀 RUN_NOW=true detected, sending stats immediately...");
    await sendDailyStats();
  }

  // Log initial health check before starting blocking bot polling
  console.log("[STARTUP] ✅ Bot initialization complete");
  logHealthCheck();

  // Start bot to listen for commands (this blocks)
  await startBot(bot);
}

main();
