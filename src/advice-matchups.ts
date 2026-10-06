import {createHash} from 'node:crypto';
import {KNOWLEDGE_REVISION,type AdviceAbility} from './advice-sources.js';
import type {AdviceContext,AdvicePlayerContext} from './advice-context.js';
export interface AdviceMatchup {id:string;heroId:number;hero:string;ability:string;why:string;}
interface MatchupRule {id:string;item:string;heroId:number;ability:string;hash:string;why:string;}
// Narrow, source-bound base-ability interactions. Never infer learned levels,
// cooldowns, actual causes of deaths or a counter to the entire hero.
const RULES:readonly MatchupRule[]=[
 {id:'mkb-pa-evasion',item:'monkey_king_bar',heroId:44,ability:'Immaterial',hash:'06be68a6408156675be346792eb0fcecb5f61d23ba7c27a4b2f414486193c9ba',why:'Immaterial даёт PA уклонение. MKB помогает проводить атаки через него, но не гарантирует каждое попадание.'},
 {id:'bkb-cm-frostbite',item:'black_king_bar',heroId:5,ability:'Frostbite',hash:'46237e2d6d9968dc1a7714607e28c30e721a80e474672241d5743698d81344f5',why:'Frostbite не удерживает во время BKB. План — сохранить возможность действовать под контролем CM.'},
 {id:'bkb-sf-requiem',item:'black_king_bar',heroId:11,ability:'Requiem of Souls',hash:'2d64683d224e1a7fe8dc98d34a54fa166a499c07b182f4048f6d93bbd6e78f90',why:'Заранее включённый BKB защищает от страха Requiem, пока действует. Физические атаки SF остаются опасны.'},
 {id:'bkb-lion-spike',item:'black_king_bar',heroId:26,ability:'Earth Spike',hash:'b2aee5609b3111a98225b906c1f596a0cf2d32ae783e6fd259c1a3b9abe9f07e',why:'Заранее включённый BKB защищает от оглушения Earth Spike. Это окно для своих атак и заклинаний.'},
 {id:'glimmer-cm-field',item:'glimmer_cape',heroId:5,ability:'Freezing Field',hash:'995d5a0c4e71d5a1f1fc262c7237edbed2a3688bd9a26554601078ec02d711ee',why:'Магический барьер помогает пережить урон Freezing Field себе или союзнику. Канал CM он не прерывает.'},
 {id:'glimmer-sf-raze',item:'glimmer_cape',heroId:11,ability:'Shadowraze',hash:'0704a84aa4af94dac8759073e95e41f8f7c7fb87c3ebc45dcb7d17b805f3603a',why:'Барьер поглощает магический урон Shadowraze. От физических атак SF этот барьер не защищает.'},
 {id:'force-sf-spacing',item:'force_staff',heroId:11,ability:'Shadowraze',hash:'0704a84aa4af94dac8759073e95e41f8f7c7fb87c3ebc45dcb7d17b805f3603a',why:'Сменить дистанцию относительно Shadowraze. Направление толчка важно: Force не даёт иммунитета к урону.'}
];
export const MATCHUP_REVISION='draft-matchups-v1';
export function abilityHash(ability:AdviceAbility):string{return createHash('sha256').update(JSON.stringify(ability)).digest('hex');}
export function supportedMatchups(context:AdviceContext,player:AdvicePlayerContext,item:string):AdviceMatchup[]{
 if(context.knowledgeRevision!==KNOWLEDGE_REVISION)return [];
 return RULES.flatMap(rule=>{
  if(rule.item!==item)return [];
  const enemy=player.enemies.find(e=>e.heroId===rule.heroId);
  if(!enemy||player.allies.some(a=>a.heroId===rule.heroId)||player.heroId===rule.heroId)return [];
  const observed=context.teams.filter(t=>t.name!==player.team).flatMap(t=>t.players).find(p=>p.heroId===rule.heroId);
  if(!observed?.possibleAbilities.some(a=>a.name===rule.ability&&abilityHash(a)===rule.hash))return [];
  return [{id:rule.id,heroId:rule.heroId,hero:enemy.hero,ability:rule.ability,why:rule.why}];
 });
}
