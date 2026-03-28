import { FileType, type FileStat, type ReadableFileSystem } from './index.js';
import { readFile, readdir, stat } from 'fs/promises';

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
			const dirItems = await readdir(path, { withFileTypes: true, recursive: false });
			const out = new Array<[string, FileType]>(dirItems.length);

			for (let i=0; i<out.length; i++) {
				const entry = dirItems[i];

				let type: FileType;
				if (entry.isFile()) type = FileType.File;
				else if (entry.isDirectory()) type = FileType.Directory;
				else if (entry.isSymbolicLink()) type = FileType.SymbolicLink;
				else type = FileType.Unknown;

				out[i] = [entry.name, type];
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
