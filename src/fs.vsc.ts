import { FileType, type FileStat, type ReadableFileSystem } from './index.js';
import { workspace, Uri } from 'vscode';

export class VSCodeSystem implements ReadableFileSystem {

	async readFile(path: string): Promise<Uint8Array | undefined> {
		try {
			return new Uint8Array(await workspace.fs.readFile(Uri.file(path)));
		}
		catch {
			return;
		}
	}

	async readDirectory(path: string): Promise<[string, FileType][] | undefined> {
		try {
			return workspace.fs.readDirectory(Uri.file(path));
		}
		catch {
			return;
		}
	}

	async stat(path: string): Promise<FileStat | undefined> {
		try {
			return workspace.fs.stat(Uri.file(path));
		}
		catch {
			return;
		}
	}
}
