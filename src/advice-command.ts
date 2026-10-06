import type {CommandContext,Context} from 'grammy';
import {getLiveMatch} from './live-match.js';
import {liveAdvice,type AdviceState} from './live-advice.js';
import {currentMatchUrl} from './current-match-command.js';
export function adviceText(state:AdviceState):string{
 if(state.status!=='ready')return state.message;
 const a=state.advice,time=`${Math.floor(a.gameTime/60)}:${String(Math.floor(a.gameTime)%60).padStart(2,'0')}`;
 const parts=[`💡 План сборки · ${time}${a.gameMode===23?' · Turbo':''}`];
 if(a.plan)parts.push(a.plan);
 for(const c of a.cards){
  const block=`${c.name} · ${c.hero}\nЦель: ${c.item.name} · по видимым компонентам ещё ${c.item.remainingCost} золота\n${c.matchups?.length?c.matchups.map(m=>`vs ${m.hero}: ${m.why}`).join("\n")+"\n":""}${c.reason}${c.alternative?`\nИли ${c.alternative.name}: ${c.alternativeReason}`:''}`;
  if(parts.join('\n\n').length+block.length>3450){parts.push('Остальные советы — на сайте.');break;}parts.push(block);
 }
 parts.push(`По снимку наблюдателя; фактическая задержка не измерена. Учтён инвентарь наших; курьер и тайник неизвестны.\n${a.statisticsAt?'Сборки OpenDota':'Статистика сборок недоступна'} · механики dotaconstants. Вариант плана, не гарантия.`);
 return parts.join('\n\n');
}
export async function replyAdvice(ctx:CommandContext<Context>,load:()=>Promise<AdviceState>=async()=>liveAdvice.get(await getLiveMatch())):Promise<void>{
 const progress=await ctx.reply('💡 Смотрю составы и предметы наших…',ctx.message?{reply_parameters:{message_id:ctx.message.message_id}}:{});
 let state:AdviceState;try{state=await load();}catch{state={status:'unavailable',message:'Не получилось получить совет. Попробуй чуть позже.'};}
 await ctx.api.editMessageText(ctx.chat.id,progress.message_id,adviceText(state),{link_preview_options:{is_disabled:true},...(state.status==='ready'?{reply_markup:{inline_keyboard:[[{text:'Советы и матч на сайте',url:currentMatchUrl()}]]}}:{})});
}
