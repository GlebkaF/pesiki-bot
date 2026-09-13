import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {gunzipSync,brotliDecompressSync} from 'node:zlib';
import {once} from 'node:events';
import {sendText,responseCoding} from './web/http-response.js';
const page='<html lang="ru"><body>'+('Матч — герои, события и аналитика. '.repeat(3000))+'</body></html>';
const job=JSON.stringify({stage:'unknown',message:'Задача не найдена'});
for(const [header,expected]of [[undefined,'identity'],['','identity'],['gzip','gzip'],['br, gzip','br'],['gzip;q=0','identity'],['br;q=0,gzip;q=0','identity'],['gzip;q=0.8,br;q=0.2','gzip'],['gzip;q=0,*;q=1','br'],['br;q=0,gzip;q=0,*;q=1','identity'],['*;q=0',null],['gzip;q=0,br;q=0,identity;q=0',null],['deflate,identity;q=0',null],['gzip;q=0.2,identity;q=0.9','identity'],['gzip;q=bogus','identity'],['GZip;Q=1.000','gzip'],['gzip;q=0,gzip;q=1','identity']] as const)assert.equal(responseCoding(header).coding,expected,String(header));
const server=createServer((req,res)=>{res.setHeader('Vary','Origin');const isJob=req.url==='/job';void sendText(res,isJob?404:req.url==='/error'?500:200,isJob?job:page,isJob?'application/json; charset=utf-8':'text/html; charset=utf-8');});server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as {port:number}).port;
const get=(header?:string,url='/',method='GET')=>new Promise<{body:Buffer;status:number;headers:Record<string,string|string[]|undefined>}>((resolve,reject)=>{const r=request({hostname:'127.0.0.1',port,path:url,method,headers:header===undefined?{}:{'accept-encoding':header}},res=>{const body:Buffer[]=[];res.on('data',c=>body.push(c));res.on('end',()=>resolve({body:Buffer.concat(body),status:res.statusCode!,headers:res.headers}));});r.on('error',reject);r.end();});
try{
 const identity=await get();assert.deepEqual(identity.body,Buffer.from(page));assert.equal(identity.headers['content-encoding'],undefined);
 for(const encoding of ['gzip','br'])for(const url of ['/','/error','/job']){const r=await get(encoding+',identity;q=0',url);assert.equal(r.headers['content-encoding'],encoding);assert.equal(r.headers['cache-control'],'no-store');assert.equal(r.headers.vary,'Origin, Accept-Encoding');assert.equal(Number(r.headers['content-length']),r.body.length);assert.equal(r.status,url==='/error'?500:url==='/job'?404:200);const plain=encoding==='gzip'?gunzipSync(r.body):brotliDecompressSync(r.body);assert.deepEqual(plain,Buffer.from(url==='/job'?job:page));}
 assert.deepEqual((await get('gzip;q=0')).body,identity.body);
 const excluded=await get('identity;q=0,br;q=0,gzip;q=0');assert.equal(excluded.status,406);assert.equal(excluded.body.length,0);
 const small=await get('gzip','/job');assert.equal(small.headers['content-encoding'],undefined);assert.equal(small.body.toString(),job);
 const head=await get('br','/','HEAD');assert.equal(head.status,200);assert.equal(head.body.length,0);assert.equal(head.headers['content-encoding'],'br');assert.equal(head.headers['content-length'],(await get('br')).headers['content-length']);
 // A real I/O callback runs while native compression is outstanding.
 let ioRan=false;const compression=get('br');setImmediate(()=>{ioRan=true});await compression;assert(ioRan);
 console.log('Async HTTP response tests passed: negotiation/q exclusions, gzip+brotli byte equality, HTML/error/jobs JSON, HEAD, Vary, no-store and async I/O.');
}finally{server.close();await once(server,'close');}
