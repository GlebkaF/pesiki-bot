export const PROFILE_SCRIPT = `
document.documentElement.classList.add("profile-js");
document.querySelectorAll(".breakdown-picker").forEach(form=>{form.querySelector("button").hidden=true;form.querySelector("select").addEventListener("change",()=>form.requestSubmit());});

const statusNode=document.getElementById('copy-status');
let statusTimer;
document.querySelectorAll('[data-share-section]').forEach(button=>button.addEventListener('click',async()=>{
  const url=new URL(location.href);url.hash=button.dataset.shareSection;
  let duration=4000;
  try {await navigator.clipboard.writeText(url.href);statusNode.textContent='Ссылка на раздел скопирована';}
  catch {statusNode.textContent='Зажми ссылку, чтобы скопировать: ';const link=document.createElement('a');link.href=url.href;link.textContent='этот раздел';link.style.color='inherit';statusNode.append(link);duration=15000;}
  clearTimeout(statusTimer);statusTimer=setTimeout(()=>statusNode.textContent='',duration);
}));
const matchupButtons=[...document.querySelectorAll('[data-matchup]')];
function showMatchup(side){side=side==='allies'?'allies':'enemies';matchupButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.matchup===side)));for(const name of ['allies','enemies']){const panel=document.getElementById('matchup-'+name);if(panel)panel.hidden=name!==side;}}
showMatchup(new URL(location.href).searchParams.get('side'));
matchupButtons.forEach(button=>button.addEventListener('click',()=>{showMatchup(button.dataset.matchup);const url=new URL(location.href);url.searchParams.set('side',button.dataset.matchup);history.replaceState(null,'',url.pathname+url.search+url.hash);}));
const jumpLinks=[...document.querySelectorAll('.profile-jumps a')];
let scrollQueued=false;
function updateJump(){scrollQueued=false;let active=jumpLinks[0];for(const link of jumpLinks){const section=document.querySelector(link.getAttribute('href'));if(section&&section.getBoundingClientRect().top<=110)active=link;}jumpLinks.forEach(link=>{if(link===active)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});}
addEventListener('scroll',()=>{if(!scrollQueued){scrollQueued=true;requestAnimationFrame(updateJump);}},{passive:true});updateJump();
function revealHash(){let target;try{target=document.getElementById(decodeURIComponent(location.hash.slice(1)));}catch{return;}if(!target)return;let node=target;while(node){if(node.tagName==='DETAILS')node.open=true;node=node.parentElement;}requestAnimationFrame(()=>{target.scrollIntoView({block:'start',behavior:'auto'});const link=jumpLinks.find(a=>a.hash===location.hash);if(link){const nav=link.parentElement;nav.scrollLeft=link.offsetLeft-nav.clientWidth/2+link.offsetWidth/2;}});}
addEventListener('hashchange',revealHash);if(location.hash)revealHash();
const dataNode=document.getElementById('apm-series');
if(dataNode){
  const points=JSON.parse(dataNode.textContent),range=document.getElementById('chart-range'),chart=document.getElementById('apm-chart'),marker=document.getElementById('chart-marker');
  const initialId=Number(new URL(location.href).searchParams.get("chart"));const initialIndex=points.findIndex(p=>p.id===initialId);if(initialIndex>=0)range.value=initialIndex;
  function selectPoint(updateUrl=false){const point=points[Number(range.value)];if(!point)return;document.getElementById('chart-hero').textContent=point.hero;document.getElementById('chart-apm').textContent=point.apm+' APM';document.getElementById('chart-date').textContent=point.date+' · '+point.outcome;document.getElementById('chart-match').href='/match/'+point.id;range.setAttribute('aria-valuetext',point.hero+', '+point.apm+' APM, '+point.date);marker.setAttribute('cx',point.x);marker.setAttribute('cy',point.y);const detail=document.getElementById('chart-detail');detail.hidden=!point.detailed;const url=new URL(location.href);url.searchParams.set('match',point.id);url.searchParams.delete('page');url.hash='apm';detail.href=url.pathname+url.search+url.hash;if(updateUrl){const stateUrl=new URL(location.href);stateUrl.searchParams.set('chart',point.id);history.replaceState(null,'',stateUrl.pathname+stateUrl.search+stateUrl.hash);}}
  range.addEventListener('input',()=>selectPoint(true));
  chart.addEventListener('pointerdown',event=>{const bounds=chart.getBoundingClientRect();const x=(event.clientX-bounds.left)/bounds.width*520;let index=0;for(let i=1;i<points.length;i++)if(Math.abs(points[i].x-x)<Math.abs(points[index].x-x))index=i;range.value=index;selectPoint(true);});selectPoint();
}
`;
