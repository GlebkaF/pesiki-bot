import assert from 'node:assert/strict';
import type {ParsedMatch} from './replay.js';
import {renderMatchOverview} from './web/match-overview-render.js';
import {renderReplayInsights} from './web/match-render.js';
const ids=[94014640,1869377945,126449680,40087920,97643532,11,12,13,14,15];
const heroes=['crystal_maiden','warlock','pudge','lina','zuus','axe','slark','antimage','sniper','kunkka'];
const fixture=():ParsedMatch=>({match_id:777,duration_min:21.5,apm_duration_seconds:1290,winner:'radiant',radiant_score:22,dire_score:17,
 players:heroes.map((hero,i)=>({steam_id:String(BigInt(ids[i])+76561197960265728n),hero,team:i<5?'radiant':'dire',name:i===0?'PRIVATE_NICK_SENTINEL':'Player',hero_damage:999999,damage_taken:100,tower_damage:0,buybacks:0,actions:1290,actions_per_min:60,networth_final:5000,networth_by_minute:Array.from({length:21},(_,j)=>(j+1)*(i<5?100:120)),item_timings:[],combat_details:{version:'combat-log-v2',coverage:{xp:true,ward_placements:true,healing_target_identity:true},damage:{by_ability:{hit:i+1},by_target:{},by_type:{}},healing:{self:0,other_heroes:0,units:0,by_target:{}},xp_by_minute:Array.from({length:21},(_,j)=>(j+1)*(i<5?50:60)),wards:[],deaths:[],casts:[],gold:[],buybacks:[],modifiers:[]}})),
 teamfights:[{start_min:10,end_min:10.5,deaths:8,radiant_died:2,dire_died:6,winner:'radiant',heroes_died:['axe','axe','slark','antimage','sniper','kunkka','lina','zuus']}],
 kills:[{min:10.1,killer:'pudge',victim:'axe',assists:2},{min:10.5,killer:'pudge',victim:'axe',assists:2}],
 buildings:[{min:11,name:'npc_dota_badguys_tower3_mid',killed_by_team:'dire'},{min:11.1,name:'npc_dota_badguys_fillers',killed_by_team:'radiant'}],roshan_kills_min:[12.53]} as unknown as ParsedMatch);
const m=fixture();
const primary=renderMatchOverview(m);
assert.ok(primary.includes('История всей игры'));
assert.ok(!primary.includes('PRIVATE_NICK_SENTINEL'),'neutral overview does not import personalised replay nick commentary');
assert.ok(!/НАШИ|наших|стак/i.test(primary),'primary overview contains no stack-biased narrative');
assert.ok(primary.includes('Radiant')&&primary.includes('Dire'));
assert.ok(primary.includes('12:32'),'fractional replay minutes round to nearest second');
assert.ok(primary.includes('href="#scoreboard">Проверить итоговое имущество'),'final snapshot verification points to final totals, not previous full minute');
assert.ok(!primary.includes('999'), 'mixed-source legacy damage is not used for whole-team comparison');
assert.ok(!primary.includes('fillers'),'decorative structures do not become key objectives');
assert.ok(primary.includes('повторные смерти одного героя считаются отдельно'));
assert.ok(primary.includes('получатель Aegis в этих данных не установлены'),'Roshan ownership stays unknown');
const selectedA=renderReplayInsights(m,m.players[0].steam_id),selectedB=renderReplayInsights(m,m.players[8].steam_id);
function section(html:string,id:string){const result=html.match(new RegExp('<section[^>]* id="'+id+'"[\\s\\S]*?</section>'));assert.ok(result,`section ${id} exists`);return result[0];}
for(const id of ['overview','timeline','teams'])assert.equal(section(selectedA,id),section(selectedB,id),`player selection must not alter primary ${id}`);
assert.notEqual(section(selectedA,'combat'),section(selectedB,'combat'),'personal drilldown still responds to selection');
const elementIds=[...selectedA.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(new Set(elementIds).size,elementIds.length,'combined page has no duplicate IDs');
for(const [,id]of selectedA.matchAll(/href="#([^"]+)"/g))assert.ok(id==='analysis'||elementIds.includes(id),`anchor #${id} resolves in match panels or the outer analysis wrapper`);
const timeline=section(primary,'timeline');
for(const [,id]of timeline.matchAll(/data-share-section="([^"]+)"/g))assert.ok(elementIds.includes(id),`share target ${id} exists`);
assert.ok(timeline.includes('id="moment-0"')&&timeline.includes('data-overview-event="fight"'));
assert.ok(timeline.includes('data-overview-event="building"')&&timeline.includes('data-overview-event="roshan"'));
const json=primary.match(/<script type="application\/json" id="match-overview-data">([\s\S]*?)<\/script>/)![1];
const curves=JSON.parse(json);assert.equal(curves.networth.length,21);assert.equal(curves.networth[0].minute,1);
const missing=fixture();delete missing.radiant_score;delete missing.dire_score;missing.players[0].combat_details=undefined;missing.players[0].networth_by_minute=[];
const sparse=renderMatchOverview(missing);assert.ok(sparse.includes('общий итог неизвестен'));
assert.ok(sparse.includes('нет полного измерения имущества'));
assert.ok(!sparse.includes('NaN')&&!sparse.includes('Infinity')&&!sparse.includes('undefined'),'missing data never leaks invalid numeric labels');
const unsafe=fixture();unsafe.players[0].hero='<script>alert(1)</script>';unsafe.kills[0].killer='<img onerror=evil>';
const escaped=renderMatchOverview(unsafe);assert.ok(!escaped.includes('<script>alert(1)</script>'));assert.ok(escaped.includes('&lt;img onerror=evil&gt;'));
const apiScore={match_id:missing.match_id,radiant_score:799,dire_score:811} as any;
assert.ok(renderMatchOverview(missing,apiScore).includes('799</strong>'));
assert.ok(!renderMatchOverview(missing,{...apiScore,match_id:0}).includes('799</strong>'));
assert.ok(!sparse.includes('class="ov-scoreline"'),'empty scorestrip is omitted');
console.log('Match overview web tests passed: neutral primary, selection independence, sources, coverage, anchors, unique IDs, escaping.');
