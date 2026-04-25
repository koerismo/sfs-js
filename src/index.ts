import { GameSystem, SteamCache, findSteamCache } from './game.js';
import { FileType, type FileStat } from './filetypes.js';
import { VpkSystem } from './vpk.js';

export function setLogTarget(target: typeof __console__) {
	if (!target) throw Error('Attempted to set console to undefined!')
	__console__ = target;
}

export let __console__: {
	log(...data: any[]): void;
	warn(...data: any[]): void;
	error(...data: any[]): void;
} = console;

export {
	GameSystem,
	VpkSystem,
	SteamCache,
	findSteamCache,

	FileType,
	FileStat,
}

/** Implements a subset of the VSC FileSystem interface. */
export interface ReadableFileSystem {
	readFile(path: string): Promise<Uint8Array|undefined>;
	readDirectory(path: string): Promise<[string, FileType][]|undefined>;
	stat(path: string): Promise<FileStat|undefined>;
}

export enum InitState {
	None,
	Ready,
	Error
}
