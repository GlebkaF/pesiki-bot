import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {syncPlayerAvatars,readPlayerAvatar,playerAvatarUrl} from './player-avatars.js';
const dir=await mkdtemp(path.join(os.tmpdir(),'avatar-test-')),secret='TEST_TOKEN_NEVER_PERSIST',players=[{steamId:123,telegramId:999},{steamId:124}];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6AAAAAElFTkSuQmCC','base64');
let mode='valid',calls:string[]=[];let hydrated=false;
const fake:typeof fetch=async(input,init)=>{
 const url=String(input);calls.push(url);assert.equal(init?.redirect,'error');
 if(mode==='failure')throw Error('network '+secret);
 if(url.endsWith('getChatMember')){hydrated=true;return Response.json({ok:true,result:{user:{id:999},status:'member'}});}
 if(mode==='hydrate'&&!hydrated&&url.endsWith('getUserProfilePhotos'))return Response.json({ok:false,error_code:400,description:'Bad Request: user not found'},{status:400});
 if(url.endsWith('getUserProfilePhotos'))return Response.json({ok:true,result:{total_count:mode==='empty'?0:1,photos:mode==='empty'?[]:[[{file_id:'SECRET_FILE_ID',width:160,height:160}]]}});
 if(url.endsWith('getFile'))return Response.json({ok:true,result:{file_path:mode==='traversal'?'../bad':'photos/photo.png'}});
 if(mode==='oversize')return new Response(new Uint8Array(1024*1024+1),{headers:{'content-type':'image/png'}});
 return new Response(mode==='badmagic'?'not image':png,{headers:{'content-type':mode==='badmime'?'text/html':mode==='octet'?'application/octet-stream':'image/png'}});
};
try{
 let result=await syncPlayerAvatars({dataDir:dir,token:secret,players,fetch:fake});assert.deepEqual(result,{updated:1,removed:0,unavailable:0,skipped:1});
 const saved=readPlayerAvatar(123,dir)!;assert.ok(saved);assert.equal(saved.contentType,'image/png');assert.deepEqual(await readFile(saved.path),png);assert.match(playerAvatarUrl(123,dir)!,/^\/assets\/player-avatar\/123\?v=[a-f0-9]+$/);assert.equal(readPlayerAvatar(124,dir),null);
 const meta=await readFile(path.join(dir,'player-avatars','123.json'),'utf8');assert.ok(!meta.includes(secret)&&!meta.includes('SECRET_FILE_ID')&&!meta.includes('telegram'));
 for(const value of ['failure','traversal','oversize','badmagic','badmime']){mode=value;result=await syncPlayerAvatars({dataDir:dir,token:secret,players,fetch:fake});assert.equal(result.unavailable,1,value);assert.deepEqual(readPlayerAvatar(123,dir),saved,'previous avatar survives failed refresh');}
 assert.ok(calls.every(url=>url.includes('/getUserProfilePhotos')||url.includes('/getFile')||url.includes('/file/bot')),'no message calls');
 assert.equal((await readdir(path.join(dir,'player-avatars'))).filter(n=>n.endsWith('.tmp')).length,0);
 mode='octet';result=await syncPlayerAvatars({dataDir:dir,token:secret,players,fetch:fake});assert.equal(result.updated,1);assert.equal(readPlayerAvatar(123,dir)!.contentType,'image/png','Telegram octet-stream is safely typed from magic');
 mode='hydrate';result=await syncPlayerAvatars({dataDir:dir,token:secret,chatId:'test-chat',players,fetch:fake});assert.equal(result.updated,1);assert.ok(hydrated,'read-only group member lookup hydrates unknown user before retry');
 mode='empty';result=await syncPlayerAvatars({dataDir:dir,token:secret,players,fetch:fake});assert.equal(result.removed,1);assert.equal(readPlayerAvatar(123,dir),null);assert.equal(playerAvatarUrl(123,dir),null);assert.deepEqual(await readdir(path.join(dir,'player-avatars')),[]);
 assert.equal(readPlayerAvatar(NaN,dir),null);assert.equal(readPlayerAvatar(-1,dir),null);
 await writeFile(path.join(dir,'player-avatars','123.json'),JSON.stringify({file:'../secret',contentType:'image/png',etag:'a'.repeat(64),size:20}));assert.equal(readPlayerAvatar(123,dir),null,'metadata cannot escape avatar directory');
 calls=[];result=await syncPlayerAvatars({dataDir:dir,token:'',players,fetch:fake});assert.equal(result.skipped,2);assert.equal(calls.length,0);
 console.log('Player avatar tests passed: downloads, MIME/magic/size bounds, atomic cache, token-free metadata, no-photo removal, old avatar on failure, safe local URLs.');
}finally{await rm(dir,{recursive:true,force:true});}
