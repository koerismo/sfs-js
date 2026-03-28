import { FileType, InitState, type FileStat, type ReadableFileSystem, __console__ as console } from './index.js';
import { VpkSystem } from './vpk.js';

import { parse as parseStringKV, KeyVRoot, KeyV, type KeyVChild } from 'fast-vdf';
import Path from 'path/posix';
import { platform } from 'os';

const GAMEINFO_PREFIX = '|gameinfo_path|';
const ALL_SOURCE_PREFIX = '|all_source_engine_paths|';


/** A simple folder-specific filesystem that works within the provided filesystem. */
export class FolderSystem implements ReadableFileSystem {
	public readonly kind = 'dir';
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
		return Path.join(this.root, path);
	}

	async readFile(path: string): Promise<Uint8Array | undefined> {
		try {
			return await this.fs.readFile(Path.join(this.root, path));
		}
		catch {
			return undefined;
		}
	}

	async readDirectory(path: string): Promise<[string, FileType][] | undefined> {
		try {
			const items = await this.fs.readDirectory(Path.join(this.root, path));
			if (items === undefined) return undefined;
			return items;
		}
		catch {
			return undefined;
		}
	}

	async stat(path: string): Promise<FileStat | undefined> {
		try {
			return await this.fs.stat(Path.join(this.root, path));
		}
		catch {
			return undefined;
		}
	}

	toString() {
		return `FolderSystem(path="${this.root}")`;
	}
}

export type MountableSystem = FolderSystem | VpkSystem;

/** Shorthand function for parsing bytes as keyvalues */
async function readKV(fs: ReadableFileSystem, path: string): Promise<KeyVRoot | undefined> {
	try {
		const bytes = await fs.readFile(path);
		if (!bytes) return undefined;
		const text = new TextDecoder().decode(bytes);
		return parseStringKV(text, { escapes: false, multilines: false, types: false });
	}
	catch {
		return undefined;
	}
}

/** Locates games within the user's Steam library. */
export class SteamCache {
	public fs: ReadableFileSystem;
	public root: string;

	applibcache: Record<string, string> = {};
	appdircache: Record<string, string|undefined> = {};
	public initialized: InitState = InitState.None;
	
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
		if (this.initialized) return this.initialized === InitState.Ready;
		this.initialized = InitState.Error;

		// Get the list of libraries
		const libfolders = await readKV(this.fs, Path.join(this.root, 'steamapps/libraryfolders.vdf'));
		if (!libfolders) return false;

		const lf_root = libfolders.dir('libraryfolders');
		for (const library of lf_root.all()) {
			if (library instanceof KeyV) continue;
			
			const lib_path = library.pair('path').string().replaceAll('\\\\', '/');
			const lib_apps = library.dir('apps').all().map(x => x.key);
			console.log(`Resolving ${lib_apps.length} apps from library '${lib_path}'`);
			
			for (const app of lib_apps) {
				this.applibcache[app] = lib_path;
			}
		}

		this.initialized = InitState.Ready;
		return true;
	}

	async parseGame(appid: string, force=false): Promise<string | undefined> {
		const lib_path = this.applibcache[appid];
		if (!lib_path) return undefined;
		if (!force && appid in this.appdircache) return undefined;

		const appmanifest = await readKV(this.fs, Path.join(lib_path, 'steamapps/appmanifest_'+appid+'.acf'));
		if (!appmanifest) return;

		try {
			const app_root = appmanifest.dir('AppState');
			const app_dir = app_root.pair('installdir').string();
			this.appdircache[appid] = Path.join(lib_path, 'steamapps/common', app_dir+'/');
		}
		catch(e) {
			console.error('Failed to parse appmanifest for appid', appid, e);
			this.appdircache[appid] = undefined;
		}

		// Lots of info here, but we don't need most of it.
		// const app_name = app_root.pair('name').string();
		return this.appdircache[appid];
	}

	async findGame(appid: string): Promise<string | undefined> {
		if (!this.initialized) await this.parse();
		if (!(appid in this.appdircache)) await this.parseGame(appid);
		return this.appdircache[appid];
	}

	async getInstalled(): Promise<string[]> {
		if (!this.initialized) await this.parse();
		return Object.keys(this.applibcache);
	}

	async getGameAssets(appid: string) {
		return {
			header: Path.join(this.root, 'appcache/librarycache', `${appid}_header.jpg`),
			hero: Path.join(this.root, 'appcache/librarycache', `${appid}_library_hero.jpg`),
			hero_blur: Path.join(this.root, 'appcache/librarycache', `${appid}_library_hero_blur.jpg`),
			card: Path.join(this.root, 'appcache/librarycache', `${appid}_library_600x900.jpg`),
			icon: Path.join(this.root, 'appcache/librarycache', `${appid}_icon.jpg`),
			logo: Path.join(this.root, 'appcache/librarycache', `${appid}_logo.png`),
		};
	}
}

export function findSteamCache(fs: ReadableFileSystem) {
	let steam_path: string;
	switch (platform()) {
		case 'win32':
			steam_path = 'C:/Program Files (x86)/Steam/';
			break;
		case 'darwin':
			steam_path = Path.join(process.env.HOME!, '/Library/Application Support/Steam/');
			break;
		default:
			steam_path = Path.join(process.env.HOME!, '/.steam/steam/');
	}
	return SteamCache.get(fs, steam_path);
}

const RE_3DIGITS = /^\d{3}$/;

/** Returns whether the given path is both a vpk path and does not end with three digits. */
export function isDirVpkPath(path: string) {
	if (path.slice(-4).toLowerCase() !== '.vpk') return false;
	if (RE_3DIGITS.test(path.slice(-7, -4))) return false;
	return true;
}

/** Represents a game filesystem. This filesystem exists in the context of the drive root. */
export class GameSystem implements ReadableFileSystem {
	name!: string;
	fs: ReadableFileSystem;
	modroot: string;
	appid?: string;
	gameroot?: string;
	preferVpks: boolean;
	state: InitState = InitState.None;

	steam: SteamCache;
	providers: [string[], MountableSystem][] = [];
	_providersSorted: [string[], MountableSystem][] = [];

	constructor(fs: ReadableFileSystem, root: string, steam?: SteamCache, preferVpks?: boolean) {
		this.fs = fs;
		this.modroot = root;
		this.steam = steam ?? findSteamCache(fs);
		this.preferVpks = preferVpks ?? true;
	}

	/**
	 * Returns an absolute path from the given SearchPath.
	 * - <none> = relative to game folder
	 * - |all_source_engine_paths| = relative to game folder
	 * - |gameinfo_path| = relative to modroot folder
	 */
	expandSearchPath(path: string): string | undefined {
		path = path.toLowerCase();

		if (path.at(-1) === '.' && path.at(-2) !== '.') {
			path = path.slice(0, -1);
		}

		if (path.startsWith(ALL_SOURCE_PREFIX)) {
			path = path.slice(ALL_SOURCE_PREFIX.length);
		}

		if (path.startsWith(GAMEINFO_PREFIX)) {
			return Path.join(this.modroot, path.slice(GAMEINFO_PREFIX.length));
		}
		else if (this.gameroot) {
			return Path.join(this.gameroot, path);
		}
	}

	protected _add(qualifiers: string[], sys: MountableSystem, atStart: boolean) {
		if (atStart)
			this.providers.unshift([qualifiers, sys])
		else
			this.providers.push([qualifiers, sys])
	}

	protected addFolder(qualifiers: string[], path: string, atStart = false) {
		this._add(qualifiers, new FolderSystem(this.fs, path), atStart);
	}

	protected addVpk(qualifiers: string[], path: string, atStart = false) {
		this._add(qualifiers, new VpkSystem(this.fs, path), atStart);
	}

	protected async parse(): Promise<boolean> {
		this.state = InitState.Error;

		// Read & parse gameinfo
		const gameinfo = await readKV(this.fs, Path.join(this.modroot, 'gameinfo.txt'));
		if (!gameinfo) throw Error('Cannot find gameinfo.txt!');

		const giRoot = gameinfo.dir('GameInfo').dir('FileSystem');
		const giAppid = giRoot.pair('SteamAppId').string();
		const giPaths = giRoot.dir('SearchPaths');

		// Set title
		this.name = giRoot.parent!.pair('game').string();
		this.appid = giAppid;
		
		// Find origin game through Steam, falling back to the parent folder if unavailable.
		this.gameroot = await this.steam.findGame(giAppid);
		if (!this.gameroot) {
			console.warn(`Could not find appid ${giAppid} via Steam! Using parent folder as fallback.`);
			this.gameroot = Path.join(this.modroot, '../');
		}

		// Read Strata game mounts if present
		let mounts: KeyVChild[] = [];

		// ... from gameinfo
		const gi_mounts = giRoot.parent!.dir('mount', null);
		if (gi_mounts) mounts = gi_mounts.all();

		// ... from config
		const cfg_mounts = await readKV(this.fs, Path.join(this.modroot, 'cfg', 'mounts.kv'));
		if (cfg_mounts) mounts = mounts.concat(cfg_mounts.dir('mounts').all());

		// Parse collected Strata mounts
		for (const mount of mounts) {
			if (mount instanceof KeyV)
				continue;
			if (mount.pair('enabled', null)?.bool() === false)
				continue;

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

					switch (mount_item.key) {
						case 'vpk': {
							let vpk_path = Path.join(dir_mount_root, mount_folder.key, mount_item.string());
							if (await this.fs.stat(vpk_path + '.vpk'))
								vpk_path += '.vpk';
							else
								vpk_path += '_dir.vpk';

							this.addVpk(['game'], vpk_path);
							break;
						}
						case 'dir': {
							const folder_path = Path.join(dir_mount_root, mount_folder.key, mount_item.string());
							this.addFolder(['game'], folder_path);
							break;
						}
						default: {
							console.error(`Unrecognized mount type "${mount_item.key}"`);
						}
					}

				}
			}
		}

		// Parse SearchPaths
		for (const giPath of giPaths.all()) {
			if (!(giPath instanceof KeyV)) continue;
			const qualifiers = giPath.key.toLowerCase().split('+').map(x => x.trim());

			let searchPath = this.expandSearchPath(giPath.string());
			if (!searchPath) {
				console.warn('Path', "'"+giPath.string()+"'", 'could not be resolved. Could not locate game install!');
				continue;
			}

			if (searchPath.endsWith('.vpk')) {

				// If this path doesn't exist, use XXX_dir.vpk instead.
				if (!(await this.fs.stat(searchPath)))
					searchPath = searchPath.slice(0, -4) + '_dir.vpk';

				this.addVpk(qualifiers, searchPath);

			} else {

				// We treat globs as allowing all items of the parent folder that start with the substring
				if (searchPath.endsWith('*')) {
					const parsedPath = Path.parse(searchPath);
					const matchStr = parsedPath.name.slice(0, -1);
					searchPath = parsedPath.dir;

					const subItems = await this.fs.readDirectory(searchPath);
					if (!subItems) continue;

					for (const [subItem, subType] of subItems) {
						if (!subItem.startsWith(matchStr)) continue;
						if (subType === FileType.Directory) {
							this.addFolder(qualifiers, Path.join(searchPath, subItem));
						}
						else if (subType === FileType.File && isDirVpkPath(subItem)) {
							this.addVpk(qualifiers, Path.join(searchPath, subItem));
						}
					}
				} else {
					// Simple normal paths!!
					this.addFolder(qualifiers, searchPath);

					// Find pak01_dir, etc. files in folder!
					// TODO: Refactor to allow wildcard folders to use these?
					let pakIdx = 0;
					while (true) {
						pakIdx ++;
						const strNN = pakIdx.toString().padStart(2, '0');
						const pathNN = Path.join(searchPath, `pak${strNN}_dir.vpk`);
						if (!(await this.fs.stat(pathNN))) break;
						this.addVpk(qualifiers, pathNN);
					}
				}

			} // if (searchPath.endsWith('.vpk')) else ...
		} // Parse SearchPaths


		// Find dlc folders!
		dlcs: if (this.providers.length) {
			const [qualifiers, system] = this.providers[0];
			if (system.kind !== 'dir') break dlcs; // sure hope it doesn't

			const folderPath = Path.parse(system.root);
			console.log(`Using path '${system.root}' to search for DLCs...`);

			let dlcIdx = 0;
			while (true) {
				dlcIdx ++;
				const subPath = Path.join(folderPath.dir, `${folderPath.name}_dlc${dlcIdx}`);
				if (!(await this.fs.stat(subPath))) break;
				this.addFolder(qualifiers, subPath, true);
			}

			console.log('Found', dlcIdx - 1, 'dlc folders!');
		}

		// Filter down providers to the ones that actually work
		const working: [string[], MountableSystem][] = [];
		for (const provider of this.providers) {
			if (await provider[1].validate()) working.push(provider);
			else console.warn('Source', "'"+provider[1].getPath('')+"'", 'failed validation. This may mean that it is missing or corrupted!');
		}

		this.providers = working;
		this._providersSorted = working.toSorted((a, b) => +(b[1].kind === 'vpk') - +(a[1].kind === 'vpk'));
		this.state = InitState.Ready;
		return true;
	}

	async validate() {
		try {
			if (!this.state) await this.parse();
			return this.state === InitState.Ready;
		}
		catch(e) {
			console.error(e);
			return false;
		}
	}

	async readFile(path: string, qualifier?: string, preferVpk=this.preferVpks): Promise<Uint8Array | undefined> {
		if (!await this.validate()) return;

		const providers = preferVpk ? this._providersSorted : this.providers;

		for (const [qualifiers, system] of providers) {
			if (qualifier && !qualifiers.includes(qualifier)) continue;

			const file = await system.readFile(path);
			if (file === undefined) continue;
			return file;
		}

		return;
	}

	async getRealPath(path: string, qualifier?: string, preferVpk=this.preferVpks): Promise<string | undefined> {
		const mount = await this.tracePathMount(path, qualifier, preferVpk);
		if (!mount) return;

		return mount[1].getPath(path);
	}

	async tracePathMount(path: string, qualifier?: string, preferVpk=this.preferVpks): Promise<[string[], MountableSystem] | undefined> {
		if (!await this.validate()) return;

		const providers = preferVpk ? this._providersSorted : this.providers;

		for (const provider of providers) {
			if (qualifier && !provider[0].includes(qualifier)) continue;

			const file = await provider[1].stat(path);
			if (file === undefined) continue;
			return provider;
		}

		return;
	}

	async readDirectory(path: string, qualifier?: string): Promise<[string, FileType][] | undefined> {
		if (!await this.validate()) return;

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
		return;
	}

	async stat(path: string, qualifier?: string): Promise<FileStat | undefined> {
		if (!await this.validate()) return;

		for (const [qualifiers, system] of this._providersSorted) {
			if (qualifier && !qualifiers.includes(qualifier)) continue;

			const file = await system.stat(path);
			if (file === undefined) continue;
			return file;
		}

		return undefined;
	}

	toString() {
		return `GameSystem(name="${this.name}")`;
	}
}
