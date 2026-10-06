import assert from 'node:assert/strict';
import fs from 'node:fs';
import {type AdviceContext} from './advice-context.js';
import {supportedMatchups} from './advice-matchups.js';
import {validateAdvice} from './advice-model.js';
import {renderLiveAdvice} from './web/live-advice-render.js';
import {adviceText} from './advice-command.js';
import type {AdviceState} from './live-advice.js';
const fixture=JSON.parse(fs.readFileSync(new URL('../docs/research/advice-review/live-case-9032160861.json',import.meta.url),'utf8'));
// Real projected input: ours are Dire, CM/SF/Lion are Radiant.
const context:AdviceContext={...fixture.context,players:[fixture.context.players[0]]};
const player=context.players[0];
const supported=supportedMatchups(context,player,'black_king_bar');
assert.deepEqual(supported.map(m=>m.heroId),[5,11,26]);
assert.deepEqual(supportedMatchups(context,player,'monkey_king_bar').map(m=>m.heroId),[44]);
const choice={players:[{account:player.account,optionId:'black_king_bar-v1',alternativeId:null,matchupIds:['bkb-cm-frostbite','bkb-sf-requiem']}]};
const result=validateAdvice(choice,context);
assert.deepEqual(result.players[0].threatHeroIds,[5,11]);
assert.ok(result.players[0].matchups?.[1].why.includes('Физические атаки SF остаются опасны'));
const wrongSide={...context,players:[{...player,allies:[...player.allies,{heroId:5,hero:'Crystal Maiden'}]}]};
assert.throws(()=>validateAdvice(choice,wrongSide));
const changed=structuredClone(context);
const cm=changed.teams.flatMap(t=>t.players).find(p=>p.heroId===5)!;
cm.possibleAbilities.find(a=>a.name==='Frostbite')!.piercesDebuffImmunity='Yes';
assert.throws(()=>validateAdvice(choice,changed),'changed mechanics remove unsupported matchup');
for(const ids of [[],['bkb-cm-frostbite','bkb-cm-frostbite'],['bkb-cm-frostbite','bkb-sf-requiem','bkb-lion-spike'],['bkb-spirit-breaker-bash'],['glimmer-cm-field']]){
 assert.throws(()=>validateAdvice({players:[{...choice.players[0],matchupIds:ids}]},context));
}
assert.throws(()=>validateAdvice({players:[{...choice.players[0],reason:'BKB stops every spell'}]},context));
assert.deepEqual(supportedMatchups({...context,knowledgeRevision:'changed'},player,'black_king_bar'),[]);
const item=player.candidates.find(c=>c.id===result.players[0].itemId)!;
const state:AdviceState={status:'ready',advice:{matchId:context.matchId,snapshotAt:context.snapshotAt,generatedAt:context.snapshotAt,gameTime:context.gameTime,delay:null,gameMode:23,knowledgeRevision:context.knowledgeRevision,statisticsAt:null,plan:'',cards:[{account:player.account,name:'Test',hero:player.hero,item,reason:result.players[0].reason,alternative:null,alternativeReason:'',matchups:result.players[0].matchups}]}};
const html=renderLiveAdvice(state),telegram=adviceText(state);
for(const text of [html,telegram]){

 assert.ok(text.includes('Requiem'));
 assert.ok(!text.includes('Ближайшая часть'));
}
for(const hero of ['Crystal Maiden','Shadow Fiend']){
 assert.ok(html.includes(`alt="${hero}" title="${hero}"`));
 assert.ok(!html.includes(`vs ${hero}`));
 assert.ok(telegram.includes(`vs ${hero}`));
}
console.log('Matchup explanations: real enemy identities, source drift, wrong item/ally, free-text injection, website and Telegram passed.');
