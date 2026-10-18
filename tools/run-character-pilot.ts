/** Offline chronological voice pilot. No Telegram or production writes. */
import 'dotenv/config';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {VoiceMemoryStore,voiceMemoryScope} from '../src/voice-memory.js';
import {generateVoiceDraft,VOICE_SYSTEM} from '../src/voice-generation.js';
import {PLAYER_PERSONAS} from '../src/voice-personality.js';
import {ALL_PLAYERS} from '../src/config.js';
const root=path.resolve(process.argv[2]??'data/voice-pilot-2026-10-18');
const inputs=JSON.parse(await readFile(path.join(root,'inputs.json'),'utf8'));
const promptSpec=JSON.parse(await readFile(path.join(root,'redteam.json'),'utf8'));
const variants=promptSpec.revised_prompts.variants;
const system=VOICE_SYSTEM+(promptSpec.system_suffix?'\n\n'+promptSpec.system_suffix:'');
const model=process.env.OPENAI_MODEL_V2||'gpt-6.1-sol';
const runId='character-'+model+'-'+createHash('sha256').update(JSON.stringify({inputs,variants,system})).digest('hex').slice(0,12);
const directory=path.join('api-runs',runId),out=path.join(root,directory);await mkdir(out,{recursive:true});
await writeFile(path.join(root,'api-current.json'),JSON.stringify({runId,model,directory,chronological:true},null,2));
await writeFile(path.join(out,'protocol.json'),JSON.stringify({runId,model,system,variants,chronological:true,memory:'SQLite per variant namespace; same pre-publication chat, no candidate feedback inferred from historic reactions; no production writes'},null,2));
const store=new VoiceMemoryStore(path.join(out,'memory.sqlite'));
let failed=false;
async function runVariant(variant:any){
 const scope=voiceMemoryScope('export-group',`pilot:${runId}:${variant.id}`);
 for(const original of inputs){
  if(failed)break;
  const id=String(original.target.match_id),publishedAt=original.target.cutoff_unix*1000,at=publishedAt-1;
  const file=path.join(out,`${id}-${variant.id}.json`);
  let cached:any;try{cached=JSON.parse(await readFile(file,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(cached){store.publish(cached.draftId,`pilot:${id}:${variant.id}`,publishedAt,cached.text);console.log('resumed',variant.id,id);continue;}
  for(const c of original.chat_before){
   const persona=PLAYER_PERSONAS.find(p=>p.name===c.author||p.aliases.includes(c.author));
   const configured=ALL_PLAYERS.find(p=>p.steamId===persona?.accountId);
   store.addChat({scope,messageId:c.id,at:Date.parse(c.date),authorId:configured?.telegramId??`export:${c.author}`,authorName:c.author,text:c.text,replyTo:c.reply_to??undefined});
  }
  const prior=store.context(scope,[],at).recentPublications;
  const input={...original,previous_bot_posts:prior.map(p=>({date:new Date(p.at).toISOString(),text:p.text})),
   previous_bot_posts_note:'Только реально полученные предыдущие тексты ЭТОГО варианта пилота. Исторические ответы людей в chat_before не являются реакциями на эти гипотетические тексты.',
   meta_context:{available:false,reason:'Нет исторического снимка ProTracker; не выдавать сегодняшний рейтинг героев за мету на дату игры.'}};
  const players=original.facts.ourPlayers.map((p:any)=>({accountId:p.accountId??Number(BigInt(p.steamId)-76561197960265728n),name:p.name}));
  try{
   const result=await generateVoiceDraft({store,scope,matchId:Number(id),matchAt:original.facts.match.start_time*1000,at,players,input,model,
    systemPrompt:system+'\n\n'+variant.prompt,
    onResponse:async(request,response)=>{await writeFile(path.join(out,`${id}-${variant.id}.raw.json`),JSON.stringify({request,response},null,2));}});
   const saved={match_id:id,variant:variant.id,title:variant.title,text:result.text,draftId:result.id,memoryBefore:result.memoryBefore,patches:result.patches,request:result.request,response:result.response,generated_at:new Date().toISOString()};
   await writeFile(file,JSON.stringify(saved,null,2));
   const publication=store.publish(result.id,`pilot:${id}:${variant.id}`,publishedAt,result.text);
   await writeFile(path.join(out,`${id}-${variant.id}.memory.json`),JSON.stringify({publication,after:store.context(scope,players.map((p:any)=>p.accountId),publishedAt+1)},null,2));
   console.log('saved',variant.id,id,result.response.usage?.total_tokens,'patches',result.patches.length);
  }catch(error){failed=true;console.error('Pilot stopped',variant.id,id,error instanceof Error && !(error as any).status?error.message:'provider error; inspect status without credentials');throw error;}
 }
}
const results=await Promise.allSettled(variants.map(runVariant));
if(results.some(r=>r.status==='rejected'))process.exitCode=1;
store.close();
