/** Stable assignment shared by Telegram and web; retries keep the same arm. */
export const VOICE_EXPERIMENT = 'voice-parity-v1';
export type VoiceVariant = 'legacy' | 'new';
export function voiceVariantForMatch(matchId:number):VoiceVariant {
  if(!Number.isSafeInteger(matchId)||matchId<=0)throw Error('Invalid match ID');
  return matchId%2===0?'legacy':'new';
}

/** Preserve the entire existing НАШИ section, including its player comments. */
export function replaceNarrative(legacy:string,body:string):string {
  const boundary=/\n\s*👤\s*НАШИ\s*\n/iu.exec(legacy);
  if(!boundary)throw Error('Legacy analysis has no НАШИ section');
  if(!body.trim()||/👤\s*НАШИ/iu.test(body))throw Error('New voice must contain only the narrative');
  return body.trim()+legacy.slice(boundary.index);
}

export async function generateRolloutText(matchId:number,deps:{
  legacy:()=>Promise<string>;
  modern:()=>Promise<{text:string;id:string}>;
}):Promise<{text:string;variant:VoiceVariant;draftId?:string}> {
  const variant=voiceVariantForMatch(matchId);
  // The old generator still owns НАШИ in both arms. Only the narrative changes.
  const legacy=await deps.legacy();
  if(variant==='legacy')return {text:legacy,variant};
  const modern=await deps.modern();
  return {text:replaceNarrative(legacy,modern.text),variant,draftId:modern.id};
}
