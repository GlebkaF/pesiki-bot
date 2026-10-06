import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildAdviceContext} from './advice-context.js';
import {ADVICE_RECIPES,playerOptions} from './advice-recipes.js';
import {validateAdvice} from './advice-model.js';
import type {AdviceKnowledge} from './advice-sources.js';
import type {LiveMatch,LivePlayer} from './live-match.js';
const knowledge=JSON.parse(fs.readFileSync(new URL('../src/fixtures/advice-recipe-sources.json',import.meta.url),'utf8')) as AdviceKnowledge;
const now=Date.now();
const player=(account:number,ours=false):LivePlayer=>({account,ours,name:'Test',hero:ours?'Sniper':'Invoker',heroId:ours?35:74,slot:account-1,items:[],gold:2000,level:15});
const match:LiveMatch={matchId:'test',kind:'stack',stackCount:1,detailed:true,updatedAt:now,time:1000,gameMode:23,teams:[{name:'Radiant',players:Array.from({length:5},(_,i)=>player(i+1,i===0))},{name:'Dire',players:Array.from({length:5},(_,i)=>player(i+6))}],buildings:[],history:[]};
const lensId=knowledge.items.find(i=>i.key==='aether_lens')!.id;
const diffusalId=knowledge.items.find(i=>i.key==='diffusal_blade')!.id;
const context=buildAdviceContext(match,knowledge,new Map([[35,{heroId:35,counts:{[lensId]:1,[diffusalId]:1},fetchedAt:now,source:'test'}]]),now);
const noPrior=buildAdviceContext(match,knowledge,new Map(),now);
assert.ok(!playerOptions(noPrior,noPrior.players[0]).some(o=>o.id==='aether_lens-v1'),'range is not a generic spellcaster default');
const options=playerOptions(context,context.players[0]);
assert.equal(options.length,18,'all supported recipes with eligibility evidence survive candidate selection');
const choice={players:[{account:1,optionId:'guardian_greaves-v1',alternativeId:'desolator-v1',matchupIds:[]}]};
const good=validateAdvice(choice,context);
assert.ok(good.players[0].reason.includes('только владельцу'));
assert.ok(good.players[0].alternativeReason.includes('физическое давление'));
assert.equal(good.plan,'');
// Old free-text injection failures cannot cross the new production boundary.
const mutations=JSON.parse(fs.readFileSync(new URL('../docs/research/advice-review/validator-mutations.json',import.meta.url),'utf8'));
for(const mutation of mutations.results.filter((m:{id:string})=>m.id!=='legal_reference')){
 assert.throws(()=>validateAdvice({...choice,players:[{...choice.players[0],reason:mutation.reason??'invented',itemId:999,threatHeroIds:[]}]},context));
}
for(const invalid of [
 {...choice,plan:'У врага нет ульты'},
 {players:[{...choice.players[0],account:6}]},
 {players:[...choice.players,...choice.players]},
 {players:[]},
 {players:[{...choice.players[0],optionId:'invented'}]},
 {players:[{...choice.players[0],alternativeId:'guardian_greaves-v1'}]},
 {players:[{...choice.players[0],alternativeId:'invented'}]},
 {players:[{...choice.players[0],optionId:null}]}
])assert.throws(()=>validateAdvice(invalid,context));
assert.deepEqual(validateAdvice({players:[{account:1,optionId:null,alternativeId:null,matchupIds:[]}]},context),{players:[],plan:''});
const corrupted={...context,players:context.players.map(p=>({...p,candidates:p.candidates.map(c=>c.key==='guardian_greaves'?{...c,description:c.description+' strong team dispel'}:c)}))};
assert.throws(()=>validateAdvice(choice,corrupted),'source drift disables the recipe');
assert.equal(playerOptions({...context,knowledgeRevision:'unknown'},context.players[0]).length,0);
for(const recipe of ADVICE_RECIPES){
 const rendered=validateAdvice({players:[{account:1,optionId:recipe.id,alternativeId:null,matchupIds:[]}]},context);
 assert.equal(rendered.players[0].reason,recipe.reason);
 assert.ok(recipe.reason.length<320);
}
const natural=JSON.parse(fs.readFileSync(new URL('../docs/research/advice-review/live-case-9032160861.json',import.meta.url),'utf8')).context;
const invoker=natural.players.find((p:{hero:string})=>p.hero==='Invoker');
const riki=natural.players.find((p:{hero:string})=>p.hero==='Riki');
assert.ok(!playerOptions(natural,invoker).some(o=>o.id==='aether_lens-v1'),'real early Invoker case has no range-plan evidence');
assert.ok(playerOptions(natural,riki).some(o=>o.id==='diffusal_blade-v1'),'real Riki case must retain the supported Diffusal candidate');
console.log('Recipe boundary: 18 source-bound scenarios; free-text mutations, wrong actors/options, source drift, explicit abstention passed. Selection utility remains unevaluated.');

for(const [hero,keys] of [['Riki',['manta']],['Legion Commander',['blade_mail']],['Invoker',['witch_blade','spirit_vessel','rod_of_atos']]] as const){
 const player=natural.players.find((p:{hero:string})=>p.hero===hero);
 for(const key of keys)assert.ok(playerOptions(natural,player).some(o=>o.id===key+'-v1'),`${hero} can compare ${key} in recorded input`);
}
for(const key of ['manta','blade_mail','witch_blade','spirit_vessel','rod_of_atos']){
 const owned=structuredClone(match);owned.teams[0].players[0].items=[knowledge.items.find(i=>i.key===key)!.id];
 const ctx=buildAdviceContext(owned,knowledge,new Map(),now);
 assert.ok(!playerOptions(ctx,ctx.players[0]).some(o=>o.id===key+'-v1'),`owned ${key} must not be offered again`);
 const changed={...context,players:context.players.map(p=>({...p,candidates:p.candidates.map(c=>c.key===key?{...c,description:'changed mechanics'}:c)}))};
 assert.ok(!playerOptions(changed,changed.players[0]).some(o=>o.id===key+'-v1'));
}
