export const ROSTER_SCRIPT=`
{
 const root=document.getElementById('scoreboard'),select=document.getElementById('roster-metric');if(root&&select){
 const state=new URL(location.href),saved=state.searchParams.get('rosterMetric');if([...select.options].some(o=>o.value===saved))select.value=saved;
 function render(update=false){const key=select.value,rows=[...root.querySelectorAll('[data-roster-metric]')],active=rows.filter(e=>e.dataset.rosterMetric===key),values=active.map(e=>e.dataset.value===''?null:Number(e.dataset.value)).filter(v=>v!==null&&Number.isFinite(v)&&v>=0),max=Math.max(1,...values);rows.forEach(e=>{e.hidden=e.dataset.rosterMetric!==key;if(!e.hidden)e.querySelector('i').style.width=(e.dataset.value===''?0:Number(e.dataset.value)/max*100)+'%';});if(update){const u=new URL(location.href);u.searchParams.set('rosterMetric',key);history.replaceState(null,'',u.pathname+u.search+u.hash);}}
 function reveal(){let hash;try{hash=decodeURIComponent(location.hash.slice(1));}catch{return;}if(hash==='scoreboard'||hash==='teams')root.open=true;}
 select.addEventListener('change',()=>render(true));addEventListener('hashchange',reveal);reveal();render();
 }
}
`;
