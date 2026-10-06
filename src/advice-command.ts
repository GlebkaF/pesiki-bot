import type {CommandContext,Context} from 'grammy';
import {getLiveMatch} from './live-match.js';
import {liveAdvice,type AdviceState} from './live-advice.js';
import {currentMatchUrl} from './current-match-command.js';
export function adviceText(state:AdviceState):string{
 if(state.status!=='ready')return state.message;
 const a=state.advice,time=`${Math.floor(a.gameTime/60)}:${String(Math.floor(a.gameTime)%60).padStart(2,'0')}`;
 const parts=[`💡 Следующий шаг · ${time}${a.gameMode===23?' · Turbo':''}`];
 if(a.plan)parts.push(a.plan);
 for(const c of a.cards){
  const block=`${c.name} · ${c.hero}\n→ ${c.item.name} · осталось собрать ${c.item.remainingCost} золота\n${c.reason}${c.alternative?`\nИли ${c.alternative.name}: ${c.alternativeReason}`:''}`;
  if(parts.join('\n\n').length+block.length>3450){parts.push('Остальные советы — на сайте.');break;}parts.push(block);
 }
 parts.push(`По задержанному снимку: ${a.delay===null?'задержка DotaTV неизвестна':`DotaTV +${Math.round(a.delay)} сек.`}. Учтены видимые предметы; курьер и тайник неизвестны.\n${a.statisticsAt?'Сборки OpenDota':'Статистика сборок недоступна'} · механики dotaconstants. Вариант плана, не гарантия.`);
 return parts.join('\n\n');
}
export async function replyAdvice(ctx:CommandContext<Context>,load:()=>Promise<AdviceState>=async()=>liveAdvice.get(await getLiveMatch())):Promise<void>{
 const progress=await ctx.reply('💡 Смотрю составы и предметы наших…',ctx.message?{reply_parameters:{message_id:ctx.message.message_id}}:{});
 let state:AdviceState;try{state=await load();}catch{state={status:'unavailable',message:'Не получилось получить совет. Попробуй чуть позже.'};}
 await ctx.api.editMessageText(ctx.chat.id,progress.message_id,adviceText(state),{link_preview_options:{is_disabled:true},...(state.status==='ready'?{reply_markup:{inline_keyboard:[[{text:'Советы и матч на сайте',url:currentMatchUrl()}]]}}:{})});
}
