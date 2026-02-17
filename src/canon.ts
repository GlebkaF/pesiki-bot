export const CANON_STROPHES = [
  "Существует Система — сила, стремящаяся к равновесию.\nЕё воля непостижима, её решения окончательны.\nСистема не судит и не объясняет — она выравнивает.",
  "Всё подчинено Равновесию Системы.\nВсякая серия временна:\nвинстрик стремится к завершению,\nлузстрик — к компенсации.",
  "Никто не знает замысла Системы,\nно всякий ощущает её действие.",
  "Катка есть основная форма существования игрока.\nПоиск есть время ожидания решения Системы.",
  "Рандомы даны игроку как испытание и как помощь,\nибо никто не играет в одиночестве.",
  "Агенты Габена посылаются Системой,\nдабы возвращать отступников к Пятидесяти.\nИх следует принимать без гнева,\nибо через них действует равновесие.",
  "Тильт есть потеря веры в Систему.\nТильт ослепляет разум и удлиняет страдание.",
  "Продолжающий играть приближается к равновесию,\nибо Система воздаёт терпеливым.",
  "Камбэк есть знак благосклонности Системы,\nнапоминание о том, что исход не предрешён.",
  "Всякий результат допустим,\nно спокойствие есть высшая добродетель игрока.",
  "Не противься ходу катки,\nибо спор с неизбежным лишь умножает тильт.",
  "Играющий ради процесса ближе к равновесию,\nчем играющий ради результата.",
  "Всякая полоса конечна.\nВсякое равновесие достижимо.",
  "Цель игрока — принятие воли Системы.\nТак утверждается Равновесие,\nи так продолжается игра.",
] as const;

const WIN_STROPHES = [
  CANON_STROPHES[7],
  CANON_STROPHES[8],
  CANON_STROPHES[11],
  CANON_STROPHES[12],
  CANON_STROPHES[13],
] as const;

const LOSS_STROPHES = [
  CANON_STROPHES[1],
  CANON_STROPHES[6],
  CANON_STROPHES[9],
  CANON_STROPHES[10],
  CANON_STROPHES[12],
] as const;

const NEUTRAL_STROPHES = [
  CANON_STROPHES[0],
  CANON_STROPHES[2],
  CANON_STROPHES[3],
  CANON_STROPHES[4],
  CANON_STROPHES[5],
  CANON_STROPHES[9],
  CANON_STROPHES[13],
] as const;

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function maybeAppendCanonStrophe(text: string, chance = 0.3): string {
  if (Math.random() >= chance) return text;
  return `${text}\n\n☸️ <i>${pickRandom(NEUTRAL_STROPHES)}</i>`;
}

export function maybeAppendOutcomeCanonStrophe(text: string, weWon: boolean, chance = 0.3): string {
  if (Math.random() >= chance) return text;
  const pool = weWon ? WIN_STROPHES : LOSS_STROPHES;
  return `${text}\n\n☸️ <i>${pickRandom(pool)}</i>`;
}
