import { FileType, type FileStat, type ReadableFileSystem } from './index.js';
import { readFile, readdir, stat } from 'fs/promises';
import { join, relative } from 'path/posix';

export class NodeSystem implements ReadableFileSystem {
	async readFile(path: string): Promise<Uint8Array | undefined> {
		try {
			const file = await readFile(path);
			return new Uint8Array(file);
		}
		catch {
			return undefined;
		}
	}

	async readDirectory(path: string): Promise<[string, FileType][] | undefined> {
		try {
			const dir = await readdir(path, { withFileTypes: true, recursive: false });
			const out = new Array(dir.length);
			for (let i=0; i<out.length; i++) {
				const type = dir[i].isFile() ? FileType.File : FileType.Directory;
				const subpath = relative(path, join(path, dir[i].name));
				out[i] = [subpath, type];
			}
			return out;
		}
		catch {
			return undefined;
		}
	}

	async stat(path: string): Promise<FileStat | undefined> {
		try {
			const f = await stat(path);
			return {
				mtime: f.mtimeMs,
				ctime: f.ctimeMs,
				size: f.size,
				type: f.isFile() ? FileType.File : FileType.Directory,
			}
		}
		catch {
			return undefined;
		}
	}
}
