import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {request} from 'node:http';
import os from 'node:os';
import path from 'node:path';
const dir=await mkdtemp(path.join(os.tmpdir(),'avatar-http-')),cache=path.join(dir,'player-avatars'),account=94014640,port=3034;
// A real, complete 1×1 PNG rather than a signature-only mock.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=','base64');
const digest=createHash('sha256').update(png).digest('hex'),file=`${account}-${digest}.png`,etag=`"${digest}"`;
await mkdir(cache);await writeFile(path.join(cache,file),png);await writeFile(path.join(cache,`${account}.json`),JSON.stringify({file,contentType:'image/png',size:png.length,etag:digest,updatedAt:Date.now()}));
await writeFile(path.join(dir,'feed.json'),JSON.stringify({updatedAt:Date.now(),matches:[]}));
await writeFile(path.join(dir,'private.txt'),'AVATAR_TRAVERSAL_SENTINEL');
// Malicious on-disk metadata must not permit an escape either.
await writeFile(path.join(cache,'99.json'),JSON.stringify({file:'../private.txt',contentType:'image/png',size:25,etag:digest,updatedAt:Date.now()}));
const worker=spawn(process.execPath,['--import','tsx','--input-type=module','-e',`globalThis.fetch=async()=>{console.error('UNEXPECTED_NETWORK_CALL');throw Error('offline');};const {startWebServer}=await import('./src/web/server.ts');startWebServer(${port});`],{cwd:process.cwd(),env:{...process.env,DATA_DIR:dir,APM_DB_PATH:path.join(dir,'stats.sqlite'),FEED_SYNC_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
let output='';worker.stdout.on('data',c=>output+=c);worker.stderr.on('data',c=>output+=c);
const raw=(pathname:string,method='GET',headers:Record<string,string>={})=>new Promise<{status:number;headers:Record<string,string|string[]|undefined>;body:Buffer}>((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port,path:pathname,method,headers},res=>{const chunks:Buffer[]=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('error',reject);req.end();});
try{
 await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(output)),10000);worker.once('exit',()=>{clearTimeout(timer);reject(Error(output));});worker.stdout.on('data',c=>{if(String(c).includes('витрина на')){clearTimeout(timer);resolve();}});});
 const url=`/assets/player-avatar/${account}`;
 const get=await raw(url);assert.equal(get.status,200);assert.deepEqual(get.body,png);assert.equal(get.headers['content-type'],'image/png');assert.equal(get.headers.etag,etag);assert.equal(get.headers['content-length'],String(png.length));assert.equal(get.headers['x-content-type-options'],'nosniff');assert.equal(get.headers['cache-control'],'public, max-age=300');
 const head=await raw(url,'HEAD');assert.equal(head.status,200);assert.equal(head.body.length,0);assert.equal(head.headers['content-length'],String(png.length));assert.equal(head.headers.etag,etag);
 for(const method of ['GET','HEAD']){const cached=await raw(url,method,{'if-none-match':etag});assert.equal(cached.status,304);assert.equal(cached.body.length,0);assert.equal(cached.headers.etag,etag);}
 const stale=await raw(url,'GET',{'if-none-match':'"stale"'});assert.equal(stale.status,200);assert.deepEqual(stale.body,png);
 assert.deepEqual((await raw(url+'?v='+digest.slice(0,16))).body,png);
 for(const invalid of ['/assets/player-avatar/0','/assets/player-avatar/4294967296','/assets/player-avatar/777','/assets/player-avatar/99','/assets/player-avatar/../private.txt','/assets/player-avatar/%2e%2e/private.txt','/assets/player-avatar/%2e%2e%2fprivate.txt','/assets/player-avatar/94014640%2f..%2fprivate.txt','/assets/player-avatar/94014640.png']){const response=await raw(invalid);assert.equal(response.status,404,invalid);assert.ok(!response.body.includes('AVATAR_TRAVERSAL_SENTINEL'));}
 const missingHead=await raw('/assets/player-avatar/777','HEAD');assert.equal(missingHead.status,404);assert.equal(missingHead.body.length,0);
 await rm(path.join(cache,file));assert.equal((await raw(url)).status,404,'metadata without its image must fail closed');
 assert.ok(!output.includes('UNEXPECTED_NETWORK_CALL'),output);assert.ok(!output.includes('ошибка запроса'),output);
 console.log('Player avatar HTTP tests passed: exact PNG GET, HEAD, ETag304, stale ETag, local missing files, traversal and offline serving.');
}finally{const exited=once(worker,'exit');worker.kill('SIGTERM');await exited;await rm(dir,{recursive:true,force:true});}
