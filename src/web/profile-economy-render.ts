import type { ProfileEconomy, EconomyPurchase } from "../profile-economy.js";
import { esc } from "./render.js";
const num=(n:number)=>Math.round(n).toLocaleString("ru-RU");
const clock=(s:number)=>`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
function purchaseRow(p:EconomyPurchase){
  const icon=/^[a-z0-9_]+$/.test(p.item)?`<img loading="lazy" src="https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/items/${p.item}.png" alt="" width="40" height="29" style="object-fit:contain;flex-shrink:0">`:"";
  return `<li style="display:flex;align-items:center;gap:10px;min-height:44px;padding:5px 0;border-bottom:1px solid var(--line)"><time style="font-variant-numeric:tabular-nums;width:44px;flex-shrink:0">${clock(p.seconds)}</time>${icon}<span style="overflow-wrap:anywhere">${esc(p.label)}</span></li>`;
}
function chart(data:ProfileEconomy){
  if(!data.networth.length)return `<p class="empty">Стоимость имущества по минутам не сохранилась.</p>`;
  const max=Math.max(1,...data.networth.map(p=>p.value)),last=Math.max(1,...data.networth.map(p=>p.minute));
  const x=(m:number)=>40+(m/last)*264,y=(v:number)=>146-v/max*122;
  // Separate polylines at missing samples: never invent data across a gap.
  const runs:typeof data.networth[]=[];
  for(const point of data.networth){const run=runs.at(-1);if(!run||point.minute!==run.at(-1)!.minute+1)runs.push([point]);else run.push(point);}
  const paths=runs.map(run=>run.length===1?`<circle cx="${x(run[0].minute)}" cy="${y(run[0].value)}" r="2" fill="var(--accent)"></circle>`:`<polyline points="${run.map(p=>`${x(p.minute).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"></polyline>`).join("");
  return `<svg viewBox="0 0 320 176" role="img" aria-label="Стоимость имущества по минутам. Числовые значения доступны под графиком." style="display:block;width:100%;height:auto;margin:12px 0">${[0,.5,1].map(f=>`<line x1="40" x2="304" y1="${y(f*max)}" y2="${y(f*max)}" stroke="var(--line)"></line><text x="35" y="${y(f*max)+4}" text-anchor="end" fill="var(--muted)" font-size="11">${Math.round(f*max/1000)}к</text>`).join("")}${paths}<text x="40" y="168" fill="var(--muted)" font-size="11">0 мин</text><text x="304" y="168" text-anchor="end" fill="var(--muted)" font-size="11">${last} мин</text></svg>`;
}
export function renderEconomy(data:ProfileEconomy|null):string {
  if(!data)return `<p class="empty">Экономика этой игры пока недоступна. Нужен сохранённый разбор реплея.</p>`;
  const key=data.purchases.filter(p=>p.key);
  return `<p class="sub">${esc(data.hero)} · матч ${data.matchId}</p><h3>Стоимость имущества</h3><p class="sub">Золото и предметы героя по данным реплея.</p>${chart(data)}<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:16px">${data.checkpoints.map(p=>`<div><span class="sub">${p.minute}-я минута</span><br><strong>${p.value===null?"—":num(p.value)}</strong></div>`).join("")}</div>${data.networth.length?`<details class="fold"><summary>Значения по минутам</summary><dl style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px">${data.networth.map(p=>`<dt>${p.minute} мин</dt><dd style="margin:0;text-align:right">${num(p.value)}</dd>`).join("")}</dl></details>`:""}<h3 style="margin-top:24px">Ключевые покупки</h3><p class="sub">Время покупки, а не доставки. Предстартовые предметы и расходники не входят в этот список.</p>${key.length?`<ol style="list-style:none;margin:8px 0 16px;padding:0">${key.map(purchaseRow).join("")}</ol>`:`<p class="empty">Ключевые покупки не зафиксированы.</p>`}${data.purchases.length?`<details class="fold"><summary>Все сохранённые покупки · ${data.purchases.length}</summary><ol style="list-style:none;margin:0;padding:12px">${data.purchases.map(purchaseRow).join("")}</ol></details>`:""}`;
}
