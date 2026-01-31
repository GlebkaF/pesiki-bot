/**
 * Test script to send /analyze output directly to Telegram
 * Bypasses cache and uses fresh LLM call
 * 
 * Usage: OPENAI_API_KEY=your_key npx tsx send-analyze-test.ts
 */
import "dotenv/config";
import { Bot } from "grammy";
import OpenAI from "openai";
import { PLAYER_IDS } from "./src/config.js";
import { fetchRecentMatches, fetchPlayerProfile } from "./src/opendota.js";
import { getHeroName } from "./src/heroes.js";

const OPENDOTA_API_BASE = "https://api.opendota.com/api";
const OPENAI_MODEL = "gpt-5.2";

const LANE_NAMES: Record<number, string> = {
  1: "Safelane", 2: "Mid", 3: "Offlane", 4: "Jungle",
};

const ITEM_NAMES: Record<number, string> = {
  1: "Blink Dagger", 48: "Travel Boots", 50: "Phase Boots", 63: "Power Treads",
  65: "Tranquil Boots", 77: "Null Talisman", 81: "Wraith Band", 
  108: "Mekansm", 112: "Aether Lens", 116: "Vanguard", 135: "Skull Basher",
  139: "Manta Style", 141: "Assault Cuirass", 143: "Shiva's Guard",
  147: "Eye of Skadi", 152: "Black King Bar", 156: "Satanic",
  158: "Daedalus", 160: "Butterfly", 168: "Monkey King Bar",
  174: "Heaven's Halberd", 180: "Octarine Core", 196: "Aeon Disk",
  204: "Aghanim's Scepter", 206: "Refresher Orb", 208: "Desolator",
  214: "Lotus Orb", 218: "Ethereal Blade", 220: "Nullifier",
  223: "Silver Edge", 226: "Bloodthorn", 229: "Gleipnir", 231: "Swift Blink",
  232: "Arcane Blink", 235: "Witch Blade", 236: "Overwhelming Blink",
  240: "Meteor Hammer", 250: "Sange and Yasha", 263: "Wraith Pact",
  600: "Overwhelming Blink", 908: "Radiance", 1097: "Wind Waker", 1466: "Bloodstone",
};

interface MatchPlayer {
  account_id?: number;
  player_slot: number;
  hero_id: number;
  kills: number;
  deaths: number;
  assists: number;
  last_hits: number;
  denies: number;
  gold_per_min: number;
  xp_per_min: number;
  level: number;
  net_worth: number;
  hero_damage: number;
  tower_damage: number;
  hero_healing: number;
  item_0: number;
  item_1: number;
  item_2: number;
  item_3: number;
  item_4: number;
  item_5: number;
  personaname?: string;
  isRadiant: boolean;
  win: number;
  kda: number;
  lane?: number | null;
  lane_efficiency_pct?: number | null;
  obs_placed?: number | null;
  sen_placed?: number | null;
  stuns?: number | null;
  teamfight_participation?: number | null;
  benchmarks?: {
    gold_per_min?: { raw: number; pct: number };
    xp_per_min?: { raw: number; pct: number };
    hero_damage_per_min?: { raw: number; pct: number };
    last_hits_per_min?: { raw: number; pct: number };
  };
}

interface MatchDetails {
  match_id: number;
  duration: number;
  radiant_win: boolean;
  game_mode: number;
  players: MatchPlayer[];
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatBenchmark(pct: number): string {
  const percent = Math.round(pct * 100);
  if (percent >= 80) return `${percent}% 🔥`;
  if (percent >= 60) return `${percent}% ✅`;
  if (percent >= 40) return `${percent}%`;
  if (percent >= 20) return `${percent}% ⚠️`;
  return `${percent}% 💀`;
}

function getItemName(itemId: number): string {
  return ITEM_NAMES[itemId] || `Item#${itemId}`;
}

async function fetchMatchDetails(matchId: number): Promise<MatchDetails> {
  const response = await fetch(`${OPENDOTA_API_BASE}/matches/${matchId}`);
  return response.json();
}

async function findLastMatch() {
  let latest: { matchId: number; startTime: number; playerId: number } | null = null;
  
  for (const playerId of PLAYER_IDS) {
    try {
      const matches = await fetchRecentMatches(playerId as number);
      if (matches.length > 0 && (!latest || matches[0].start_time > latest.startTime)) {
        latest = { matchId: matches[0].match_id, startTime: matches[0].start_time, playerId: playerId as number };
      }
    } catch {}
  }
  
  if (!latest) return null;
  const profile = await fetchPlayerProfile(latest.playerId as any);
  return { matchId: latest.matchId, playerName: profile.profile?.personaname || String(latest.playerId) };
}

async function buildContext(match: MatchDetails): Promise<string> {
  const playerIdsSet = new Set<number>(PLAYER_IDS as readonly number[]);
  const ourPlayers = match.players.filter(p => p.account_id && playerIdsSet.has(p.account_id));
  
  const heroNames = new Map<number, string>();
  for (const p of match.players) {
    if (!heroNames.has(p.hero_id)) heroNames.set(p.hero_id, await getHeroName(p.hero_id));
  }
  
  const formatPlayer = (p: MatchPlayer, isOurs: boolean) => {
    const hero = heroNames.get(p.hero_id) || "Unknown";
    const name = p.personaname || "Anonymous";
    const items = [p.item_0, p.item_1, p.item_2, p.item_3, p.item_4, p.item_5]
      .filter(i => i > 0).map(getItemName).join(", ");
    
    let benchmarkInfo = "";
    if (p.benchmarks) {
      const b = p.benchmarks;
      benchmarkInfo = `\n    Benchmarks: GPM ${b.gold_per_min ? formatBenchmark(b.gold_per_min.pct) : "N/A"}, XPM ${b.xp_per_min ? formatBenchmark(b.xp_per_min.pct) : "N/A"}, Hero Dmg ${b.hero_damage_per_min ? formatBenchmark(b.hero_damage_per_min.pct) : "N/A"}, LH/min ${b.last_hits_per_min ? formatBenchmark(b.last_hits_per_min.pct) : "N/A"}`;
    }
    
    return `  ${isOurs ? "⭐ " : ""}${name} (${hero})${isOurs ? " [OUR PLAYER]" : ""}
    KDA: ${p.kills}/${p.deaths}/${p.assists} (${p.kda.toFixed(2)})
    GPM: ${p.gold_per_min} | XPM: ${p.xp_per_min} | Net Worth: ${p.net_worth.toLocaleString()}
    Hero Damage: ${p.hero_damage.toLocaleString()} | Tower Damage: ${p.tower_damage.toLocaleString()}
    Items: ${items || "None"}${benchmarkInfo}`;
  };
  
  const radiant = match.players.filter(p => p.isRadiant);
  const dire = match.players.filter(p => !p.isRadiant);
  
  return `MATCH: ${match.match_id} | Duration: ${formatDuration(match.duration)} | ${match.radiant_win ? "Radiant Win" : "Dire Win"}

RADIANT ${match.radiant_win ? "(WIN)" : "(LOSE)"}:
${radiant.map(p => formatPlayer(p, playerIdsSet.has(p.account_id as number))).join("\n\n")}

DIRE ${!match.radiant_win ? "(WIN)" : "(LOSE)"}:
${dire.map(p => formatPlayer(p, playerIdsSet.has(p.account_id as number))).join("\n\n")}

OUR PLAYERS: ${ourPlayers.map(p => p.personaname || "Anon").join(", ") || "None identified"}`;
}

const systemPrompt = `Ты — токсичный но полезный тренер по Dota 2 для группы друзей.
Твой стиль: прямой, жёсткий, с чёрным юмором, НО с конкретными полезными советами.

ВАЖНО: Фокус на игроках [OUR PLAYER] — их надо разобрать по косточкам.

Структура:

🎯 ВЕРДИКТ
1 предложение — почему продули/выиграли

👤 РАЗБОР ИГРОКОВ
Для каждого [OUR PLAYER]:
• Имя и герой
• Что делал хорошо
• Где накосячил (цифры, benchmarks)  
• Один совет

🤝 СИНЕРГИЯ
Как взаимодействовали наши игроки

💡 ГЛАВНЫЙ СОВЕТ
Один совет для команды

ФОРМАТИРОВАНИЕ:
- НЕ ИСПОЛЬЗУЙ Markdown (никаких ** или __)
- Только plain text + эмодзи 🔥 ✅ ⚠️ 💀
- Разделяй секции пустыми строками
- Используй • для списков

Правила:
- Benchmarks: 80%+ = 🔥, <30% = 💀
- Макс 250 слов
- Конкретика: "купи BKB" вместо "улучши билд"
- Русский со сленгом`;

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === "your_openai_api_key_here") {
    console.error("Set OPENAI_API_KEY!");
    process.exit(1);
  }
  
  console.log("Finding last match...");
  const lastMatch = await findLastMatch();
  if (!lastMatch) { console.error("No match found"); return; }
  
  console.log(`Found match ${lastMatch.matchId}`);
  const matchDetails = await fetchMatchDetails(lastMatch.matchId);
  const context = await buildContext(matchDetails);
  
  console.log("Calling GPT-5.2...");
  const openai = new OpenAI({ apiKey });
  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: context },
    ],
    max_completion_tokens: 1500,
  });
  
  const analysis = response.choices[0]?.message?.content || "No response";
  
  const matchUrl = `https://www.opendota.com/matches/${lastMatch.matchId}`;
  const header = `🔬 <b>Анализ матча</b> <a href="${matchUrl}">#${lastMatch.matchId}</a>
⏱ Длительность: ${formatDuration(matchDetails.duration)}
🎮 Результат: ${matchDetails.radiant_win ? "Radiant" : "Dire"} победил

`;
  
  const message = header + analysis;
  
  console.log("\n--- MESSAGE ---\n");
  console.log(message);
  
  // Send to Telegram
  const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
  const chatId = process.env.TELEGRAM_CHAT_ID!;
  
  console.log(`\nSending to chat ${chatId}...`);
  await bot.api.sendMessage(chatId, message, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
  
  console.log("✅ Sent!");
}

main().catch(console.error);
