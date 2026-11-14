import { GameSystem, SteamCache, findSteamCache } from './index.js';
import { NodeSystem } from './fs.node.js';

const nfs = new NodeSystem();
const steam = await SteamCache.get(nfs, 'F:/SteamApp/');
// const steam = findSteamCache(nfs);

const path_portal2 = await steam.findGame('620');
console.log(path_portal2);
if (!path_portal2) throw 'Could not find test game!';
const portal2 = new GameSystem(nfs, path_portal2 + 'portal2');

console.log('Portal 2 loaded!', await portal2.validate());
// console.log(await portal2.readDirectory(''), portal2.name)
