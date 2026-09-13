import {syncPlayerAvatars} from './player-avatars.js';
try{console.log(JSON.stringify(await syncPlayerAvatars()));}catch{console.error('Player avatar sync unavailable');process.exitCode=1;}
