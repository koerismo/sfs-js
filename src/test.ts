import { GameSystem } from './index.js';
import { NodeSystem } from './fs.node.js';

const nfs = new NodeSystem();
// const game = new GameSystem(nfs, '/Users/jadon/Library/Application Support/Steam/steamapps/common/Portal 2 Community Edition/p2ce/');
const game = new GameSystem(nfs, '/Users/jadon/Library/Application Support/Steam/steamapps/common/GarrysMod/garrysmod/');
console.log(await game.readDirectory(''), game.name)