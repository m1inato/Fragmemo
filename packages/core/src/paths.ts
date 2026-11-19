// Library layout. Every path is relative to the Library root and built here, so the on-disk
// format has one definition.

export const paths = {
  settings: 'settings.json',
  inbox: 'inbox.jsonl',
  profile: (lang: string) => `profile.${lang}.md`,
  decks: 'decks',
  deck: (deckId: string) => `decks/${safeSegment(deckId)}`,
  deckMeta: (deckId: string) => `decks/${safeSegment(deckId)}/deck.json`,
  notes: (deckId: string) => `decks/${safeSegment(deckId)}/notes.jsonl`,
  templates: (deckId: string) => `decks/${safeSegment(deckId)}/tpl`,
  template: (deckId: string, name: string) => `decks/${safeSegment(deckId)}/tpl/${safeSegment(name)}`,
  media: (deckId: string, file: string) => `decks/${safeSegment(deckId)}/media/${safeSegment(file)}`,
  logs: 'logs',
  deviceLogs: (device: string) => `logs/${safeSegment(device)}`,
  logFile: (device: string, month: string) => `logs/${safeSegment(device)}/${safeSegment(month)}.jsonl`
}

/** A single path segment that cannot climb out of its directory. */
export function safeSegment(s: string): string {
  if (!s || s === '.' || s === '..' || /[/\\\0]/.test(s)) throw new Error(`invalid path segment: ${JSON.stringify(s)}`)
  return s
}

/** Turn an arbitrary name (e.g. an Anki note type) into a portable directory name. */
export function toSegment(name: string): string {
  const s = name.replace(/[/\\:*?"<>|\0-\x1f]/g, '_').replace(/^\.+/, '_').trim().slice(0, 80)
  return s || '_'
}

/** Normalize a relative POSIX path and reject anything absolute or escaping the root. */
export function normalizeRelative(p: string): string {
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.includes('\0')) throw new Error(`absolute path not allowed: ${p}`)
  const out: string[] = []
  for (const seg of p.split(/[/\\]+/)) {
    if (!seg || seg === '.') continue
    if (seg === '..') throw new Error(`path escapes library: ${p}`)
    out.push(seg)
  }
  if (!out.length) throw new Error('empty path')
  return out.join('/')
}
