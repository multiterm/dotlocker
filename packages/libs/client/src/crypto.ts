// Pluto is now a neutral file-sync service. Encryption/decryption, if any,
// belongs to callers before `pluto push` or after `pluto pull`.

export interface KeyMap {
  readonly [name: string]: string;
}
