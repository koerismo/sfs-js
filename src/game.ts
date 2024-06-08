import { FileType, InitState, type FileStat, type ReadableFileSystem } from './index.js';
import { VpkSystem } from './vpk.js';

import { parse as parseStringKV, KeyVRoot, KeyV } from 'fast-vdf';
import { join, normalize, relative } from 'path/posix';
// import { globSync } from 'glob';

const RE_PATH_GI = /\|(gameinfo_path)\|/gi;
const RE_PATH_ASP = /\|(all_source_engine_paths)\|/gi;
function parseSearchPath(sp: string, paths: { game?: string, mod: string, gi: string }): string|undefined {
	const has_gi = RE_PATH_GI.test(sp);
	if (has_gi || RE_PATH_ASP.test(sp)) {
		if (!has_gi && paths.game === undefined) return undefined;
		sp = sp.replaceAll(RE_PATH_GI, paths.gi+'/').replaceAll(RE_PATH_ASP, paths.mod+'/');
		return normalize(sp);
	}

	if (paths.game === undefined) return undefined;
	return normalize(join(paths.game, sp));
}

// function parse2(path: string, config: { mod: string, cwd: string, game?: string }) {
// 	return {
		
// 	}
// }

// function matchSearchPath(fs: ReadableFileSystem, sp: string): string[] {
// 	if (!(fs instanceof NodeSystem)) throw Error(`Glob searching in virtual filesystems is not implemented!`);
// 	return globSync(sp);
// }

/** A simple folder-specific filesystem that works within the provided filesystem. */
export class FolderSystem implements ReadableFileSystem {
	public readonly fs: ReadableFileSystem;
	public readonly root: string;

	constructor(fs: ReadableFileSystem, root: string) {
		this.fs = fs;
		this.root = root;
	}

	async validate() {
		try {
			return (await this.fs.stat(this.root)) !== undefined;
		}
		catch {
			return false;
		}
	}

	getPath(path: string): string {
		return join(this.root, path);
	}

	async readFile(path: string): Promise<Uint8Array | undefined> {
		try {
			return await this.fs.readFile(join(this.root, path));
		}
		catch {
			return undefined;
		}
	}

	async readDirectory(path: string): Promise<[string, FileType][] | undefined> {
		try {
			const items = await this.fs.readDirectory(join(this.root, path));
			if (items === undefined) return undefined;
			return items;
		}
		catch {
			return undefined;
		}
	}

	async stat(path: string): Promise<FileStat | undefined> {
		try {
			return await this.fs.stat(join(this.root, path));
		}
		catch {
			return undefined;
		}
	}
}

/** Shorthand function for parsing bytes as keyvalues */
function parseKV(text: string|Uint8Array|undefined): KeyVRoot|undefined {
	if (!text) return undefined;
	if (typeof text !== 'string') text = new TextDecoder().decode(text);
	return parseStringKV(text, { escapes: false, multilines: false, types: false });
}

/** Locates games within the user's Steam library. */
export class SteamCache {
	public fs: ReadableFileSystem;
	public root: string;
	
	cache: Record<string, string> = {};
	initialized: InitState = InitState.None;
	
	static cachecache: Record<string, SteamCache> = {};
	public static get(fs: ReadableFileSystem, root: string) {
		// If one with the same root already exists, we don't need to re-parse everything again.
		if (root in this.cachecache && this.cachecache[root].fs === fs) return this.cachecache[root];
		return this.cachecache[root] = new SteamCache(fs, root);
	}

	constructor(fs: ReadableFileSystem, root: string) {
		this.fs = fs;
		this.root = root;
	}

	async parse(): Promise<boolean> {
		this.initialized = InitState.Error;;

		// Get the list of libraries
		const libfolders_bytes = await this.fs.readFile(join(this.root, 'steamapps/libraryfolders.vdf'));
		const libfolders = parseKV(libfolders_bytes);
		if (!libfolders) return false;

		const lf_root = libfolders.dir('libraryfolders');
		for (const library of lf_root.all()) {
			if (library instanceof KeyV) continue;
			
			const lib_path = library.pair('path').string();
			const lib_apps = library.dir('apps').all().map(x => x.key);
			
			for (const app of lib_apps) {
				const appmanifest_bytes = await this.fs.readFile(join(this.root, 'steamapps/appmanifest_'+app+'.acf'));
				const appmanifest = parseKV(appmanifest_bytes);
				if (!appmanifest) continue;
				
				const app_root = appmanifest.dir('AppState');
				const app_dir = app_root.pair('installdir').string();
				this.cache[app] = join(lib_path, 'steamapps/common', app_dir+'/');

				// Lots of info here, but we don't need most of it.
				// const app_name = app_root.pair('name').string();
			}
		}

		this.initialized = InitState.Ready;
		return true;
	}

	async findGame(appid: string): Promise<string|undefined> {
		try {
			if (!this.initialized) await this.parse();
			if (appid in this.cache) return this.cache[appid];
			return undefined;
		}
		catch {
			return undefined;
		}
	}
}

/** Represents a game filesystem. This filesystem exists in the context of the drive root. */
export class GameSystem implements ReadableFileSystem {
	public name!: string;
	public fs: ReadableFileSystem;
	public modroot: string;
	public gameroot?: string;
	public initialized: InitState = InitState.None;

	steam: SteamCache;
	providers: [string[], VpkSystem|FolderSystem][] = [];
	mounts: GameSystem[] = [];

	constructor(fs: ReadableFileSystem, root: string) {
		this.fs = fs;
		this.modroot = root;
		this.steam = SteamCache.get(fs, normalize(join(root, '../../../../')));
	}

	async parse(): Promise<boolean> {
		//
		// TODO: The names used all over this method SUCK ASS. Rewrite this thing!
		//

		this.initialized = InitState.Error;
		
		// Read & parse gameinfo
		const gameinfo_bytes = await this.fs.readFile(join(this.modroot, 'gameinfo.txt'));
		const gameinfo = parseKV(gameinfo_bytes);
		if (!gameinfo) return false;
		const gi_root = gameinfo.dir('GameInfo').dir('FileSystem');
		const gi_appid = gi_root.pair('SteamAppId').string();
		const gi_paths = gi_root.dir('SearchPaths');

		// Set title
		this.name = gi_root.parent!.pair('game').string();

		// Setup directories
		const dir_gi = this.modroot;
		const dir_cwd = normalize(join(dir_gi, '../'));
		const dir_game = this.gameroot = await this.steam.findGame(gi_appid);

		// Read Strata game mounts if present
		const gi_mounts = gi_root.parent!.dir('mount', null);
		if (gi_mounts) {
			for (const mount of gi_mounts.all()) {
				if (mount instanceof KeyV) continue;
				
				// Find app root
				const dir_mount_root = await this.steam.findGame(mount.key);
				if (!dir_mount_root) {
					console.error('Failed to mount game', mount.key);
					continue;
				}

				for (const mount_folder of mount.all()) {
					if (mount_folder instanceof KeyV) continue;
					
					for (const mount_item of mount_folder.all()) {
						if (!(mount_item instanceof KeyV)) continue;
						if (mount_item.key !== 'vpk') throw Error('TODO: IMPLEMENT MOUNT FOLDERS!!!');
						const mount_path = join(dir_mount_root, mount_folder.key, mount_item.string()+'_dir.vpk');
						this.providers.push([['game'], new VpkSystem(this.fs, mount_path)]);
					}
				}
			}
		}
		
		// Parse paths
		for (const path of gi_paths.all()) {
			if (!(path instanceof KeyV)) continue;

			let parsed = parseSearchPath(path.string(), { game: dir_game, mod: dir_cwd, gi: dir_gi });
			if (!parsed) {
				console.warn('Path', path.string(), 'failed. Could not locate game install!');
				continue;
			}

			// Game+Mod, GameBin, etc
			const qualifiers = path.key.toLowerCase().split('+').map(x => x.trim());

			// TODO: Sometimes paths use glob matching. Implement this!
			// matchSearchPath(...)
			
			if (parsed.endsWith('.vpk')) {
				parsed = parsed.slice(0, -4) + '_dir.vpk';
				this.providers.push([qualifiers, new VpkSystem(this.fs, parsed)]);
			}
			else {
				this.providers.push([qualifiers, new FolderSystem(this.fs, parsed)]);
			}
		}

		// TODO: This isn't totally necessary, since failed sources skip themselves. We do want to run the validation on all of them though.
		// Filter down providers to the ones that actually work
		const working: [string[], VpkSystem|FolderSystem][] = [];
		for (const provider of this.providers) {
			if (await provider[1].validate()) working.push(provider);
			else console.warn('Source', provider[1].getPath(''), 'failed validation. This may mean that it is missing or corrupted!');
		}

		this.providers = working;
		this.initialized = InitState.Ready;
		return true;
	}

	async validate() {
		try {
			if (!this.initialized) await this.parse();
			return this.initialized === InitState.Ready;
		}
		catch(e) {
			console.error(e);
			return false;
		}
	}

	async readFile(path: string, qualifier?: string): Promise<Uint8Array | undefined> {
		if (!await this.validate()) return undefined;

		for (const provider of this.providers) {
			if (qualifier && !provider[0].includes(qualifier)) continue;

			const file = await provider[1].readFile(path);
			if (file === undefined) continue;
			return file;
		}

		return undefined;
	}

	async getPath(path: string, qualifier?: string): Promise<string|undefined> {
		if (!await this.validate()) return undefined;

		for (const provider of this.providers) {
			if (qualifier && !provider[0].includes(qualifier)) continue;
			
			const file = await provider[1].stat(path);
			if (file === undefined) continue;
			return provider[1].getPath(path);
		}

		return undefined;
	}

	async readDirectory(path: string, qualifier?: string): Promise<[string, FileType][] | undefined> {
		if (!await this.validate()) return undefined;

		let exists = false;
		const found: Record<string, true> = {};
		const out: [string, FileType][] = [];

		for (const provider of this.providers) {
			if (qualifier && !provider[0].includes(qualifier)) continue;

			const files = await provider[1].readDirectory(path);
			if (files === undefined) continue;

			exists = true;
			f: for (const file of files) {
				if (found[file[0]]) continue f;
				found[file[0]] = true;
				out.push(file);
			}
		}
		
		if (exists) return out;
		return undefined;
	}

	async stat(path: string, qualifier?: string): Promise<FileStat | undefined> {
		if (!await this.validate()) return undefined;

		for (const provider of this.providers) {
			if (qualifier && !provider[0].includes(qualifier)) continue;

			const file = await provider[1].stat(path);
			if (file === undefined) continue;
			return file;
		}
		return undefined;
	}
}
