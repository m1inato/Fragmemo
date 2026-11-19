const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** ULID from an explicit time and entropy source, so callers stay deterministic in tests. */
export function ulid(time: number, random: (n: number) => Uint8Array = randomBytes): string {
  let ts = ''
  for (let i = 9, t = time; i >= 0; i--) {
    ts = CROCKFORD[t % 32] + ts
    t = Math.floor(t / 32)
  }
  const bytes = random(16)
  let rand = ''
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i] % 32]
  return ts + rand
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

export function createIds(now: () => number = Date.now) {
  return { ulid: () => ulid(now()) }
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  // Copy into a plain ArrayBuffer-backed view; DOM typings reject views over SharedArrayBuffer.
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(data)))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

export const utf8 = {
  encode: (s: string) => new TextEncoder().encode(s),
  decode: (b: Uint8Array) => new TextDecoder().decode(b)
}

/** Parse JSON Lines, skipping blank and corrupt lines rather than losing the whole file. */
export function parseJsonl<T>(text: string | null): T[] {
  if (!text) return []
  const out: T[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as T)
    } catch {
      // A torn last line from an interrupted append is expected; skip it.
    }
  }
  return out
}

export function toJsonl(items: readonly unknown[]): string {
  return items.map((i) => JSON.stringify(i)).join('\n') + (items.length ? '\n' : '')
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const s = Array.from(a)
  const t = Array.from(b)
  if (!s.length) return t.length
  if (!t.length) return s.length
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i)
  for (let i = 1; i <= s.length; i++) {
    const cur = [i]
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[t.length]
}

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** `YYYY-MM` in local time, used to bucket log files. */
export function monthKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function isoDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Start of the learning day containing `ms`; days roll over at `startHour` local time, like Anki. */
export function dayStart(ms: number, startHour: number): number {
  const d = new Date(ms)
  d.setHours(startHour, 0, 0, 0)
  if (d.getTime() > ms) d.setDate(d.getDate() - 1)
  return d.getTime()
}

export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}
