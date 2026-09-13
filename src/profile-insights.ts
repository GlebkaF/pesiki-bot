import type { ProfileMatch } from "./player-profile.js";

const summary=(matches:ProfileMatch[])=>{
  const known=matches.filter(m=>m.win!==null),kda=matches.filter(m=>m.kda),apm=matches.filter(m=>m.apm);
  const sums=kda.reduce((v,m)=>v.map((n,i)=>n+m.kda![i]),[0,0,0]);
  return {games:matches.length,known:known.length,wins:known.filter(m=>m.win).length,
    winRate:known.length?known.filter(m=>m.win).length/known.length:null,
    kda:kda.length?(sums[0]+sums[2])/Math.max(1,sums[1]):null,kdaGames:kda.length,
    apm:apm.length?apm.reduce((s,m)=>s+m.apm!.apm,0)/apm.length:null,apmGames:apm.length};
};
// Lower bound of the 95% Wilson interval. Used only to sort personal results,
// never presented as a global rank or a causal measure of hero strength.
export function conservativeWinRate(wins:number,total:number){
  if(!Number.isSafeInteger(total)||total<=0||!Number.isSafeInteger(wins)||wins<0||wins>total)return 0;const z=1.96,p=wins/total;
  return Math.max(0,(p+z*z/(2*total)-z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total)))/(1+z*z/total));
}
export function profileInsights(matches:ProfileMatch[]){
  const dated=matches.filter(m=>typeof m.start === "number" && Number.isFinite(m.start) && m.start>0).sort((a,b)=>b.start!-a.start!||b.id-a.id);
  const recent=dated.slice(0,10),previous=dated.slice(10,20);
  const mastery=[...new Set(matches.map(m=>m.hero))].map(hero=>{
    const games=matches.filter(m=>m.hero===hero),stats=summary(games);
    return {hero,...stats,score:conservativeWinRate(stats.wins,stats.known)};
  }).sort((a,b)=>b.score-a.score||b.known-a.known||a.hero.localeCompare(b.hero));
  const matchups=(field:"allyHeroes"|"enemyHeroes")=>{
    const heroes=new Map<string,ProfileMatch[]>();
    for(const m of matches)for(const hero of new Set(m[field]??[]))heroes.set(hero,[...(heroes.get(hero)??[]),m]);
    return [...heroes].map(([hero,games])=>({hero,...summary(games)})).sort((a,b)=>b.known-a.known||a.hero.localeCompare(b.hero));
  };
  return {recent:summary(recent),previous:summary(previous),recentMatches:recent,
    comparisonReady:recent.length===10&&previous.length===10,mastery,
    allies:matchups("allyHeroes"),enemies:matchups("enemyHeroes"),
    rosterGames:matches.filter(m=>m.enemyHeroes?.length).length};
}
