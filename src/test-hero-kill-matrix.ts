import assert from 'node:assert/strict';
import {renderHeroKillMatrix} from './web/hero-kill-matrix-render.js';
import {HERO_KILL_MATRIX_SCRIPT} from './web/hero-kill-matrix-script.js';
import type {HeroDeathModel} from './hero-death-journal.js';
const model:HeroDeathModel={players:[{hero:'pudge',heroLabel:'Pudge',steamId:'1',team:'radiant'},{hero:'warlock',heroLabel:'Warlock',steamId:'2',team:'dire'}],entries:[],cells:[{killer:0,victim:1,count:2,eventIds:['a','b']},{killer:1,victim:0,count:null,eventIds:[]}],coverage:{complete:false,verifiedDeaths:3,verifiedKills:2,reincarnations:1,unresolved:1,nonHeroKills:1,invalid:0}};
const html=renderHeroKillMatrix(model);assert.ok(html.includes('>2+</button>'));assert.ok(html.includes('Нет достаточных данных'));assert.ok(!html.includes('>0</span>'));assert.ok(html.includes('Возвраты / реинкарнации без смерти в D'));assert.ok(html.includes('официальный KDA показан в составе'));assert.ok(!renderHeroKillMatrix(null).includes('<table'));const bad=renderHeroKillMatrix({...model,players:[{...model.players[0],heroLabel:'</script><img src=x>'},model.players[1]]});assert.ok(!bad.includes('</script><img src=x>'));assert.ok(bad.includes('&lt;/script&gt;'));new Function(HERO_KILL_MATRIX_SCRIPT);console.log('Hero kill matrix UI: partial minima, unknown cells, source separation, escaping and script syntax passed.');

const complete=renderHeroKillMatrix({...model,coverage:{...model.coverage,complete:true}});
assert.equal((complete.match(/<table /g)??[]).length,2);
assert.equal((complete.match(/<td>/g)??[]).length,2);
assert.ok(!complete.includes('data-kill-pair="0:0"'));
assert.ok(!complete.includes('data-kill-pair="1:1"'));
assert.ok(complete.includes('Radiant → Dire'));
assert.ok(complete.includes('Dire → Radiant'));
