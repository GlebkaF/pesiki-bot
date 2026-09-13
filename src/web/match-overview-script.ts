export const OVERVIEW_SCRIPT=`
{
const node=document.getElementById('match-overview-data');
if(node){
 const state=new URL(location.href);
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
