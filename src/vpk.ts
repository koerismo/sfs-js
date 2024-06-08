import { FileType, type FileStat, type ReadableFileSystem } from './index.js';
import Path from 'path/posix';

const SIGNATURE = 0x55aa1234;
const VER_MIN = 1;
const VER_MAX = 2;
const LE = true;
const INDEX_INLINE = 0x7fff;

const SLASH = '/';

export interface VpkFileInfo {
	crc: number;
	preloadBytes: number;
	archiveIndex: number;
	offset: number;
	length: number;
}

export enum VpkVersion {
	INVALID = -1,
	NONE = 0,
	V1 = 1,
	V2 = 2,
}

export class VpkSystem implements ReadableFileSystem {
	public readonly fs: ReadableFileSystem;
	public readonly name: string; // XYZ
	public readonly path: string; // ABC/XYZ_dir.vpk
	public readonly root: string; // ABC/
	public version: VpkVersion = VpkVersion.NONE;

	files:  Record<string, VpkFileInfo> = {};
	dirs:   Record<string, true> = { '': true };
	cache?: Record<number, Uint8Array> = {};

	constructor(fs: ReadableFileSystem, path: string) {
		this.fs = fs;

		// Setup paths
		this.path = path;
		this.root = Path.dirname(path);
		this.name = Path.basename(path).slice(0,-8);
	}

	async parse(force: boolean=false): Promise<boolean> {
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

		const treeSize = view.getUint32(8, LE);

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
			const crc          =  view.getUint32(i,    LE);
			const preloadBytes =  view.getUint16(i+4,  LE);
			const archiveIndex =  view.getUint16(i+6,  LE);
			const entryOffset  =  view.getUint32(i+8,  LE);
			const entryLength  =  view.getUint32(i+12, LE);
			i += 16 + 2;
			i += preloadBytes;

			return {
				crc,
				preloadBytes,
				archiveIndex,
				offset: entryOffset,
				length: entryLength
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
				this.dirs[path] = true;
				let i=0;
				while ((i = path.indexOf('/', i+1)) !== -1) {
					this.dirs[path.slice(0, i)] = true;
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
		const number_string = ('00' + index).slice(-3);
		return Path.join(this.root, this.name+'_'+number_string+'.vpk');
	}

	async #getArchiveData(index: number): Promise<Uint8Array|undefined> {
		if (this.cache && index in this.cache) return this.cache[index];

		const archive_path = this.#getArchivePath(index);
		// If you're using the actual vscode API, that means this returns a node buffer. BE SURE TO ADD A UINT8ARRAY WRAPPER!!!
		const archive_data = await this.fs.readFile(archive_path);
		if (!archive_data) return undefined;
		if (!(archive_data instanceof Uint8Array)) throw Error(`Expected Uint8Array return from readFile!`);

		if (this.cache) this.cache[index] = archive_data;
		return archive_data;
	}

	async getFileInfo(path: string): Promise<VpkFileInfo|undefined> {
		if (!await this.validate()) return undefined;
		if (path in this.files) return this.files[path];
		return undefined;
	}

	async readFile(path: string): Promise<Uint8Array|undefined> {
		if (!await this.validate()) return undefined;
	
		const info = await this.getFileInfo(path);
		if (!info) return undefined;

		const archive_data = await this.#getArchiveData(info.archiveIndex);
		if (!archive_data) return undefined;

		const data = archive_data.slice(info.offset, info.offset+info.length);
		return data;
	}

	async readDirectory(path: string): Promise<[string, FileType][]|undefined> {
		if (!await this.validate()) return undefined;

		const out: [string, FileType][] = [];
		const included: Record<string, true> = {};

		for (const file in this.files) {
			if (!file.startsWith(path)) continue;
			const slash_pos = file.indexOf(SLASH, path.length+1);
			const is_dir = slash_pos !== -1;
			
			if (is_dir) {
				const dirname = file.slice(0, slash_pos);
				if (dirname === path) continue;
				if (dirname in included) continue;
				included[dirname] = true;
				out.push([dirname, FileType.Directory]);
			}
			else {
				out.push([file, FileType.File]);
			}
		}

		return out;
	}

	async stat(path: string): Promise<FileStat | undefined> {
		const file = await this.getFileInfo(path);
		if (file !== undefined) return { 
			ctime: 0,
			mtime: 0,
			size: file ? file.length : 0,
			type: file ? FileType.File : FileType.Directory,
		};

		if (path in this.dirs) return {
			ctime: 0,
			mtime: 0,
			size: 0,
			type: FileType.Directory,
		}

		return undefined;
	}
}
