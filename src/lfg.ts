import type { Bot } from "grammy";
import {
  getPlayerSummaries,
  isPlayingDota,
  type SteamPlayer,
} from "./steam.js";
import { config, PLAYER_IDS, PLAYERS } from "./config.js";
import { formatStackStatus, getStackStatusFromSummaries } from "./status.js";

// Polling interval: check every 3 minutes
const POLLING_INTERVAL_MS = 3 * 60 * 1000;

// Cooldown: don't notify about the same player more than once per 2 hours
const NOTIFICATION_COOLDOWN_MS = 2 * 60 * 60 * 1000;

// Track last notification time for each player
const lastNotificationTime = new Map<number, number>();

// Track previous "in Dota" state to detect transitions
const wasPlayingDota = new Map<number, boolean>();

// Warm-up flag: first poll only records state, doesn't send notifications
// This prevents spam when bot restarts while players are already in Dota
let isWarmupComplete = false;

// Stats for health logging
let pollCount = 0;
let notificationsSent = 0;

/**
 * Gets stats for health check logging
 */
export function getLfgStats(): {
  pollCount: number;
  notificationsSent: number;
} {
  return { pollCount, notificationsSent };
}

/**
 * Checks if a player notification is on cooldown
 */
function isOnCooldown(playerId: number): boolean {
  const lastTime = lastNotificationTime.get(playerId);
  if (!lastTime) return false;
  return Date.now() - lastTime < NOTIFICATION_COOLDOWN_MS;
}

/**
 * Records that a notification was sent for a player
 */
function recordNotification(playerId: number): void {
  lastNotificationTime.set(playerId, Date.now());
  notificationsSent++;
}

/**
 * Random call-to-action messages for LFG notifications
 */
const LFG_MESSAGES = [
  "Кто готов сосать?",
  "Ищет жертв для катки",
  "Го кормить?",
  "Нужны тиммейты для лузстрика",
  "Собираем пати неудачников",
  "Пора фидить!",
  "Кому ещё нечего делать?",
  "Давай сюда, будет весело (нет)",
  "Кто готов к тильту?",
  "Погнали сливать!",
  "Кому не жалко вечер?",
  "Собираем стак для страданий",
  "Кто ещё не наигрался в это говно?",
  "Го обосрёмся вместе!",
  "Нужен кто-то, кого можно обвинить в проигрыше",
  "Кто хочет послушать как я ору на саппортов?",
  "Ищу 4 лохов в стак",
  "Кому ночью не спится? Давай страдать!",
  "Го потеем?",
  "Кто хочет поднять давление?",
  "Собираем пати для группового мазохизма",
  "Места в команде неудачников ещё есть!",
  "Кто готов орать 'ГДЕ ВАРДЫ'?",
  "Ищу собутыльников для дотки",
  "Кто хочет поиграть в 'угадай кто сольёт'?",
  "Го руинить друг другу катки!",
  "Пати для тех, кому завтра не на работу",
  "Кто готов к 50 минутам боли?",
  "Ищу друзей по несчастью",
  "Го в доту, пока жена не видит!",
  "Кто хочет вспомнить почему бросил эту игру?",
  "Собираем токсиков в стак!",
  "Нужны люди для командного отсоса",
  "Го поднимать давление и ронять ммр?",
  "Кто хочет пофидить и поныть?",
  "Ищу с кем поругаться после катки",
  "Давай в доту, там хорошо (врёт)",
  "Пойдём проверим кто из нас хуже играет",
  "Кто готов к анальной катке?",
  "Срочно нужны рандомы для отмазок",
];

/**
 * Gets a random LFG message
 */
function getRandomLfgMessage(): string {
  return LFG_MESSAGES[Math.floor(Math.random() * LFG_MESSAGES.length)];
}

/**
 * Formats the LFG notification message
 */
function formatLfgMessage(player: SteamPlayer): string {
  return `🎮 <b>${escapeHtml(player.personaname)}</b> запустил Dota 2!\n${getRandomLfgMessage()}`;
}

/**
 * Escapes HTML special characters for Telegram
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Checks all players and sends notifications for those who just launched Dota
 */
async function checkPlayersAndNotify(bot: Bot, chatId: string): Promise<void> {
  pollCount++;

  try {
    const players = await getPlayerSummaries(PLAYER_IDS, config.steamApiKey);

    // During warm-up phase, only record current state without sending notifications
    // This prevents spam when bot restarts while players are already in Dota
    if (!isWarmupComplete) {
      console.log("[LFG] Warm-up phase: recording initial player states");
      for (const [playerId, player] of players) {
        const isInDota = isPlayingDota(player);
        wasPlayingDota.set(playerId, isInDota);
        if (isInDota) {
          // Also set cooldown for players already in Dota to prevent immediate notification
          // if they briefly disconnect and reconnect
          lastNotificationTime.set(playerId, Date.now());
          console.log(
            `[LFG] ${player.personaname} already in Dota, setting cooldown`,
          );
        }
      }
      isWarmupComplete = true;
      console.log("[LFG] Warm-up complete, notifications enabled");
      return;
    }

    // Fetch match details only if a notification is due, once for this poll.
    let statusPromise: Promise<string> | undefined;
    const statusForNotification = () => statusPromise ??= getStackStatusFromSummaries(players)
      .catch(() => formatStackStatus(PLAYERS, players, new Map(), true));

    for (const [playerId, player] of players) {
      const isInDota = isPlayingDota(player);
      const wasInDota = wasPlayingDota.get(playerId) ?? false;

      // Detect transition: not in Dota -> in Dota
      if (isInDota && !wasInDota) {
        console.log(
          `[LFG] ${player.personaname} (${playerId}) launched Dota 2`,
        );

        // Check cooldown before sending notification
        if (!isOnCooldown(playerId)) {
          console.log(`[LFG] Sending notification for ${player.personaname}`);
          try {
            const status = await statusForNotification();
            await bot.api.sendMessage(chatId, `${formatLfgMessage(player)}\n\n${status}`, {
              parse_mode: "HTML",
            });
            recordNotification(playerId);
          } catch (error) {
            console.error(
              `[LFG] Failed to send notification for ${player.personaname}:`,
              error,
            );
          }
        } else {
          const remainingMs =
            NOTIFICATION_COOLDOWN_MS -
            (Date.now() - (lastNotificationTime.get(playerId) ?? 0));
          const remainingMin = Math.round(remainingMs / 60000);
          console.log(
            `[LFG] ${player.personaname} is on cooldown (${remainingMin} min remaining)`,
          );
        }
      }

      // Update state
      wasPlayingDota.set(playerId, isInDota);
    }
  } catch (error) {
    console.error("[LFG] Error checking player statuses:", error);
  }
}

/**
 * Starts the LFG polling loop
 * @param bot - Telegram bot instance
 * @param chatId - Chat ID to send notifications to
 */
export function startLfgPolling(bot: Bot, chatId: string): void {
  if (!config.steamApiKey) {
    console.warn(
      "[LFG] ⚠️ Steam API key not configured, LFG notifications disabled",
    );
    return;
  }

  console.log(
    `[LFG] 🎮 Starting LFG polling (every ${POLLING_INTERVAL_MS / 1000 / 60} minutes)`,
  );
  console.log(
    `[LFG] Notification cooldown: ${NOTIFICATION_COOLDOWN_MS / 1000 / 60 / 60} hours`,
  );
  console.log(`[LFG] Tracking ${PLAYER_IDS.length} players`);

  // Initial check
  checkPlayersAndNotify(bot, chatId);

  // Start polling loop
  setInterval(() => {
    checkPlayersAndNotify(bot, chatId);
  }, POLLING_INTERVAL_MS);
}
