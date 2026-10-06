import type {CommandContext,Context} from 'grammy';
import {getLiveMatch,type LiveMatch} from './live-match.js';
import {currentMatchText} from './current-match-message.js';

export function currentMatchUrl():string{
 try{
  const url=new URL(process.env.SITE_URL||'https://pesiki.nxrig.com');
  if(url.protocol!=='https:'&&url.protocol!=='http:')throw new Error('INVALID_SITE_URL');
  url.pathname='/';url.search='';url.hash='home-live';return url.toString();
 }catch{return 'https://pesiki.nxrig.com/#home-live';}
}
export async function replyCurrentMatch(ctx:CommandContext<Context>,load:()=>Promise<LiveMatch|null>=getLiveMatch):Promise<void>{
 const progress=await ctx.reply('⏳ Получаю текущий матч…',ctx.message?{reply_parameters:{message_id:ctx.message.message_id}}:{});
 let match:LiveMatch|null=null,text:string;
 try{match=await load();text=currentMatchText(match);}
 catch{console.warn('[CURRENT MATCH] Snapshot unavailable');text='Не удалось получить текущий матч. Попробуй чуть позже.';}
 const fresh=match&&Date.now()-match.updatedAt<90_000;
 await ctx.api.editMessageText(ctx.chat.id,progress.message_id,text,{
  link_preview_options:{is_disabled:true},
  ...(fresh?{reply_markup:{inline_keyboard:[[{text:'🗺 Карта и предметы на сайте',url:currentMatchUrl()}]]}}:{}),
 });
}
