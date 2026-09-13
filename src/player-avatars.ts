import {mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {readFileSync,statSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {PLAYERS,config} from './config.js';
import {getProxiedFetch} from './proxy.js';
const MAX_BYTES=1024*1024;
const defaultData=()=>process.env.DATA_DIR||'data';
const validAccount=(v:number)=>Number.isSafeInteger(v)&&v>0&&v<=4294967295;
interface Metadata {file:string;contentType:'image/jpeg'|'image/png'|'image/webp';size:number;etag:string;updatedAt:number}
export interface PlayerAvatar {path:string;contentType:Metadata['contentType'];size:number;etag:string}
export interface AvatarSyncCounts {updated:number;removed:number;unavailable:number;skipped:number}
const folder=(dataDir:string)=>path.join(dataDir,'player-avatars');
function metadata(account:number,dataDir:string):Metadata|null {
 if(!validAccount(account))return null;
 try{const m=JSON.parse(readFileSync(path.join(folder(dataDir),account+'.json'),'utf8'));
  if(!/^[a-f0-9]{64}$/.test(m.etag)||!['image/jpeg','image/png','image/webp'].includes(m.contentType)||!Number.isSafeInteger(m.size)||m.size<=0||m.size>MAX_BYTES||!new RegExp('^'+account+'-[a-f0-9]{64}\\.(jpg|png|webp)$').test(m.file))return null;
  return m;
 }catch{return null;}
}
/** Local-only read; never returns Telegram identifiers or token-bearing URLs. */
export function readPlayerAvatar(account:number,dataDir=defaultData()):PlayerAvatar|null {
 const m=metadata(account,dataDir);if(!m)return null;const file=path.join(folder(dataDir),m.file);
 try{const s=statSync(file);if(!s.isFile()||s.size!==m.size)return null;return {path:file,contentType:m.contentType,size:m.size,etag:m.etag};}catch{return null;}
}
export function playerAvatarUrl(account:number,dataDir=defaultData()):string|null {
 const m=readPlayerAvatar(account,dataDir);return m?`/assets/player-avatar/${account}?v=${m.etag.slice(0,16)}`:null;
}
async function bounded(response:Response,limit:number,allowError=false):Promise<Buffer>{
 if((!allowError&&!response.ok)||!response.body)throw Error('avatar-response');
 const length=response.headers.get('content-length');if(length&&Number(length)>limit){await response.body.cancel();throw Error('avatar-size');}
 const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
 try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>limit)throw Error('avatar-size');parts.push(r.value);}}finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(parts);
}
function imageType(data:Buffer,header:string):{contentType:Metadata['contentType'];extension:string}|null{
 const type=header.split(';')[0].trim().toLowerCase();
 if((type==='image/jpeg'||type==='application/octet-stream')&&data.length>3&&data[0]===255&&data[1]===216&&data[2]===255)return {contentType:'image/jpeg',extension:'jpg'};
 if((type==='image/png'||type==='application/octet-stream')&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {contentType:'image/png',extension:'png'};
 if((type==='image/webp'||type==='application/octet-stream')&&data.length>=12&&data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP')return {contentType:'image/webp',extension:'webp'};
 return null;
}
async function atomic(file:string,contents:Buffer|string){const temp=file+'.'+randomUUID()+'.tmp';try{await writeFile(temp,contents,{mode:0o600,flag:'wx'});await rename(temp,file);}finally{await unlink(temp).catch(()=>{});}}
export interface AvatarSyncOptions {dataDir?:string;token?:string;fetch?:typeof fetch;players?:{steamId:number;telegramId?:number}[];chatId?:string}
/** Read-only Bot API methods only (https://core.telegram.org/bots/api#getuserprofilephotos).
 * All errors are reduced to counts to avoid URL/token leakage. */
export async function syncPlayerAvatars(options:AvatarSyncOptions={}):Promise<AvatarSyncCounts>{
 const counts:AvatarSyncCounts={updated:0,removed:0,unavailable:0,skipped:0};
 const dataDir=options.dataDir??defaultData(),token=options.token??config.telegramBotToken,players=options.players??PLAYERS;
 if(!token){counts.skipped=players.length;return counts;}
 const fetcher=options.fetch??await getProxiedFetch();await mkdir(folder(dataDir),{recursive:true,mode:0o700});
 const api=async(method:'getUserProfilePhotos'|'getFile'|'getChatMember',payload:object)=>{
  const response=await fetcher(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000),redirect:'error'});
  const body=JSON.parse((await bounded(response,256*1024,true)).toString('utf8'));if(!response.ok||body.ok!==true||!body.result){const error=Error('avatar-api') as Error&{hydrate?:boolean};error.hydrate=body.error_code===400&&/user.?not.?found/i.test(String(body.description));throw error;}return body.result;
 };
 for(const p of players){
  if(!validAccount(p.steamId)||!Number.isSafeInteger(p.telegramId)||p.telegramId!<=0){counts.skipped++;continue;}
  try{
   const photos=()=>api('getUserProfilePhotos',{user_id:p.telegramId,offset:0,limit:1});
   let result;try{result=await photos();}catch(error){
    const chatId=options.chatId??config.telegramChatId;
    if(!(error as {hydrate?:boolean}).hydrate||!chatId)throw Error('avatar-unavailable');
    // Bot API may not yet know an existing group member. This read-only lookup
    // hydrates Telegram's user cache; it never contacts the user or sends a message.
    const member=await api('getChatMember',{chat_id:chatId,user_id:p.telegramId});
    if(member.user?.id!==p.telegramId)throw Error('avatar-identity');
    result=await photos();
   }
   if(!Number.isSafeInteger(result.total_count)||result.total_count<0||!Array.isArray(result.photos))throw Error('avatar-shape');
   const old=metadata(p.steamId,dataDir);
   if(result.total_count===0){await unlink(path.join(folder(dataDir),p.steamId+'.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});if(old)await unlink(path.join(folder(dataDir),old.file)).catch(()=>{});counts.removed++;continue;}
   const variants=result.photos[0];if(!Array.isArray(variants))throw Error('avatar-shape');
   const photo=variants.filter(v=>typeof v.file_id==='string'&&v.file_id.length>0&&Number.isSafeInteger(v.width)&&v.width>0&&Number.isSafeInteger(v.height)&&v.height>0&&(!v.file_size||v.file_size<=MAX_BYTES)).sort((a,b)=>b.width*b.height-a.width*a.height)[0];
   if(!photo)throw Error('avatar-photo');
   const file=await api('getFile',{file_id:photo.file_id});
   if(typeof file.file_path!=='string'||!file.file_path.split('/').every((s:string)=>/^[a-zA-Z0-9_.-]+$/.test(s)&&s!=='.'&&s!=='..')||(file.file_size&&file.file_size>MAX_BYTES))throw Error('avatar-file');
   const response=await fetcher(`https://api.telegram.org/file/bot${token}/${file.file_path}`,{signal:AbortSignal.timeout(20000),redirect:'error'});
   const bytes=await bounded(response,MAX_BYTES),type=imageType(bytes,response.headers.get('content-type')||'');if(!type)throw Error('avatar-mime');
   const etag=createHash('sha256').update(bytes).digest('hex'),name=`${p.steamId}-${etag}.${type.extension}`;
   const next:Metadata={file:name,contentType:type.contentType,size:bytes.length,etag,updatedAt:Date.now()};
   await atomic(path.join(folder(dataDir),name),bytes);await atomic(path.join(folder(dataDir),p.steamId+'.json'),JSON.stringify(next));
   if(old&&old.file!==name)await unlink(path.join(folder(dataDir),old.file)).catch(()=>{});counts.updated++;
  }catch{counts.unavailable++;}
 }
 return counts;
}

let backgroundStarted=false;
/** Main bot process only. A daily refresh preserves prior files on transient errors. */
export function startPlayerAvatarSync():void {
 if(backgroundStarted||!config.telegramBotToken||!config.telegramChatId)return;
 backgroundStarted=true;
 let running=false;
 const sync=async()=>{if(running)return;running=true;try{console.log('[AVATARS] '+JSON.stringify(await syncPlayerAvatars()));}catch{console.log('[AVATARS] refresh unavailable');}finally{running=false;}};
 const initial=setTimeout(()=>void sync(),30000);initial.unref();
 const daily=setInterval(()=>void sync(),24*60*60*1000);daily.unref();
}
