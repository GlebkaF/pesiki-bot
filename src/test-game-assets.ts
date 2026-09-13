import assert from 'node:assert/strict';
import {heroImage,itemImage,abilityImage,GAME_ASSET_SOURCE} from './web/game-assets.js';
import {HERO_CATALOG} from './hero-catalog.js';
for(const hero of HERO_CATALOG){
 const expected=GAME_ASSET_SOURCE+'/heroes/'+hero.name.replace('npc_dota_hero_','')+'.png';
 assert.equal(heroImage(hero.name),expected);assert.equal(heroImage(hero.localized_name),expected);
 assert.equal(heroImage(hero.name.replace('npc_dota_hero_','').replace(/_/g,'')),expected,'collapsed replay keys resolve');
}
assert.ok(heroImage('Zeus')?.endsWith('/zuus.png'));
assert.ok(heroImage('Wraith King')?.endsWith('/skeleton_king.png'));
assert.ok(heroImage("Nature's Prophet")?.endsWith('/furion.png'));
assert.ok(heroImage('Outworld Devourer')?.endsWith('/obsidian_destroyer.png'));
assert.equal(itemImage('item_blink'),GAME_ASSET_SOURCE+'/items/blink.png');
assert.equal(itemImage('black_king_bar'),GAME_ASSET_SOURCE+'/items/black_king_bar.png');
assert.equal(abilityImage('item_blink'),itemImage('blink'));
assert.ok(abilityImage('crystal_maiden_freezing_field_stop')?.endsWith('/crystal_maiden_freezing_field_stop.png'),'auxiliary button has its own verified art');
assert.ok(abilityImage('warlock_rain_of_chaos')?.endsWith('/warlock_rain_of_chaos.png'));
assert.equal(abilityImage('batrider_sticky_napalm_application_damage'),null,'known damage event with missing asset does not invent an icon');
assert.equal(itemImage('recipe_black_king_bar'),null,'unverified recipe image omitted');
for(const key of ['', 'unknown_or_attack','new_spell','../axe','axe.png','<script>','https://evil.test/icon','constructor','__proto__']){
 assert.equal(heroImage(key),null);assert.equal(itemImage(key),null);assert.equal(abilityImage(key),null);
}
console.log('Game assets tests passed: 127 hero mappings, verified items/abilities, auxiliary icons, unknown/missing assets, safe paths.');
