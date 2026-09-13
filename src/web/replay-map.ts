import type {MatchApi} from '../opendota.js';
import type {ParsedMatch} from '../replay.js';
/** Valve overview metadata and texture from the installed 7.41 client. */
export function replayMap(match:ParsedMatch,api?:MatchApi){
 if(api?.match_id!==match.match_id||api.patch!==60||!['mode_22','mode_23','mode_4','mode_1'].includes(match.game_mode??''))return null;
 return {imageUrl:'/assets/dota-741-minimap.png',xMin:-9472,xMax:9472,yMin:-9472,yMax:9472,label:'Карта Valve · 7.41. События по реплею; область видимости не рассчитывается.'};
}
