import type {LiveMatch} from './live-match.js';
const clock=(seconds:number)=>`${seconds<0?'−':''}${Math.floor(Math.abs(seconds)/60)}:${String(Math.floor(Math.abs(seconds))%60).padStart(2,'0')}`;
const gold=(value:number)=>`${(value/1000).toFixed(1)}k`;
const clean=(value:string)=>value.replace(/[\r\n\t]+/g,' ').slice(0,50);

/** Plain text shared by chat adapters; each adapter must escape its own markup. */
export function currentMatchText(match:LiveMatch|null,now=Date.now()):string{
 if(!match||now-match.updatedAt>=90_000)return 'Сейчас нет доступного матча стака для наблюдения. Попробуй чуть позже.';
 const [radiant,dire]=match.teams;
 if(!radiant||!dire)return 'Данные матча пока недоступны. Попробуй чуть позже.';
 const lines=[match.kind==='stack'?`🎮 Матч стака · наших: ${match.stackCount}`:'🎮 Публичный матч · пока нет доступного матча стака',
 `Radiant ${radiant.score??'—'} : ${dire.score??'—'} Dire`,
 `⏱ ${match.time===undefined?'Время недоступно':clock(match.time)} · #${match.matchId}`];
 if(radiant.netWorth!==undefined&&dire.netWorth!==undefined){
  const lead=radiant.netWorth-dire.netWorth;
  lines.push(lead===0?'💰 Равная экономика':`💰 ${lead>0?'Radiant':'Dire'} +${gold(Math.abs(lead))}`);
 }
 for(const team of match.teams){
  lines.push('',team.name==='Radiant'?'🟢 Radiant':'🔴 Dire');
  for(const player of team.players)lines.push(`${player.ours?'★ ':''}${clean(player.name)} — ${clean(player.hero)}, ур. ${player.level??'—'}\n${player.kills??'—'}/${player.deaths??'—'}/${player.assists??'—'} K/D/A${player.netWorth===undefined?'':` · ${gold(player.netWorth)} нетворс`}`);
 }
 lines.push('',`DotaTV · ${match.delay===undefined?'задержка неизвестна':`задержка ${clock(match.delay)}`}`,
 `Снимок ${Math.max(0,Math.floor((now-match.updatedAt)/1000))} сек. назад${match.detailed?'':' · подробные данные пока недоступны'}`);
 return lines.join('\n');
}
