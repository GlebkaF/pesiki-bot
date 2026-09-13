export const EPISODE_SCRIPT=`
{
 const node=document.getElementById('episode-map-data');
 if(node){
  const data=JSON.parse(node.textContent),picker=document.getElementById('episode-picker'),select=document.getElementById('match-episode'),death=document.getElementById('episode-death'),target=document.getElementById('episode-map'),status=document.getElementById('episode-map-status');
  const fmt=s=>Math.floor(Math.round(s)/60)+':'+String(Math.round(s)%60).padStart(2,'0');
  picker.querySelector('button').hidden=true;
  const go=id=>{const u=new URL(location.href);u.searchParams.set('episode',id);u.searchParams.delete('episodeDeath');u.hash='episodes';location.href=u.href;};
  select.addEventListener('change',()=>go(select.value));document.querySelectorAll('[data-episode-select]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();go(a.dataset.episodeSelect);}));
  const located=data.deaths.map((d,i)=>({...d,i})).filter(d=>Number.isFinite(d.x)&&Number.isFinite(d.y)&&Math.abs(d.x)<=10000&&Math.abs(d.y)<=10000),x=v=>20+(v+10000)/20000*300,y=v=>320-(v+10000)/20000*300;
  target.innerHTML=located.length?'<svg viewBox="0 0 340 340" role="group" aria-label="Координаты смертей в эпизоде"><rect x="20" y="20" width="300" height="300" fill="var(--surface-2)" stroke="var(--line)"/><path d="M170 20V320M20 170H320" stroke="var(--line)" stroke-dasharray="3 5"/><text x="28" y="311" font-size="13" fill="var(--muted)">Юго-запад</text><text x="228" y="37" font-size="13" fill="var(--muted)">Северо-восток</text>'+located.map(d=>'<circle data-index="'+d.i+'" cx="'+x(d.x)+'" cy="'+y(d.y)+'" r="9" fill="'+(d.team==='radiant'?'var(--radiant)':d.team==='dire'?'var(--dire)':'var(--muted)')+'" stroke="var(--surface)" stroke-width="2"/>').join('')+'</svg><p class="ep-note">Координатная схема, без ландшафта. Масштаб фиксирован. '+located.length+' из '+data.deaths.length+' смертей на схеме.</p>':'<p class="ep-empty">Координат для схемы этого эпизода нет.</p>';
  const markers=[...target.querySelectorAll('circle')];markers.forEach(marker=>{const i=Number(marker.dataset.index),d=data.deaths[i];marker.setAttribute('tabindex','0');marker.setAttribute('role','button');marker.setAttribute('aria-label',fmt(d.seconds)+' '+d.hero);marker.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();death.value=i;choose(true);}});});
  const state=new URL(location.href),index=Number(state.searchParams.get('episodeDeath'));if(Number.isInteger(index)&&index>=0&&index<data.deaths.length)death.value=index;
  function choose(update=false){const i=Number(death.value),d=data.deaths[i];document.querySelectorAll('[data-episode-death]').forEach(el=>el.hidden=Number(el.dataset.episodeDeath)!==i);markers.forEach(marker=>{const selected=Number(marker.dataset.index)===i;marker.setAttribute('stroke',selected?'var(--ink)':'var(--surface)');marker.setAttribute('stroke-width',selected?'4':'2');});status.textContent=fmt(d.seconds)+' · '+d.hero+(located.some(x=>x.i===i)?'':' · координаты не показаны');if(update){const u=new URL(location.href);u.searchParams.set('episode',data.id);u.searchParams.set('episodeDeath',i);history.replaceState(null,'',u.pathname+u.search+u.hash);}}
  death.addEventListener('change',()=>choose(true));target.querySelector('svg')?.addEventListener('pointerdown',e=>{const r=e.currentTarget.getBoundingClientRect(),px=(e.clientX-r.left)/r.width*340,py=(e.clientY-r.top)/r.height*340;let nearest=null,best=Infinity;located.forEach(d=>{const distance=Math.hypot(px-x(d.x),py-y(d.y));if(distance<best){best=distance;nearest=d;}});if(nearest&&best<=28){death.value=nearest.i;choose(true);}});choose();
  function canonical(){if(location.hash==='#episodes'){const u=new URL(location.href);u.searchParams.set('episode',data.id);history.replaceState(null,'',u.pathname+u.search+u.hash);}}
  addEventListener('hashchange',canonical);canonical();
 }
}
`;
