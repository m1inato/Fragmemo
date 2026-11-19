// Everything platform-specific is reached through these interfaces. Paths are POSIX paths
// relative to the Library root; implementations must refuse paths that escape it.

export interface Storage {
  readText(path: string): Promise<string | null>
  /** Atomic: write to `.tmp`, then rename. */
  writeText(path: string, data: string): Promise<void>
  appendText(path: string, data: string): Promise<void>
  /** Entry names directly under `dir`; empty when it does not exist. */
  list(dir: string): Promise<string[]>
  readBytes(path: string): Promise<Uint8Array | null>
  writeBytes(path: string, data: Uint8Array): Promise<void>
}

export interface SyncBackend {
  pull(): Promise<void>
  /** Returns the new commit hash, or null when there was nothing to commit. */
  commit(message: string): Promise<string | null>
  push(): Promise<void>
}

export interface Clock { now(): number }
export interface Ids { ulid(): string }

export const noSync: SyncBackend = {
  async pull() {},
  async commit() { return null },
  async push() {}
}

export const systemClock: Clock = { now: () => Date.now() }
