export const OVERVIEW_SCRIPT=`
{
const node=document.getElementById('match-overview-data');
if(node){
 const curves=JSON.parse(node.textContent),metric=document.getElementById('overview-metric'),range=document.getElementById('overview-minute'),chart=document.getElementById('overview-chart');
 const state=new URL(location.href),format=v=>Math.round(v).toLocaleString('ru-RU');
 if(['networth','xp'].includes(state.searchParams.get('overviewMetric')))metric.value=state.searchParams.get('overviewMetric');
 const minute=Number(state.searchParams.get('overviewMinute'));if(minute>=1&&minute<=Number(range.max))range.value=minute;
 function draw(update=false){
  const rows=curves[metric.value],last=Number(range.max),at=Number(range.value),max=Math.max(1,...rows.map(p=>Math.abs(p.advantage))),x=m=>52+m/last*500,y=v=>130-v/max*95;
  let svg='<svg viewBox="0 0 580 280" role="img" aria-label="Преимущество команд по '+(metric.value==='xp'?'опыту':'имуществу')+'"><text x="52" y="20" fill="var(--radiant)" font-size="15">Radiant</text><text x="52" y="250" fill="var(--dire)" font-size="15">Dire</text>';
  for(const v of [-max,0,max])svg+='<line x1="52" x2="555" y1="'+y(v)+'" y2="'+y(v)+'" stroke="var(--line)"/><text x="47" y="'+(y(v)+5)+'" text-anchor="end" fill="var(--muted)" font-size="14">'+(v===0?'0':Math.round(Math.abs(v)/1000)+'к')+'</text>';
  const runs=[];for(const p of rows){const run=runs.at(-1);if(!run||p.minute!==run.at(-1).minute+1)runs.push([p]);else run.push(p);}
  for(const run of runs)svg+='<polyline points="'+run.map(p=>x(p.minute)+','+y(p.advantage)).join(' ')+'" fill="none" stroke="var(--accent)" stroke-width="3"/>';
  const point=rows.find(p=>p.minute===at);svg+='<line x1="'+x(at)+'" x2="'+x(at)+'" y1="30" y2="228" stroke="var(--ink)" stroke-dasharray="4 4"/>'+(point?'<circle cx="'+x(at)+'" cy="'+y(point.advantage)+'" r="5" fill="var(--ink)"/>':'')+'<text x="52" y="274" fill="var(--muted)" font-size="14">0 мин</text><text x="553" y="274" text-anchor="end" fill="var(--muted)" font-size="14">'+last+' мин</text></svg>';
  chart.innerHTML=rows.length?svg:'<p class="empty">Нет полных одновременных измерений обеих команд для этого графика.</p>';
  const text=at+' мин · '+(point?(point.advantage===0?'Равенство':(point.advantage>0?'Radiant':'Dire')+' +'+format(Math.abs(point.advantage)))+' · Radiant '+format(point.radiant)+' / Dire '+format(point.dire):'нет полного измерения');
  document.getElementById('overview-reading').textContent=text;range.setAttribute('aria-valuetext',text);
  if(update){const u=new URL(location.href);u.searchParams.set('overviewMetric',metric.value);u.searchParams.set('overviewMinute',range.value);history.replaceState(null,'',u.pathname+u.search+u.hash);}
 }
 metric.addEventListener('change',()=>draw(true));range.addEventListener('input',()=>draw(true));chart.addEventListener('pointerdown',e=>{const r=chart.querySelector('svg')?.getBoundingClientRect();if(!r)return;range.value=Math.max(1,Math.min(Number(range.max),Math.round(((e.clientX-r.left)/r.width*580-52)/500*Number(range.max))));draw(true);});draw();
 const filter=document.getElementById('overview-event-filter');if([...filter.options].some(o=>o.value===state.searchParams.get('timelineType')))filter.value=state.searchParams.get('timelineType');
 function events(update=false){let count=0;document.querySelectorAll('[data-overview-event]').forEach(el=>{el.hidden=filter.value!=='all'&&el.dataset.overviewEvent!==filter.value;if(!el.hidden)count++;});document.getElementById('overview-event-count').textContent='Событий: '+count;if(update){const u=new URL(location.href);u.searchParams.set('timelineType',filter.value);history.replaceState(null,'',u.pathname+u.search+u.hash);}}
 filter.addEventListener('change',()=>events(true));events();
 const teamMetric=document.getElementById('overview-team-metric');if([...teamMetric.options].some(o=>o.value===state.searchParams.get('teamMetric')))teamMetric.value=state.searchParams.get('teamMetric');
 function teams(update=false){document.querySelectorAll('[data-team-metric]').forEach(el=>el.hidden=el.dataset.teamMetric!==teamMetric.value);if(update){const u=new URL(location.href);u.searchParams.set('teamMetric',teamMetric.value);history.replaceState(null,'',u.pathname+u.search+u.hash);}}
 teamMetric.addEventListener('change',()=>teams(true));teams();
 function revealMoment(){const target=document.getElementById(location.hash.slice(1));if(target?.matches('[data-overview-event]')&&target.hidden){filter.value='all';events(true);}}
 addEventListener('hashchange',revealMoment);revealMoment();
}
}
`;
