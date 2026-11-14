import { type ReadableFileSystem, __console__ as console } from './index.js';
import { FileType, type FileStat } from './filetypes.js';
import Path from 'path/posix';
import { makeExpoCache, type CacheConstructorReturn } from './cache.js';

const SIGNATURE = 0x55aa1234;
const VER_MIN = 1;
const VER_MAX = 2;
const LE = true;
const INDEX_INLINE = 0x7fff;

const SLASH = '/';

export interface VpkFileInfo {
	type: FileType.File;
	crc: number;
	preloadBytes: Uint8Array;
	archiveIndex: number;
	offset: number;
	length: number;
}

export interface VpkFolderInfo {
	type: FileType.Directory;
}

export enum VpkVersion {
	INVALID = -1,
	NONE = 0,
	V1 = 1,
	V2 = 2,
}

/**
 * The ideal path for a VPK is one which:
 * - Always starts with a `/`
 * - Never trails with a `/`
 */
export function normVpkPath(path: string) {
	if (path.at(-1) === '/') path = path.slice(0, -1);
	if (path.startsWith('./')) path = path.slice(1);
	else if (path.at(0) !== '/') path = '/' + path;
	return path;
}

// TODO: Add some form of cache cleaning to prevent memory usage buildup!
// TODO: Be more efficient with file reads & memory when accessing dir-inlined files!

export interface VpkSystemConfig {
	/** If true, VPK files will be kept in-memory as requested to avoid file re-reads. @default true */
	cacheEnable: boolean;
	/** If true, VPK files will be unloaded if there is no recent file activity. @default true */
	cacheCleaning: boolean;
}

function parseVpkSystemConfig(options?: Partial<VpkSystemConfig>) {
	options ??= {};
	options.cacheEnable ??= true;
	options.cacheCleaning ??= true;
	return options as VpkSystemConfig;
}


const FOLDER_ENTRY: Readonly<VpkFolderInfo> = Object.freeze({ type: FileType.Directory });

export class VpkSystem implements ReadableFileSystem {
	public readonly kind = 'vpk';
	public readonly fs: ReadableFileSystem;
	public readonly name: string; // XYZ
	public readonly path: string; // ABC/XYZ_dir.vpk
	public readonly root: string; // ABC/
	public version: VpkVersion = VpkVersion.NONE;

	config: VpkSystemConfig;
	protected files:  Record<string, VpkFileInfo | VpkFolderInfo> = { '/': FOLDER_ENTRY };
	protected cache?: Record<number, Uint8Array>;
	protected cacheTracker?: CacheConstructorReturn<number>;

	protected treeSize: number = 0;
	public readonly single: boolean;

	constructor(fs: ReadableFileSystem, path: string, config?: Partial<VpkSystemConfig>) {
		// TODO: What do we do if it ends with .VPK (capitalized)?
		if (!path.endsWith('.vpk')) path += '.vpk';

		this.fs = fs;
		this.single = !path.endsWith('_dir.vpk');
		this.config = parseVpkSystemConfig(config);

		if (this.config.cacheEnable) {
			this.cache = {};
			if (this.config.cacheCleaning) {
				this.cacheTracker = makeExpoCache(this.#onVpkInactive.bind(this));
			}
		}

		// Setup paths
		this.path = path;
		this.root = Path.dirname(path);
		this.name = Path.basename(path).slice(0, this.single ? -4 : -8);
	}

	dispose() {
		this.cacheTracker?.dispose();
	}

	protected async parse(force: boolean=false): Promise<boolean> {
		if (!force && this.version === VpkVersion.INVALID) return false;

		// In case an error is thrown, leave us on invalid.
		this.version = VpkVersion.INVALID;

		// Read _dir.vpk
		const bytes = (await this.fs.readFile(this.path))!;
		if (!bytes) return false;
		const view = new DataView(bytes.buffer);

		if (view.getUint32(0, LE) !== SIGNATURE) throw Error('Invalid vpk signature!');
		
		const version = view.getUint32(4, LE);
		if (version < VER_MIN || version > VER_MAX) throw Error(`Invalid vpk version! (${version})`);
		const SIZE_HEADER = version === 2 ? 28 : 12;
		this.version = version;
		this.treeSize = view.getUint32(8, LE);

		// V2 checksum stuff. Not used at the moment.
		if (version === 2) {
			const fileDataSize = view.getUint32(12, LE);
			const archiveMD5Size = view.getUint32(16, LE);
			const otherMD5Size = view.getUint32(20, LE);
			const signatureSectionSize = view.getUint32(24, LE);
		}

		const TD = new TextDecoder();
		let i = SIZE_HEADER;
		
		// The following was adapted from the pseudocode present on the VDC page.
		// https://developer.valvesoftware.com/wiki/VPK_(file_format)

		function readString(): string {
			const start = i;
			const end = bytes.indexOf(0x00, start);
			if (end === -1) {
				throw new Error('Failed to terminate string!');
			}
			i = end+1;
			return TD.decode(bytes.slice(start, end));
		}

		// struct VPKDirectoryEntry
		function readFileInfo(): VpkFileInfo {
			const crc           =  view.getUint32(i,    LE);
			const preloadLength =  view.getUint16(i+4,  LE);
			const archiveIndex  =  view.getUint16(i+6,  LE);
			const entryOffset   =  view.getUint32(i+8,  LE);
			const entryLength   =  view.getUint32(i+12, LE);
			i += 16 + 2;

			const preloadBytes = bytes.slice(i, i + preloadLength);
			i += preloadLength;

			return {
				type: FileType.File,
				crc,
				preloadBytes: preloadBytes,
				archiveIndex,
				offset: entryOffset,
				length: entryLength,
			};
		}

		// Read tree
		while (true) {
			const extension = readString();
			if (!extension.length) break;

			while (true) {
				let path = readString();
				if (!path.length) break;
				if (path === ' ') path = '';
				if (path.length && !path.startsWith('/')) path = '/' + path;


				// Add all subdirectories.
				// TODO: Is this performant at all?
				this.files[path] = FOLDER_ENTRY;

				let p = path.length;
				while ((p = path.lastIndexOf('/', p - 1)) > 0) {
					const subPath = path.slice(0, p);
					if (subPath in this.files) break;
					this.files[subPath] = FOLDER_ENTRY;
				}

				while (true) {
					const filename = readString();
					if (!filename.length) break;
					const fullpath = (path+'/'+filename+'.'+extension).trim();
					this.files[fullpath] = readFileInfo();
				}
			}
		}

		return true;
	}

	async validate() {
		try {
			if (this.version === VpkVersion.NONE) await this.parse();
		}
		catch(e) {
			console.error(e);
		}
		if (this.version === VpkVersion.INVALID) return false;
		return true;
	}

	getPath(path: string): string {
		return Path.join(this.path, path);
	}

	#getArchivePath(index: number): string {
		if (index === INDEX_INLINE) return this.path;
		const idx_string = (index + '').padStart(3, '0');
		return Path.join(this.root, `${this.name}_${idx_string}.vpk`);
	}

	cleanCache() {
		if (this.cache)
			this.cache = {};
	}

	#onVpkInactive(index: number) {
		if (!this.cache || !(index in this.cache)) return;
		delete this.cache[index];
	}

	async #getArchiveData(index: number): Promise<Uint8Array | undefined> {
		this.cacheTracker?.onActivity(index);

		const cached_data = this.cache?.[index];
		if (cached_data) return cached_data;

		const archive_path = this.#getArchivePath(index);
		// If you're using the actual vscode API, that means this returns a node buffer. BE SURE TO ADD A UINT8ARRAY WRAPPER!!!
		const archive_data = await this.fs.readFile(archive_path);
		if (!archive_data) return undefined;
		if (!(archive_data instanceof Uint8Array)) throw Error(`Expected Uint8Array return from readFile!`);

		if (this.cache) this.cache[index] = archive_data;
		return archive_data;
	}

	async getFileInfo(path: string): Promise<VpkFileInfo | VpkFolderInfo | undefined> {
		if (!await this.validate()) return undefined;
		path = normVpkPath(path);
		return this.files[path];
	}

	async readFile(path: string): Promise<Uint8Array | undefined> {
		if (!await this.validate()) return undefined;

		const info = await this.getFileInfo(path);
		if (!info || info.type !== FileType.File) return undefined;

		// Entire file is stored in preloadBytes
		if (!info.length) {
			return info.preloadBytes.slice();
		}

		let offset = info.offset;
		if (info.archiveIndex === INDEX_INLINE) {
			offset += this.treeSize;
		}

		const archive_data = await this.#getArchiveData(info.archiveIndex);
		if (!archive_data) return undefined;

		// Make a sub-array without cloning the buffer to avoid an unnecessary copy
		const archive_window = new Uint8Array(archive_data.buffer, offset, info.length);

		// Combine preloadBytes and body data in new buffer
		const out_data = new Uint8Array(info.length + info.preloadBytes.length);
		out_data.set(info.preloadBytes, 0);
		out_data.set(archive_window, info.preloadBytes.length);

		return out_data;
	}

	async readDirectory(path: string): Promise<[string, FileType][] | undefined> {
		if (!await this.validate()) return undefined;
		path = normVpkPath(path);

		const out: [string, FileType][] = [];

		for (const entryPath in this.files) {
			if (entryPath === path) continue;
			if (!entryPath.startsWith(path)) continue;

			const slash_pos = entryPath.indexOf(SLASH, path.length + 1);
			if (slash_pos !== -1) continue;

			out.push([Path.basename(entryPath), this.files[entryPath].type]);
		}

		return out;
	}

	async stat(path: string): Promise<FileStat | undefined> {
		const file = await this.getFileInfo(path);
		return file && { 
			ctime: 0,
			mtime: 0,
			size: file.type === FileType.File ? file.length : 0,
			type: file.type,
		};
	}

	toString() {
		return `VpkSystem(path="${this.path}")`;
	}
}
