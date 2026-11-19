import { createLibrary, normalizeRelative, type Library, type Storage } from '../src'
import type { SyncBackend } from '../src/platform'

export function memoryStorage(initial: Record<string, string | Uint8Array> = {}) {
  const files = new Map<string, Uint8Array>()
  const enc = new TextEncoder()
  for (const [p, v] of Object.entries(initial)) files.set(p, typeof v === 'string' ? enc.encode(v) : v)
  const storage: Storage = {
    async readText(p) {
      const b = files.get(normalizeRelative(p))
      return b ? new TextDecoder().decode(b) : null
    },
    async writeText(p, data) {
      files.set(normalizeRelative(p), enc.encode(data))
    },
    async appendText(p, data) {
      const key = normalizeRelative(p)
      const prev = files.get(key) ?? new Uint8Array()
      const add = enc.encode(data)
      const next = new Uint8Array(prev.length + add.length)
      next.set(prev)
      next.set(add, prev.length)
      files.set(key, next)
    },
    async list(dir) {
      const prefix = normalizeRelative(dir) + '/'
      const names = new Set<string>()
      for (const k of files.keys()) if (k.startsWith(prefix)) names.add(k.slice(prefix.length).split('/')[0])
      return [...names].sort()
    },
    async readBytes(p) {
      return files.get(normalizeRelative(p)) ?? null
    },
    async writeBytes(p, data) {
      files.set(normalizeRelative(p), data)
    }
  }
  return { storage, files, text: (p: string) => new TextDecoder().decode(files.get(p)) }
}

export function fakeClock(start = Date.UTC(2026, 10, 19, 12)) {
  let t = start
  return { now: () => t, set: (ms: number) => (t = ms), advance: (ms: number) => (t += ms) }
}

export function seqIds(prefix = 'N') {
  let i = 0
  return { ulid: () => `${prefix}${String(++i).padStart(6, '0')}` }
}

export function recordingSync(): SyncBackend & { commits: string[] } {
  const commits: string[] = []
  return {
    commits,
    async pull() {},
    async commit(m) {
      commits.push(m)
      return String(commits.length)
    },
    async push() {}
  }
}

export function testLibrary(initial: Record<string, string | Uint8Array> = {}, deviceId = 'mac-test') {
  const mem = memoryStorage(initial)
  const clock = fakeClock()
  const sync = recordingSync()
  const lib: Library = createLibrary({ storage: mem.storage, sync, clock, ids: seqIds(), deviceId })
  return { lib, mem, clock, sync }
}
