/** Offline smoke test; marks three players in a saved public snapshot as test subjects. Never discovers public games or sends Telegram messages. */
import 'dotenv/config';
import fs from 'node:fs/promises';
import {liveSnapshot} from '../src/live-match.js';
import {parseKnowledge,parsePopularity,parseHeroAbilities} from '../src/advice-sources.js';
import {buildAdviceContext} from '../src/advice-context.js';
import {generateAdvice} from '../src/advice-model.js';
import {renderLiveMatch,LIVE_MATCH_CSS} from '../src/web/live-match-render.js';
import {layout} from '../src/web/render.js';
const [fixturePath,itemsPath,popularityPath,outPath]=process.argv.slice(2);
if(!outPath)throw Error('Usage: check-advice-preview <fixture> <items> <popularity> <output-prefix>');
const fixture=JSON.parse(await fs.readFile(fixturePath,'utf8'));
const match=liveSnapshot(fixture.game,3,fixture.data)!;
match.kind='stack';match.updatedAt=Date.now();
for(const [index,p] of match.teams.flatMap(t=>t.players).entries()){p.ours=index<3;p.name=index<3?`Тестовый игрок ${index+1}`:'Соперник';}
const knowledge=parseKnowledge(JSON.parse(await fs.readFile(itemsPath,'utf8')));
const popularity=new Map<number,ReturnType<typeof parsePopularity>>(JSON.parse(await fs.readFile(popularityPath,'utf8')).map(([id,raw]:[number,unknown])=>[id,parsePopularity(id,raw)]));
if(process.env.ADVICE_EVAL_ABILITIES&&process.env.ADVICE_EVAL_HERO_ABILITIES)knowledge.heroAbilities=parseHeroAbilities(JSON.parse(await fs.readFile(process.env.ADVICE_EVAL_ABILITIES,'utf8')),JSON.parse(await fs.readFile(process.env.ADVICE_EVAL_HERO_ABILITIES,'utf8')));
const context=buildAdviceContext(match,knowledge,popularity);
if(process.env.ADVICE_EVAL_PREPARE){await fs.writeFile(outPath+'.context.json',JSON.stringify(context));process.exit(0);}
const result=process.env.ADVICE_EVAL_RESULT?JSON.parse(await fs.readFile(process.env.ADVICE_EVAL_RESULT,'utf8')):await generateAdvice(context).catch(()=>{throw Error('Model request failed; provider details withheld');});
const cards=result.players.map(p=>{const subject=context.players.find(c=>c.account===p.account)!,player=match.teams.flatMap(t=>t.players).find(c=>c.account===p.account)!;return {...p,name:player.name,hero:player.hero,item:subject.candidates.find(c=>c.id===p.itemId)!,alternative:subject.candidates.find(c=>c.id===p.alternativeId)??null};});
const advice={matchId:match.matchId,snapshotAt:match.updatedAt,generatedAt:Date.now(),gameTime:match.time!,delay:match.delay??null,gameMode:match.gameMode??null,cards,plan:result.plan,knowledgeRevision:knowledge.revision,statisticsAt:Date.now()};
await fs.writeFile(outPath+'.json',JSON.stringify({testOnly:true,context,advice},null,2));
await fs.writeFile(outPath+'.html',layout('Проверка советов', '<p>ТЕСТ НА СОХРАНЁННОМ МАТЧЕ — НЕ ТЕКУЩИЕ СОВЕТЫ СТАКУ</p>'+renderLiveMatch(match,{status:'ready',advice}),'',LIVE_MATCH_CSS));
console.log(JSON.stringify({cards:cards.map(c=>({hero:c.hero,item:c.item.name,reason:c.reason,alternative:c.alternative?.name,alternativeReason:c.alternativeReason})),plan:result.plan},null,2));
