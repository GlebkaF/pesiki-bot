import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildAdviceContext,buildCandidates,missingPurchaseSteps} from './advice-context.js';
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
assert.equal(options.length,13,'all supported recipes with eligibility evidence survive candidate selection');
const choice={players:[{account:1,optionId:'guardian_greaves-v1',alternativeId:'desolator-v1',componentId:null}]};
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
assert.deepEqual(validateAdvice({players:[{account:1,optionId:null,alternativeId:null,componentId:null}]},context),{players:[],plan:''});
const corrupted={...context,players:context.players.map(p=>({...p,candidates:p.candidates.map(c=>c.key==='guardian_greaves'?{...c,description:c.description+' strong team dispel'}:c)}))};
assert.throws(()=>validateAdvice(choice,corrupted),'source drift disables the recipe');
assert.equal(playerOptions({...context,knowledgeRevision:'unknown'},context.players[0]).length,0);
for(const recipe of ADVICE_RECIPES){
 const rendered=validateAdvice({players:[{account:1,optionId:recipe.id,alternativeId:null,componentId:null}]},context);
 assert.equal(rendered.players[0].reason,recipe.reason);
 assert.ok(recipe.reason.length<320);
}
const byKey=new Map(knowledge.items.map(i=>[i.key,i]));
const hammer=byKey.get('mithril_hammer')!,desolator=byKey.get('desolator')!;
const missing=missingPurchaseSteps(desolator,[hammer],byKey);
assert.equal(missing.componentTreeComplete,true);
assert.equal(missing.purchaseSteps.find(s=>s.id===hammer.id)?.quantity,1);
assert.equal(missingPurchaseSteps(desolator,[],byKey).purchaseSteps.find(s=>s.id===hammer.id)?.quantity,2);
assert.ok(!missingPurchaseSteps(desolator,[hammer,hammer],byKey).purchaseSteps.some(s=>s.id===hammer.id));
const bkb=byKey.get('black_king_bar')!,bkbRecipe=byKey.get('recipe_black_king_bar')!;
assert.ok(!missingPurchaseSteps(bkb,[bkbRecipe],byKey).purchaseSteps.some(s=>s.id===bkbRecipe.id));
const force=byKey.get('force_staff')!,pike=byKey.get('hurricane_pike')!;
const pikeMissing=missingPurchaseSteps(pike,[force],byKey);
assert.ok(pikeMissing.componentTreeComplete);
assert.ok(!pikeMissing.purchaseSteps.some(s=>force.components.includes(s.key)),'assembled Force Staff pays for its entire subtree');
const brokenTree=new Map(byKey);brokenTree.delete('mithril_hammer');
assert.deepEqual(missingPurchaseSteps(desolator,[],brokenTree),{purchaseSteps:[],componentTreeComplete:false});
const badPrice={...desolator,cost:desolator.cost+1};
assert.deepEqual(missingPurchaseSteps(badPrice,[],byKey),{purchaseSteps:[],componentTreeComplete:false});
const cyclic={...desolator,components:[desolator.key]};
assert.equal(missingPurchaseSteps(cyclic,[],new Map(byKey).set(cyclic.key,cyclic)).componentTreeComplete,false);
const withComponent=validateAdvice({players:[{account:1,optionId:'desolator-v1',alternativeId:null,componentId:hammer.id}]},context);
assert.equal(withComponent.players[0].purchaseStep?.id,hammer.id);
assert.throws(()=>validateAdvice({players:[{account:1,optionId:'desolator-v1',alternativeId:null,componentId:bkbRecipe.id}]},context),'component must belong to the chosen build');
const withOwned={...context,players:context.players.map(p=>({...p,candidates:buildCandidates({...player(1,true),items:[hammer.id,hammer.id]},knowledge)}))};
assert.throws(()=>validateAdvice({players:[{account:1,optionId:'desolator-v1',alternativeId:null,componentId:hammer.id}]},withOwned),'cannot recommend an already fully owned component');
const natural=JSON.parse(fs.readFileSync(new URL('../docs/research/advice-review/live-case-9032160861.json',import.meta.url),'utf8')).context;
const invoker=natural.players.find((p:{hero:string})=>p.hero==='Invoker');
const riki=natural.players.find((p:{hero:string})=>p.hero==='Riki');
assert.ok(!playerOptions(natural,invoker).some(o=>o.id==='aether_lens-v1'),'real early Invoker case has no range-plan evidence');
assert.ok(playerOptions(natural,riki).some(o=>o.id==='diffusal_blade-v1'),'real Riki case must retain the supported Diffusal candidate');
console.log('Recipe boundary: 13 source-bound scenarios; free-text mutations, wrong actors/options, source drift, explicit abstention passed. Selection utility remains unevaluated.');
