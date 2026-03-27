export const enum ErrCode {
	Ok = 0,
	Unknown,
	SteamParseError,
	GameParseError,
	NoLibraryFoldersInfo,
	NoAppManifest,
	NoGameInfo,
	BadVpk,
	MissingVpk,
	UnsupportedVpk,
}

export const ErrCodeTable: Record<ErrCode, string> = {
	[ErrCode.Ok]: 'Ok',
	[ErrCode.Unknown]: 'Error',
	[ErrCode.SteamParseError]: 'Failed to parse Steam resources!',
	[ErrCode.GameParseError]: 'Failed to parse game resources!',
	[ErrCode.NoLibraryFoldersInfo]: 'Failed to find libraryfolders.vdf!',
	[ErrCode.NoAppManifest]: 'Failed to find appmanifest_*.acf!',
	[ErrCode.NoGameInfo]: 'Failed to find gameinfo.txt!',
	[ErrCode.BadVpk]: 'Failed to parse Vpk!',
	[ErrCode.MissingVpk]: 'Failed to find Vpk files!',
	[ErrCode.UnsupportedVpk]: 'Vpk version isn\'t supported!',
}

export class SfsError extends Error {
	constructor(
		public readonly code: ErrCode,
		message?: string,
	) {
		super(message ?? ErrCodeTable[code]);
	}
}
