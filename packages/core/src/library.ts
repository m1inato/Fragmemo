import type { AnkiCollection, SqlLoader } from './anki/apkg'
import { decodeEntities } from './anki/template'
import { pickDistractors } from './distractors'
import { pickMode } from './modes'
import { cardFaces, cardIdOf, noteDetail, noteTitle, noteKey, parseCardId, rawDisplay, type RawDisplay } from './notes'
import { normalizeRelative, paths, toSegment } from './paths'
import type { Clock, Ids, Storage, SyncBackend } from './platform'
import { applyReview, createScheduler, effectiveReviews, replay, type Scheduler } from './replay'
import { deckMetaSchema, noteSchema } from './schema'
import { mergeSettings, normalizeSettings, type Settings, type SettingsPatch } from './settings'
import type {
  AnswerMode, CardState, DeckMeta, DueCard, InboxItem, Lang, LogEntry, Note, Rating, RawNote, RawTemplate, ReviewEntry
} from './types'
import { dayStart, isoDate, monthKey, parseJsonl, sha256Hex, slugify, toJsonl, utf8 } from './util'

export interface LibraryDeps {
  storage: Storage
  sync: SyncBackend
  clock: Clock
  ids: Ids
  deviceId: string
  /** How to obtain sql.js; the default works in Node, a WebView host passes its wasm location. */
  loadSql?: SqlLoader
}

export interface DeckSummary extends DeckMeta {
  notes: number
  cards: number
  learned: number
  due: number
  /** New cards this deck can still introduce today, within the language's daily limit. */
  fresh: number
  /** A headword from the deck, for its cover. */
  sample?: string
}

/** Daily limits apply per language, so totals are not simply the sum of the decks. */
export interface LangSummary {
  lang: Lang
  cards: number
  learned: number
  due: number
  fresh: number
  decks: DeckSummary[]
}

export interface StudyActivity {
  /** Oldest first, ending today. */
  days: { date: string; count: number }[]
  /** Consecutive days with reviews, ending today (or yesterday, before today's first review). */
  streak: number
  recent: { id: string; term: string; deckId: string; deckName: string; at: number }[]
}

/** A note as a deck's list shows it. */
export interface NoteRow { note: Note; title: string; detail: string }

export interface ImportResult { deck: DeckMeta; added: number; updated: number }

export interface Library {
  settings(): Promise<Settings>
  saveSettings(patch: SettingsPatch): Promise<Settings>

  listDecks(): Promise<DeckMeta[]>
  /** Effective reviews per learning day over the last `days` days, and the latest words studied. */
  studyActivity(days?: number): Promise<StudyActivity>
  overview(): Promise<LangSummary[]>
  getDeck(deckId: string): Promise<DeckMeta | null>
  createDeck(o: { name: string; lang: Lang; tags?: string[]; source?: DeckMeta['source'] }): Promise<DeckMeta>
  renameDeck(deckId: string, name: string): Promise<DeckMeta>
  getNotes(deckId: string): Promise<Note[]>
  noteRows(deckId: string): Promise<NoteRow[]>
  upsertNotes(deckId: string, notes: Note[]): Promise<void>
  findByKey(key: string): Promise<{ deckId: string; note: Note } | null>
  getTemplate(deckId: string, name: string): Promise<RawTemplate | null>

  /** Due cards first (soonest first, at most `limit`), then new cards up to the language's `newLimit` for today. */
  dueCards(o: { lang: Lang; deckIds?: string[]; limit: number; newLimit: number }): Promise<DueCard[]>
  getCard(cardId: string): Promise<DueCard | null>
  pickMode(cardId: string): Promise<AnswerMode>
  distractors(cardId: string, n: number): Promise<string[]>
  /** Due time (ms) each rating would give, for labelling the rating buttons. */
  previewIntervals(cardId: string): Promise<Record<Rating, number>>
  review(cardId: string, r: { rating: Rating; mode: AnswerMode; correct?: boolean; durationMs: number }): Promise<CardState>
  /** Undo this device's most recent review; returns the card to show again. */
  undo(): Promise<string | null>
  /** Reviews done and new cards introduced today, across all decks of a language. */
  today(lang: Lang): Promise<{ reviewed: number; introduced: number }>
  leeches(minLapses: number): Promise<DueCard[]>
  knownTerms(lang: Lang): Promise<{ mastered: string[]; learning: string[] }>

  addToInbox(item: Omit<InboxItem, 'id' | 'createdAt' | 'device'>): Promise<void>
  readInbox(): Promise<InboxItem[]>
  /** The learner profile for a language (`profile.<lang>.md`), injected into every AI call. */
  profile(lang: Lang): Promise<string>
  saveProfile(lang: Lang, text: string): Promise<void>
  /** `name` replaces the package's own deck name for a new deck. */
  importApkg(bytes: Uint8Array, o?: { name?: string }): Promise<ImportResult>
  importRevlog(bytes: Uint8Array): Promise<number>
  importDeckFolder(files: Map<string, Uint8Array>): Promise<ImportResult>

  /** Re-read everything from storage, e.g. after a sync pulled new commits. */
  reload(): Promise<void>
  commit(message: string): Promise<string | null>
}

interface DeckData {
  meta: DeckMeta
  notes: Note[]
  templates: Map<string, RawTemplate>
  /** Per raw template, derived from the notes on first use and dropped on every write. */
  display?: Map<string, RawDisplay>
}

interface State {
  settings: Settings
  scheduler: Scheduler
  decks: Map<string, DeckData>
  logs: LogEntry[]
  states: Map<string, CardState>
  /** First effective review per card, to count new cards introduced today. */
  firstSeen: Map<string, number>
}

/** Stability (days) from which a word counts as mastered for AI difficulty control. */
const MASTERED_DAYS = 30

export function createLibrary(deps: LibraryDeps): Library {
  const { storage, sync, clock, ids, deviceId } = deps
  // Loaded on first import only, so UI bundles that use core never pull in sql.js or jszip.
  const loadSql = deps.loadSql ?? (async () => (await import('sql.js')).default())
  const readApkg = async (bytes: Uint8Array) => (await import('./anki/apkg')).readApkg(bytes, loadSql)
  let loading: Promise<State> | null = null
  // Writes go through one queue so concurrent calls never interleave a read-modify-write.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => undefined)
    return run
  }

  const state = () => (loading ??= load())

  async function load(): Promise<State> {
    const settings = normalizeSettings(parseJson(await storage.readText(paths.settings)))
    const scheduler = await createScheduler(settings.fsrs)
    const decks = new Map<string, DeckData>()
    for (const id of await storage.list(paths.decks)) {
      const deck = await loadDeck(id)
      if (deck) decks.set(id, deck)
    }
    const logs: LogEntry[] = []
    for (const device of await storage.list(paths.logs)) {
      for (const file of (await storage.list(paths.deviceLogs(device))).filter((f) => f.endsWith('.jsonl')).sort()) {
        logs.push(...parseJsonl<LogEntry>(await storage.readText(`${paths.deviceLogs(device)}/${file}`)))
      }
    }
    return { settings, scheduler, decks, logs, states: replay(logs, scheduler), firstSeen: firstReviews(logs) }
  }

  async function loadDeck(id: string): Promise<DeckData | null> {
    const parsed = deckMetaSchema.safeParse(parseJson(await storage.readText(paths.deckMeta(id))))
    if (!parsed.success || parsed.data.id !== id) return null
    const notes: Note[] = []
    for (const raw of parseJsonl<unknown>(await storage.readText(paths.notes(id)))) {
      const n = noteSchema.safeParse(raw)
      if (n.success) notes.push(n.data as Note)
    }
    const templates = new Map<string, RawTemplate>()
    for (const name of await storage.list(paths.templates(id))) {
      const tpl = await readTemplate(id, name)
      if (tpl) templates.set(name, tpl)
    }
    return { meta: parsed.data, notes, templates }
  }

  async function readTemplate(deckId: string, name: string): Promise<RawTemplate | null> {
    const dir = paths.template(deckId, name)
    const css = (await storage.readText(`${dir}/style.css`)) ?? ''
    const spec = parseJson(await storage.readText(`${dir}/template.json`)) as
      | { kind?: 'standard' | 'cloze'; cards?: { name: string; front: string; back: string }[] }
      | null
    const files = spec?.cards?.length ? spec.cards : [{ name: 'Card 1', front: 'front.html', back: 'back.html' }]
    const cards: RawTemplate['cards'] = []
    for (const c of files) {
      const front = await storage.readText(`${dir}/${normalizeRelative(c.front)}`)
      if (front === null) return null
      cards.push({ name: c.name, front, back: (await storage.readText(`${dir}/${normalizeRelative(c.back)}`)) ?? '' })
    }
    return { name, kind: spec?.kind === 'cloze' ? 'cloze' : 'standard', css, cards }
  }

  async function writeTemplate(deckId: string, tpl: RawTemplate) {
    const dir = paths.template(deckId, tpl.name)
    await storage.writeText(`${dir}/style.css`, tpl.css)
    const cards = tpl.cards.map((c, i) => {
      const suffix = i === 0 ? '' : `.${i + 1}`
      return { name: c.name, front: `front${suffix}.html`, back: `back${suffix}.html`, html: c }
    })
    for (const c of cards) {
      await storage.writeText(`${dir}/${c.front}`, c.html.front)
      await storage.writeText(`${dir}/${c.back}`, c.html.back)
    }
    // template.json is only needed when the single-card defaults do not describe the template.
    if (tpl.kind === 'cloze' || cards.length > 1) {
      const spec = { kind: tpl.kind, cards: cards.map(({ name, front, back }) => ({ name, front, back })) }
      await storage.writeText(`${dir}/template.json`, JSON.stringify(spec, null, 2) + '\n')
    }
  }

  async function writeDeck(deck: DeckData) {
    deck.display = undefined
    await storage.writeText(paths.deckMeta(deck.meta.id), JSON.stringify(deck.meta, null, 2) + '\n')
    await storage.writeText(paths.notes(deck.meta.id), toJsonl(deck.notes))
  }

  function displayOf(deck: DeckData, note: Note): RawDisplay | undefined {
    if (note.type !== 'raw') return undefined
    deck.display ??= new Map()
    let d = deck.display.get(note.template)
    if (!d) {
      const notes = deck.notes.filter((n): n is RawNote => n.type === 'raw' && !n.deleted && n.template === note.template)
      deck.display.set(note.template, (d = rawDisplay(deck.templates.get(note.template), notes)))
    }
    return d
  }

  function sampleTitle(deck: DeckData): string | undefined {
    const note = deck.notes.find((n) => !n.deleted)
    return note ? noteTitle(note, displayOf(deck, note)).slice(0, 12) || undefined : undefined
  }

  function locate(s: State, cardId: string): { deck: DeckData; note: Note; face: number } | null {
    const { noteId, face } = parseCardId(cardId)
    for (const deck of s.decks.values()) {
      const note = deck.notes.find((n) => n.id === noteId)
      if (note) return { deck, note, face }
    }
    return null
  }

  function facesOf(deck: DeckData, note: Note): number[] {
    return cardFaces(note, note.type === 'raw' ? deck.templates.get(note.template) : undefined)
  }

  function scopeDecks(s: State, lang: Lang, deckIds?: string[]): DeckData[] {
    return [...s.decks.values()].filter((d) => d.meta.lang === lang && (!deckIds || deckIds.includes(d.meta.id)))
  }

  function todayCounts(s: State, decks: DeckData[]) {
    const start = dayStart(clock.now(), s.settings.review.dayStartHour)
    const cards = new Set<string>()
    for (const d of decks) for (const n of d.notes) for (const f of facesOf(d, n)) cards.add(cardIdOf(n.id, f))
    let introduced = 0
    for (const [cardId, at] of s.firstSeen) if (at >= start && cards.has(cardId)) introduced++
    let reviewed = 0
    for (const r of effectiveReviews(s.logs)) if (r.reviewedAt >= start && cards.has(r.cardId)) reviewed++
    return { reviewed, introduced, start }
  }

  function toDue(deck: DeckData, note: Note, face: number, s: State): DueCard {
    const cardId = cardIdOf(note.id, face)
    return { cardId, deckId: deck.meta.id, face, note, state: s.states.get(cardId) ?? null }
  }

  /**
   * One pass over a deck: cards due now, and new-card candidates. New siblings are buried —
   * at most one new face of a note per day, so one face does not give away the other.
   */
  function scan(s: State, deck: DeckData, now: number, dayStart: number) {
    const due: DueCard[] = []
    const fresh: DueCard[] = []
    let cards = 0
    let learned = 0
    let notes = 0
    for (const n of deck.notes) {
      if (n.deleted) continue
      notes++
      const faces = facesOf(deck, n)
      let buried = faces.some((f) => (s.firstSeen.get(cardIdOf(n.id, f)) ?? 0) >= dayStart)
      for (const f of faces) {
        cards++
        const card = toDue(deck, n, f, s)
        if (card.state) {
          learned++
          if (card.state.dueAt.getTime() <= now) due.push(card)
        } else if (!buried) {
          fresh.push(card)
          buried = true
        }
      }
    }
    return { due, fresh, cards, learned, notes }
  }

  function recomputeCard(s: State, cardId: string) {
    const reviews = effectiveReviews(s.logs).filter((r) => r.cardId === cardId)
    const fresh = replay(reviews, s.scheduler).get(cardId)
    if (fresh) s.states.set(cardId, fresh)
    else s.states.delete(cardId)
    if (reviews.length) s.firstSeen.set(cardId, reviews[0].reviewedAt)
    else s.firstSeen.delete(cardId)
  }

  async function appendLogs(s: State, entries: LogEntry[]) {
    const byFile = new Map<string, LogEntry[]>()
    for (const e of entries) {
      const file = paths.logFile(deviceId, monthKey(e.reviewedAt))
      byFile.set(file, [...(byFile.get(file) ?? []), e])
    }
    for (const [file, list] of byFile) await storage.appendText(file, toJsonl(list))
    s.logs.push(...entries)
  }

  async function newDeckId(s: State, name: string): Promise<string> {
    const base = slugify(name) || `deck-${ids.ulid().slice(-8).toLowerCase()}`
    let id = base
    for (let i = 2; s.decks.has(id) || (await storage.readText(paths.deckMeta(id))) !== null; i++) id = `${base}-${i}`
    return id
  }

  async function importCollection(s: State, col: AnkiCollection, name?: string): Promise<ImportResult> {
    // Media is content-addressed: identical files across decks and re-imports collapse.
    const mediaNames = new Map<string, string>()
    const mediaFiles = new Map<string, Uint8Array>()
    for (const [name, bytes] of col.media) {
      const ext = (name.match(/\.([A-Za-z0-9]{1,8})$/)?.[1] ?? 'bin').toLowerCase()
      const hashed = `${await sha256Hex(bytes)}.${ext}`
      mediaNames.set(name, hashed)
      mediaFiles.set(hashed, bytes)
    }
    const remap = (file: string) => mediaNames.get(file) ?? mediaNames.get(decodeEntities(file)) ?? file
    const rewriteHtml = (html: string) =>
      html
        .replace(/(\bsrc\s*=\s*)(["']?)([^"'\s>]+)\2/gi, (_, pre: string, q: string, f: string) => `${pre}${q}${remap(f)}${q}`)
        .replace(/\[sound:([^\]]+)\]/g, (_, f: string) => `[sound:${remap(f)}]`)
        .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (_, q: string, f: string) => `url(${q}${remap(f)}${q})`)

    const usedModels = new Set(col.notes.map((n) => n.mid))
    const tplNames = new Map<string, string>()
    const templates: RawTemplate[] = []
    for (const m of col.models.values()) {
      if (!usedModels.has(m.id)) continue
      let name = toSegment(m.name)
      while ([...tplNames.values()].includes(name)) name += '_'
      tplNames.set(m.id, name)
      templates.push({
        name,
        kind: m.kind,
        css: rewriteHtml(m.css),
        cards: m.templates.map((t) => ({ name: t.name, front: rewriteHtml(t.qfmt), back: rewriteHtml(t.afmt) }))
      })
    }

    // Re-importing a package updates the deck it went into last time, keeping note ids stable.
    const existing = new Map<string, { deck: DeckData; note: Note }>()
    for (const deck of s.decks.values()) for (const note of deck.notes) if (note.type === 'raw') existing.set(note.key, { deck, note })
    const target = col.notes.map((n) => existing.get(`raw:${n.guid}`)?.deck).find(Boolean)

    const now = clock.now()
    const deck: DeckData = target ?? {
      meta: {
        id: await newDeckId(s, name || mainDeckName(col)),
        name: name?.trim() || mainDeckName(col),
        lang: guessLang(col),
        version: 1,
        tags: [],
        source: 'apkg',
        createdAt: isoDate(now)
      },
      notes: [],
      templates: new Map()
    }
    if (target) deck.meta = { ...deck.meta, version: deck.meta.version + 1 }

    let added = 0
    let updated = 0
    const byId = new Map(deck.notes.map((n, i) => [n.id, i]))
    for (const n of col.notes) {
      const model = col.models.get(n.mid)
      const template = tplNames.get(n.mid)
      if (!model || !template) continue
      const fields: Record<string, string> = {}
      model.fields.forEach((f, i) => (fields[f] = rewriteHtml(n.fields[i] ?? '')))
      const prev = existing.get(`raw:${n.guid}`)
      // Already imported into another deck; leave it where the learner put it.
      if (prev && prev.deck !== deck) continue
      const note: RawNote = {
        id: prev?.note.id ?? ids.ulid(),
        type: 'raw',
        key: noteKey(deck.meta.lang, { type: 'raw', guid: n.guid }),
        fields,
        template,
        tags: n.tags,
        updatedAt: now,
        deleted: false
      }
      const at = byId.get(note.id)
      if (at === undefined) {
        deck.notes.push(note)
        added++
      } else {
        // A note converted to a standard type keeps its id; do not overwrite that work.
        if (deck.notes[at].type !== 'raw') continue
        deck.notes[at] = { ...note, mode: deck.notes[at].mode }
        updated++
      }
    }

    for (const tpl of templates) {
      await writeTemplate(deck.meta.id, tpl)
      deck.templates.set(tpl.name, tpl)
    }
    for (const [file, bytes] of mediaFiles) await storage.writeBytes(paths.media(deck.meta.id, file), bytes)
    await writeDeck(deck)
    s.decks.set(deck.meta.id, deck)
    return { deck: deck.meta, added, updated }
  }

  const lib: Library = {
    async settings() {
      return (await state()).settings
    },

    saveSettings: (patch) => serial(async () => {
      const s = await state()
      const next = mergeSettings(s.settings, patch)
      await storage.writeText(paths.settings, JSON.stringify(next, null, 2) + '\n')
      const fsrsChanged = JSON.stringify(next.fsrs) !== JSON.stringify(s.settings.fsrs)
      s.settings = next
      if (fsrsChanged) {
        s.scheduler = await createScheduler(next.fsrs)
        s.states = replay(s.logs, s.scheduler)
      }
      return next
    }),

    async listDecks() {
      return [...(await state()).decks.values()].map((d) => d.meta).sort((a, b) => a.name.localeCompare(b.name))
    },

    async studyActivity(span = 7) {
      const s = await state()
      const hour = s.settings.review.dayStartHour
      const today = new Date(dayStart(clock.now(), hour))
      const days = Array.from({ length: span }, (_, i) => {
        const date = new Date(today)
        date.setDate(date.getDate() - span + 1 + i)
        return { date: isoDate(date.getTime()), count: 0 }
      })
      const byDate = new Map(days.map((day) => [day.date, day]))
      const notes = new Map<string, { note: Note; deck: DeckData }>()
      for (const deck of s.decks.values()) {
        for (const note of deck.notes) {
          if (!note.deleted && (note.type === 'word' || note.type === 'raw')) notes.set(note.id, { note, deck })
        }
      }
      const recent: StudyActivity['recent'] = []
      const seen = new Set<string>()
      const first = new Date(today)
      first.setDate(first.getDate() - span + 1)
      for (const review of effectiveReviews(s.logs).reverse()) {
        if (review.reviewedAt < first.getTime() && (recent.length === 8 || seen.size === notes.size)) break
        const day = byDate.get(isoDate(dayStart(review.reviewedAt, hour)))
        if (day) day.count++
        if (recent.length === 8) continue
        const { noteId } = parseCardId(review.cardId)
        const entry = notes.get(noteId)
        if (!entry || seen.has(noteId)) continue
        seen.add(noteId)
        const term = noteTitle(entry.note, displayOf(entry.deck, entry.note)).trim()
        if (term) recent.push({ id: noteId, term, deckId: entry.deck.meta.id, deckName: entry.deck.meta.name, at: review.reviewedAt })
      }
      let streak = 0
      for (let i = days.length - 1 - (days.at(-1)?.count ? 0 : 1); i >= 0 && days[i].count; i--) streak++
      return { days, streak, recent }
    },

    async overview() {
      const s = await state()
      const now = clock.now()
      const out: LangSummary[] = []
      for (const lang of ['ja', 'en'] as Lang[]) {
        const decks = scopeDecks(s, lang).sort((a, b) => a.meta.name.localeCompare(b.meta.name))
        if (!decks.length) continue
        const today = todayCounts(s, decks)
        const newLeft = Math.max(0, s.settings.review.newPerDay - today.introduced)
        const reviewLeft = Math.max(0, s.settings.review.reviewsPerDay - today.reviewed)
        const scans = decks.map((d) => ({ meta: d.meta, ...scan(s, d, now, today.start) }))
        const sum = (f: (r: (typeof scans)[number]) => number) => scans.reduce((n, r) => n + f(r), 0)
        out.push({
          lang,
          cards: sum((r) => r.cards),
          learned: sum((r) => r.learned),
          due: Math.min(sum((r) => r.due.length), reviewLeft),
          fresh: Math.min(sum((r) => r.fresh.length), newLeft),
          decks: scans.map((r, i) => ({
            ...r.meta, notes: r.notes, cards: r.cards, learned: r.learned, due: r.due.length, fresh: Math.min(r.fresh.length, newLeft),
            sample: sampleTitle(decks[i])
          }))
        })
      }
      return out
    },

    async getDeck(deckId) {
      return (await state()).decks.get(deckId)?.meta ?? null
    },

    createDeck: (o) => serial(async () => {
      const s = await state()
      const meta = deckMetaSchema.parse({
        id: await newDeckId(s, o.name),
        name: o.name.trim(),
        lang: o.lang,
        version: 1,
        tags: o.tags ?? [],
        source: o.source ?? 'manual',
        createdAt: isoDate(clock.now())
      })
      const deck: DeckData = { meta, notes: [], templates: new Map() }
      await writeDeck(deck)
      s.decks.set(meta.id, deck)
      return meta
    }),

    renameDeck: (deckId, name) => serial(async () => {
      const deck = (await state()).decks.get(deckId)
      if (!deck) throw new Error(`no such deck: ${deckId}`)
      // Only the display name changes; the id (and so every path) stays.
      deck.meta = deckMetaSchema.parse({ ...deck.meta, name: name.trim() })
      await storage.writeText(paths.deckMeta(deckId), JSON.stringify(deck.meta, null, 2) + '\n')
      return deck.meta
    }),

    async getNotes(deckId) {
      return ((await state()).decks.get(deckId)?.notes ?? []).filter((n) => !n.deleted)
    },

    async noteRows(deckId) {
      const deck = (await state()).decks.get(deckId)
      if (!deck) return []
      return deck.notes.filter((n) => !n.deleted).map((note) => {
        const display = displayOf(deck, note)
        return { note, title: noteTitle(note, display), detail: noteDetail(note, display) }
      })
    },

    upsertNotes: (deckId, notes) => serial(async () => {
      const s = await state()
      const deck = s.decks.get(deckId)
      if (!deck) throw new Error(`no such deck: ${deckId}`)
      const now = clock.now()
      const index = new Map(deck.notes.map((n, i) => [n.id, i]))
      for (const input of notes) {
        const note = noteSchema.parse({ ...input, updatedAt: now }) as Note
        const at = index.get(note.id)
        if (at === undefined) {
          index.set(note.id, deck.notes.length)
          deck.notes.push(note)
        } else deck.notes[at] = note
      }
      await writeDeck(deck)
    }),

    async findByKey(key) {
      for (const deck of (await state()).decks.values()) {
        const note = deck.notes.find((n) => n.key === key && !n.deleted)
        if (note) return { deckId: deck.meta.id, note }
      }
      return null
    },

    async getTemplate(deckId, name) {
      return (await state()).decks.get(deckId)?.templates.get(name) ?? null
    },

    async dueCards({ lang, deckIds, limit, newLimit }) {
      const s = await state()
      const now = clock.now()
      const { introduced, start } = todayCounts(s, scopeDecks(s, lang))
      const due: DueCard[] = []
      const fresh: DueCard[] = []
      for (const d of scopeDecks(s, lang, deckIds)) {
        const r = scan(s, d, now, start)
        due.push(...r.due)
        fresh.push(...r.fresh)
      }
      due.sort((a, b) => a.state!.dueAt.getTime() - b.state!.dueAt.getTime())
      return [...due.slice(0, limit), ...fresh.slice(0, Math.max(0, newLimit - introduced))]
    },

    async getCard(cardId) {
      const s = await state()
      const hit = locate(s, cardId)
      return hit ? toDue(hit.deck, hit.note, hit.face, s) : null
    },

    async pickMode(cardId) {
      const s = await state()
      const hit = locate(s, cardId)
      if (!hit) throw new Error(`no such card: ${cardId}`)
      return pickMode(hit.note, s.states.get(cardId) ?? null, s.settings.review.modeThresholds)
    },

    async distractors(cardId, n) {
      const s = await state()
      const hit = locate(s, cardId)
      if (!hit) return []
      const lang = hit.deck.meta.lang
      const pool = scopeDecks(s, lang).flatMap((d) => d.notes.map((note) => ({ note, deckId: d.meta.id })))
      return pickDistractors({ note: hit.note, face: hit.face, deckId: hit.deck.meta.id, lang }, pool, n)
    },

    async previewIntervals(cardId) {
      const s = await state()
      const now = new Date(clock.now())
      const card = s.states.get(cardId) ?? s.scheduler.newCard({ now, cardId })
      const at = (grade: Rating) => s.scheduler.review({ card, now, grade }).card.dueAt.getTime()
      return { 1: at(1), 2: at(2), 3: at(3), 4: at(4) }
    },

    review: (cardId, r) => serial(async () => {
      const s = await state()
      if (!locate(s, cardId)) throw new Error(`no such card: ${cardId}`)
      const entry: ReviewEntry = {
        id: ids.ulid(), cardId, rating: r.rating, reviewedAt: clock.now(), durationMs: Math.round(r.durationMs),
        device: deviceId, mode: r.mode, ...(r.correct === undefined ? {} : { correct: r.correct })
      }
      await appendLogs(s, [entry])
      if (!s.firstSeen.has(cardId)) s.firstSeen.set(cardId, entry.reviewedAt)
      return applyReview(s.states, entry, s.scheduler)
    }),

    undo: () => serial(async () => {
      const s = await state()
      const undone = new Set(s.logs.flatMap((e) => (e.type === 'undo' ? [e.target] : [])))
      const last = [...s.logs].reverse().find((e): e is ReviewEntry =>
        e.type !== 'undo' && e.device === deviceId && !e.imported && !undone.has(e.id))
      if (!last) return null
      await appendLogs(s, [{ id: ids.ulid(), type: 'undo', target: last.id, reviewedAt: clock.now(), device: deviceId }])
      recomputeCard(s, last.cardId)
      return last.cardId
    }),

    async today(lang) {
      const s = await state()
      const { reviewed, introduced } = todayCounts(s, scopeDecks(s, lang))
      return { reviewed, introduced }
    },

    async leeches(minLapses) {
      const s = await state()
      const out: DueCard[] = []
      for (const d of s.decks.values()) {
        for (const n of d.notes) {
          if (n.deleted) continue
          for (const f of facesOf(d, n)) {
            const card = toDue(d, n, f, s)
            if ((card.state?.lapses ?? 0) >= minLapses) out.push(card)
          }
        }
      }
      return out.sort((a, b) => b.state!.lapses - a.state!.lapses)
    },

    async knownTerms(lang) {
      const s = await state()
      const mastered: string[] = []
      const learning: string[] = []
      for (const d of scopeDecks(s, lang)) {
        for (const n of d.notes) {
          if (n.deleted || n.type !== 'word') continue
          const stabilities = facesOf(d, n).map((f) => s.states.get(cardIdOf(n.id, f))?.stability)
          if (stabilities.every((x) => x === undefined)) continue
          const best = Math.max(...stabilities.map((x) => x ?? 0))
          ;(best >= MASTERED_DAYS ? mastered : learning).push(n.fields.term)
        }
      }
      return { mastered, learning }
    },

    addToInbox: (item) => serial(async () => {
      const entry: InboxItem = { ...item, id: ids.ulid(), createdAt: clock.now(), device: deviceId }
      await storage.appendText(paths.inbox, toJsonl([entry]))
    }),

    async readInbox() {
      return parseJsonl<InboxItem>(await storage.readText(paths.inbox))
    },

    async profile(lang) {
      return (await storage.readText(paths.profile(lang))) ?? defaultProfile(lang)
    },

    saveProfile: (lang, text) => serial(() => storage.writeText(paths.profile(lang), text.trim() + '\n')),

    importApkg: (bytes, o) => serial(async () => importCollection(await state(), await readApkg(bytes), o?.name)),

    importRevlog: (bytes) => serial(async () => {
      const s = await state()
      const col = await readApkg(bytes)
      const notesByAnkiId = new Map(col.notes.map((n) => [n.id, n]))
      const cardIds = new Map<string, string>()
      for (const c of col.cards) {
        const anki = notesByAnkiId.get(c.nid)
        const hit = anki && (await lib.findByKey(`raw:${anki.guid}`))
        if (hit) cardIds.set(c.id, cardIdOf(hit.note.id, c.ord))
      }
      const known = new Set(s.logs.map((e) => e.id))
      const entries: ReviewEntry[] = []
      for (const r of col.revlog) {
        // ease 0 marks manual reschedules; types 4/5 are manual and rescheduled entries.
        const cardId = cardIds.get(r.cid)
        const id = `anki-${r.id}-${r.cid}`
        if (!cardId || r.ease < 1 || r.ease > 4 || r.type > 3 || known.has(id)) continue
        entries.push({
          id, cardId, rating: r.ease as Rating, reviewedAt: r.id, durationMs: r.time,
          device: deviceId, mode: 'flip', imported: 'anki'
        })
      }
      if (!entries.length) return 0
      await appendLogs(s, entries)
      s.states = replay(s.logs, s.scheduler)
      s.firstSeen = firstReviews(s.logs)
      return entries.length
    }),

    importDeckFolder: (files) => serial(async () => {
      const s = await state()
      // Accept the folder itself or a parent of it (e.g. a downloaded archive).
      const metaPath = [...files.keys()].map(normalizeRelative).find((p) => p === 'deck.json' || p.endsWith('/deck.json'))
      if (!metaPath) throw new Error('deck.json not found')
      const prefix = metaPath.slice(0, -'deck.json'.length)
      const rel = new Map<string, Uint8Array>()
      for (const [p, bytes] of files) {
        const n = normalizeRelative(p)
        if (n.startsWith(prefix)) rel.set(n.slice(prefix.length), bytes)
      }
      const meta = deckMetaSchema.parse(JSON.parse(utf8.decode(rel.get('deck.json')!)))
      const incoming = parseJsonl<unknown>(rel.has('notes.jsonl') ? utf8.decode(rel.get('notes.jsonl')!) : '')
        .map((n) => noteSchema.parse(n) as Note)
      const deck = s.decks.get(meta.id) ?? { meta, notes: [], templates: new Map<string, RawTemplate>() }
      deck.meta = { ...meta, source: meta.source === 'manual' ? 'repo' : meta.source }
      const index = new Map(deck.notes.map((n, i) => [n.id, i]))
      let added = 0
      let updated = 0
      for (const n of incoming) {
        const at = index.get(n.id)
        if (at === undefined) {
          deck.notes.push(n)
          added++
        } else {
          deck.notes[at] = { ...n, mode: deck.notes[at].mode }
          updated++
        }
      }
      for (const [p, bytes] of rel) {
        if (p.startsWith('media/') || p.startsWith('tpl/')) await storage.writeBytes(`${paths.deck(meta.id)}/${p}`, bytes)
      }
      await writeDeck(deck)
      const reloaded = await loadDeck(meta.id)
      if (reloaded) s.decks.set(meta.id, reloaded)
      return { deck: deck.meta, added, updated }
    }),

    reload: () => serial(async () => {
      loading = load()
      await loading
    }),

    commit: (message) => serial(() => sync.commit(message))
  }
  return lib
}

function defaultProfile(lang: Lang): string {
  return lang === 'ja'
    ? '# 学习档案（日语）\n- 母语：中文；释义用中文\n- 水平：N4，目标 N3；例句不超过 N3\n- 不用罗马音；标注与中文含义不同的汉字词\n'
    : '# 学习档案（英语）\n- 母语：中文；释义用中文\n- 水平：大学英语四级，目标六级\n- 例句用常见场景，避免生僻词\n'
}

function firstReviews(logs: readonly LogEntry[]): Map<string, number> {
  const first = new Map<string, number>()
  for (const r of effectiveReviews(logs)) if (!first.has(r.cardId)) first.set(r.cardId, r.reviewedAt)
  return first
}

function parseJson(text: string | null): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** The deck most cards belong to, ignoring Anki's catch-all "Default". */
function mainDeckName(col: AnkiCollection): string {
  const counts = new Map<string, number>()
  for (const c of col.cards) {
    const name = col.decks.get(c.did)
    if (name && name !== 'Default') counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
  return (best ?? 'Imported').split('::').filter(Boolean).join(' · ')
}

function guessLang(col: AnkiCollection): Lang {
  let kana = 0
  for (const n of col.notes.slice(0, 200)) if (/[぀-ヿ]/.test(n.fields.join(' '))) kana++
  return kana >= Math.min(10, col.notes.length / 4) ? 'ja' : 'en'
}
