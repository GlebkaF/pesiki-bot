import {heroImage,itemImage,abilityImage} from './game-assets.js';
import {esc} from './render.js';
export function gameIcon(name:string,kind:'hero'|'item'|'ability'|'auto'='auto'):string {
 const src=kind==='hero'?heroImage(name):kind==='item'?itemImage(name):kind==='ability'?abilityImage(name):heroImage(name)??itemImage(name)??abilityImage(name);
 return src?`<img class="game-icon ${kind==='hero'||heroImage(name)?'is-hero':''}" src="${src}" alt="" width="32" height="32" loading="lazy" decoding="async" data-game-image>`:'';
}
export function gameLabel(key:string,text:string,kind:'hero'|'item'|'ability'|'auto'='auto'):string{return `<span class="game-label">${gameIcon(key,kind)}<span>${esc(text)}</span></span>`;}
export const GAME_ICON_CSS=`.game-label{display:inline-flex;gap:8px;align-items:center;min-width:0;max-width:100%;vertical-align:middle}.game-label>span{min-width:0;overflow-wrap:anywhere}.game-icon{width:28px!important;height:28px!important;min-width:28px;object-fit:cover!important;border-radius:4px;flex:0 0 auto;background:var(--surface-2);box-shadow:0 0 0 1px var(--line)}.game-icon.is-hero{width:40px!important;height:25px!important;min-width:40px}.game-label .game-label{display:inline} [data-game-image].image-unavailable{display:none!important}`;
export const GAME_IMAGE_SCRIPT=`document.addEventListener('error',e=>{if(e.target instanceof HTMLImageElement&&e.target.hasAttribute('data-game-image'))e.target.classList.add('image-unavailable');},true);`;
