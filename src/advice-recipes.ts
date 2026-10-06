import {supportedMatchups,type AdviceMatchup} from './advice-matchups.js';
import {createHash} from 'node:crypto';
import {KNOWLEDGE_REVISION,type AdviceItem} from './advice-sources.js';
import type {AdviceContext,AdvicePlayerContext} from './advice-context.js';

export const RECIPE_REVISION='decision-recipes-v2';
export interface AdviceRecipe {id:string;key:string;goal:string;reason:string;sourceHash:string;}
// Source-bound general plans, not verified current-patch counter matchups.
// Source changes disable the affected recipe until its claims are reviewed.
export const ADVICE_RECIPES:readonly AdviceRecipe[]=[
  {
    "id": "black_king_bar-v1",
    "key": "black_king_bar",
    "goal": "Пережить воздействие заклинаний",
    "reason": "Если мешают эффекты, не пробивающие невосприимчивость к дебаффам, BKB даёт окно для действий. Пробивающий контроль остаётся угрозой. Это выбор защиты вместо следующего предмета на урон.",
    "sourceHash": "079e5248b5d6569fa7b9f317a87ab3cd98ee866b2979372a4d70f821a42118b6"
  },
  {
    "id": "force_staff-v1",
    "key": "force_staff",
    "goal": "Изменить позицию себя или союзника",
    "reason": "Если важнее дистанция, Force Staff позволяет сдвинуть себя или союзника по направлению взгляда. Не вытаскивает из Chronosphere, Duel и Black Hole. Выбирай ради позиции, а не иммунитета или урона.",
    "sourceHash": "6ef0e0015612ac3884e81398da976642106f6dcab8ee9ae87eea4f2e01c14665"
  },
  {
    "id": "glimmer_cape-v1",
    "key": "glimmer_cape",
    "goal": "Защищать себя или союзника от магического урона",
    "reason": "Если нужен сейв от магического урона, Glimmer даёт себе или союзнику магический барьер и невидимость. Это защитный вариант вместо наращивания урона; он не гарантирует спасение.",
    "sourceHash": "fd8cfb2f0db8873e1ff1fb8fbbee0bae50f6da3508afce4c12edb56ddf09aaad"
  },
  {
    "id": "guardian_greaves-v1",
    "key": "guardian_greaves",
    "goal": "Восстанавливать ресурсы в групповых драках",
    "reason": "Если играете вместе и нужны ресурсы, Greaves восстанавливают здоровье и ману рядом стоящим союзникам. Базовый диспел — только владельцу. Ради снятия контроля с союзника этот вариант не подходит.",
    "sourceHash": "685a1ebd6662113f68cbdb5e2d553e9210c6e9b343dfd023efdc09a38a7cca89"
  },
  {
    "id": "hurricane_pike-v1",
    "key": "hurricane_pike",
    "goal": "Совместить дистанцию и атаки",
    "reason": "Если план — наносить урон дальними атаками и держать дистанцию, Pike совмещает дальность атаки с отталкиванием. Не вытаскивает из Chronosphere, Duel и Black Hole. Чистое усиление урона придётся отложить.",
    "sourceHash": "ec75faf51fc6c22b74cfcda5484b304d23c57c564bc11fc4056e9829145f3122"
  },
  {
    "id": "sheepstick-v1",
    "key": "sheepstick",
    "goal": "Добавить активный контроль цели",
    "reason": "Если команде нужен дополнительный контроль, Hex временно лишает цель атак и применения способностей и предметов. Это дорогой контроль вместо прямого усиления урона; срабатывание на любой цели не гарантировано.",
    "sourceHash": "9b4cc8ff790bd0aa00f20ec49b58a1cdf7d7c96b87083b61c2f4707d879de90c"
  },
  {
    "id": "orchid-v1",
    "key": "orchid",
    "goal": "Ловить цель с помощью безмолвия",
    "reason": "Если план — ловить цели с помощью безмолвия, Orchid добавляет такой инструмент. Сам по себе silence не запрещает использовать предметы. Выбор на активное давление, а не универсальный ответ любой цели.",
    "sourceHash": "10deaee6a8ac397b6f51d0fb59d290933460c03e7da51b27c06591246561eaaa"
  },
  {
    "id": "desolator-v1",
    "key": "desolator",
    "goal": "Давить физическими атаками и на строения",
    "reason": "Если можешь регулярно атаковать, Desolator снижает броню атакуемой цели; снижение работает и на строения. Это ставка на физическое давление вместо защиты и доступа к цели.",
    "sourceHash": "0fa3edb96050f22da9d756e40ce32effadfd597fd1bf23da3227895724e609f3"
  },
  {
    "id": "maelstrom-v1",
    "key": "maelstrom",
    "goal": "Усилить атаки и зачистку групп",
    "reason": "Если план — больше фармить атаками, Maelstrom добавляет срабатывания цепной молнии по нескольким целям. Это вложение в зачистку и урон вместо немедленного защитного предмета.",
    "sourceHash": "22d18af485b56c304b63dca223448f7d2bc2c096d2e7258f2740f4ea4b8d280f"
  },
  {
    "id": "blink-v1",
    "key": "blink",
    "goal": "Получить доступ к цели первым",
    "reason": "Если нужен вход с неожиданной дистанции, Blink даёт перемещение к точке. После урона от вражеского героя или Roshan он временно недоступен: покупай ради входа, не гарантированного выхода из драки.",
    "sourceHash": "ea10dfedd24735df51c1baf5bf69999d0ca81a04a03385007cccf4cefdb760ae"
  },
  {
    "id": "aether_lens-v1",
    "key": "aether_lens",
    "goal": "Применять способности с большей дистанции",
    "reason": "Если задача — применять способности с большей дистанции, Aether Lens увеличивает дальность применения. Это позиционирование вместо активного сейва; доступ к конкретной цели всё равно нужно оценить.",
    "sourceHash": "ae8b9c88bdd9c509a3f1abc2040f673589d84387394c70e9e8330e25fa4097b0"
  },
  {
    "id": "monkey_king_bar-v1",
    "key": "monkey_king_bar",
    "goal": "Снижать проблему уклонения при атаках",
    "reason": "Если подтверждённая проблема — уклонение, MKB даёт атакам шанс его пробить. Это не гарантия каждого попадания. Без такой задачи сравни с обычным усилением урона или защитой.",
    "sourceHash": "f3491fea77bd2f56836e347aa29a547c4971d5bcc5f126e07bc3b01df8eada15"
  },
  {
    "id": "diffusal_blade-v1",
    "key": "diffusal_blade",
    "goal": "Удерживать цель для атак и выжигать ману",
    "reason": "Если план — держаться рядом с целью и атаковать, Diffusal даёт активное замедление и выжигание маны атаками. Это давление вместо защиты; иллюзии ману не выжигают. Возможность бить цель всё равно нужна.",
    "sourceHash": "5c733e650a61072687eb0eb5d83c7b3961631ca8d73437d6e8a43986dd79a9ca"
  }
];
export const RECIPE_ITEM_KEYS=new Set(ADVICE_RECIPES.map(r=>r.key));
export function mechanicsHash(item:AdviceItem):string {
 return createHash('sha256').update(JSON.stringify([item.id,item.description,item.notes,item.attributes])).digest('hex');
}
export interface AdviceOption {matchups:AdviceMatchup[];id:string;itemId:number;goal:string;reason:string;sourceRevision:string;patchStatus:'unknown';}
export function playerOptions(context:AdviceContext,player:AdvicePlayerContext):AdviceOption[]{
 if(context.knowledgeRevision!==KNOWLEDGE_REVISION)return [];
 return ADVICE_RECIPES.flatMap(recipe=>{
  const item=player.candidates.find(c=>c.key===recipe.key);
  if(!item||mechanicsHash(item)!==recipe.sourceHash)return [];
  // Range and mana-burning attack plans require hero-specific relevance.
  // Until explicit player intent exists, require a hero-specific prior or a
  // visible component. This is eligibility evidence, not proof of best purchase.
  if(['aether_lens','diffusal_blade'].includes(recipe.key)&&!(item.purchases&&item.purchases>0)&&!item.ownedComponents.length)return [];
  return [{matchups:supportedMatchups(context,player,item.key),id:recipe.id,itemId:item.id,goal:recipe.goal,reason:recipe.reason,sourceRevision:context.knowledgeRevision,patchStatus:'unknown' as const}];
 });
}
