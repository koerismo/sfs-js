import { GameSystem, SteamCache } from './game.js';
import { VpkSystem } from './vpk.js';

export {
	GameSystem,
	VpkSystem,
	SteamCache
}

/** Implements a subset of the VSC FileSystem interface. */
export interface ReadableFileSystem {
	readFile(path: string): Promise<Uint8Array|undefined>;
	readDirectory(path: string): Promise<[string, FileType][]|undefined>;
	stat(path: string): Promise<FileStat|undefined>;
}

/** VSC FileType enum for library portability. */
export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64
}

/** VSC FileStat interface for library portability. */
export interface FileStat {
	type: FileType;
	ctime: number;
	mtime: number;
	size: number;
}

export enum InitState {
	None,
	Ready,
	Error
}
