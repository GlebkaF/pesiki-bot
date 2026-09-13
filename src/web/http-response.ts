import type {ServerResponse} from 'node:http';
import {brotliCompress,gzip,constants} from 'node:zlib';
import {promisify} from 'node:util';
const brotli=promisify(brotliCompress),gzipAsync=promisify(gzip);
type Coding='br'|'gzip'|'identity';
/** Explicit exclusions override wildcards. Missing headers retain identity. */
export function responseCoding(header:string|undefined):{coding:Coding|null;identityAllowed:boolean}{
 if(!header?.trim())return {coding:'identity',identityAllowed:true};
 const weights=new Map<string,number>();
 for(const entry of header.split(',')){
  const [raw,...params]=entry.trim().split(';'),name=raw.trim().toLowerCase();if(!name)continue;
  let q=1;for(const param of params){const m=/^q\s*=\s*(.*)$/i.exec(param.trim());if(m)q=/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(m[1])?Number(m[1]):0;}
  weights.set(name,Math.min(weights.get(name)??1,q));
 }
 const identity=weights.get('identity')??(weights.get('*')===0?0:1),identityAllowed=identity>0;
 const choices=(['br','gzip'] as const).map(coding=>({coding,q:weights.get(coding)??weights.get('*')??0})).filter(x=>x.q>0).sort((a,b)=>b.q-a.q);
 if(choices.length){if(weights.has('identity')&&identity>choices[0].q)return {coding:'identity',identityAllowed};return {coding:choices[0].coding,identityAllowed};}
 return {coding:identityAllowed?'identity':null,identityAllowed};
}
/** Native async zlib runs in the worker pool; no synchronous compression on the bot event loop. */
export async function sendText(res:ServerResponse,status:number,body:string,type='text/html; charset=utf-8'):Promise<void>{
 const previous=res.getHeader('vary'),vary=[...(previous?String(previous).split(',').map(s=>s.trim()):[]),'Accept-Encoding'];
 const headers:Record<string,string|number>={'content-type':type,'cache-control':'no-store',vary:[...new Set(vary)].join(', ')};
 const negotiation=responseCoding(res.req.headers['accept-encoding']);
 if(negotiation.coding===null){res.writeHead(406,{...headers,'content-length':0});res.end();return;}
 if(status===204||status===304){res.writeHead(status,headers);res.end();return;}
 const original=Buffer.from(body);let bytes=original,coding=negotiation.coding;
 if(coding!=='identity'&&original.length<1024&&negotiation.identityAllowed)coding='identity';
 if(coding!=='identity'){
  try{bytes=coding==='br'?await brotli(original,{params:{[constants.BROTLI_PARAM_QUALITY]:4,[constants.BROTLI_PARAM_MODE]:constants.BROTLI_MODE_TEXT}}):await gzipAsync(original,{level:5});}
  catch{if(!negotiation.identityAllowed){if(!res.destroyed){res.writeHead(500,{...headers,'content-length':0});res.end();}return;}coding='identity';bytes=original;}
  if(bytes.length>=original.length&&negotiation.identityAllowed){coding='identity';bytes=original;}
 }
 if(res.destroyed||res.writableEnded)return;
 if(coding!=='identity')headers['content-encoding']=coding;
 headers['content-length']=bytes.length;res.writeHead(status,headers);res.end(res.req.method==='HEAD'?undefined:bytes);
}
