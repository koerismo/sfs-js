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
