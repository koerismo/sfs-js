import { FileType, type FileStat, type ReadableFileSystem } from './index.js';
import { workspace, Uri } from 'vscode';

export class VSCodeSystem implements ReadableFileSystem {

	async readFile(path: string): Promise<Uint8Array | undefined> {
		return new Uint8Array(await workspace.fs.readFile(Uri.file(path)));
	}

	async readDirectory(path: string): Promise<[string, FileType][] | undefined> {
		return workspace.fs.readDirectory(Uri.file(path));
	}

	async stat(path: string): Promise<FileStat | undefined> {
		return workspace.fs.stat(Uri.file(path));
	}
}
