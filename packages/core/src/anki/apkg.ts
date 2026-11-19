import { decompress } from 'fzstd'
import JSZip from 'jszip'
import type { Database, SqlJsStatic } from 'sql.js'
import { utf8 } from '../util'

// Reader for Anki package files (.apkg / .colpkg). Handles the legacy layout
// (collection.anki2 / .anki21, JSON media map) and the current one (zstd-compressed
// collection.anki21b, protobuf media map, zstd-compressed media entries).

export type SqlLoader = () => Promise<SqlJsStatic>

export interface AnkiModel {
  id: string
  name: string
  kind: 'standard' | 'cloze'
  css: string
  fields: string[]
  templates: { name: string; ord: number; qfmt: string; afmt: string }[]
}
export interface AnkiNote { id: string; guid: string; mid: string; fields: string[]; tags: string[]; mod: number }
export interface AnkiCard { id: string; nid: string; did: string; ord: number }
export interface AnkiRevlog { id: number; cid: string; ease: number; time: number; type: number }

export interface AnkiCollection {
  models: Map<string, AnkiModel>
  decks: Map<string, string>
  notes: AnkiNote[]
  cards: AnkiCard[]
  revlog: AnkiRevlog[]
  media: Map<string, Uint8Array>
}

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

function maybeZstd(bytes: Uint8Array): Uint8Array {
  return ZSTD_MAGIC.every((b, i) => bytes[i] === b) ? decompress(bytes) : bytes
}

export async function readApkg(bytes: Uint8Array, loadSql: SqlLoader): Promise<AnkiCollection> {
  const zip = await JSZip.loadAsync(bytes)
  const name = ['collection.anki21b', 'collection.anki21', 'collection.anki2'].find((n) => zip.file(n))
  if (!name) throw new Error('not an Anki package: no collection file')
  const dbBytes = maybeZstd(await zip.file(name)!.async('uint8array'))

  const SQL = await loadSql()
  const db = new SQL.Database(dbBytes)
  try {
    const { models, decks } = hasTable(db, 'notetypes') ? readModernSchema(db) : readLegacySchema(db)
    return {
      models,
      decks,
      notes: rows(db, 'SELECT id, guid, mid, flds, tags, mod FROM notes').map((r) => ({
        id: String(r[0]),
        guid: String(r[1]),
        mid: String(r[2]),
        fields: String(r[3]).split('\x1f'),
        tags: String(r[4]).trim().split(/\s+/).filter(Boolean),
        mod: Number(r[5])
      })),
      cards: rows(db, 'SELECT id, nid, did, ord FROM cards').map((r) => ({
        id: String(r[0]), nid: String(r[1]), did: String(r[2]), ord: Number(r[3])
      })),
      revlog: rows(db, 'SELECT id, cid, ease, time, type FROM revlog').map((r) => ({
        id: Number(r[0]), cid: String(r[1]), ease: Number(r[2]), time: Number(r[3]), type: Number(r[4])
      })),
      media: await readMedia(zip)
    }
  } finally {
    db.close()
  }
}

type Row = (string | number | Uint8Array | null)[]

function rows(db: Database, sql: string): Row[] {
  const res = db.exec(sql)
  return (res[0]?.values ?? []) as Row[]
}

function hasTable(db: Database, table: string): boolean {
  return rows(db, `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '${table}'`).length > 0
}

function readLegacySchema(db: Database) {
  const [modelsJson, decksJson] = rows(db, 'SELECT models, decks FROM col')[0] ?? ['{}', '{}']
  const models = new Map<string, AnkiModel>()
  for (const [id, m] of Object.entries(JSON.parse(String(modelsJson)) as Record<string, LegacyModel>)) {
    models.set(id, {
      id,
      name: m.name,
      kind: m.type === 1 ? 'cloze' : 'standard',
      css: m.css ?? '',
      fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
      templates: [...m.tmpls].sort((a, b) => a.ord - b.ord).map((t) => ({ name: t.name, ord: t.ord, qfmt: t.qfmt, afmt: t.afmt }))
    })
  }
  const decks = new Map<string, string>()
  for (const [id, d] of Object.entries(JSON.parse(String(decksJson)) as Record<string, { name: string }>)) decks.set(id, d.name)
  return { models, decks }
}

interface LegacyModel {
  name: string; type: number; css?: string
  flds: { name: string; ord: number }[]
  tmpls: { name: string; ord: number; qfmt: string; afmt: string }[]
}

// Schema 18: note types live in their own tables with protobuf configs.
//   Notetype.Config: kind = 1 (0 normal, 1 cloze), css = 3
//   Notetype.Template.Config: q_format = 1, a_format = 2
function readModernSchema(db: Database) {
  const models = new Map<string, AnkiModel>()
  for (const [id, name, config] of rows(db, 'SELECT id, name, config FROM notetypes')) {
    const cfg = readProto(config as Uint8Array)
    models.set(String(id), {
      id: String(id),
      name: String(name),
      kind: cfg.varint(1) === 1 ? 'cloze' : 'standard',
      css: cfg.string(3),
      fields: [],
      templates: []
    })
  }
  for (const [ntid, , name] of rows(db, 'SELECT ntid, ord, name FROM fields ORDER BY ntid, ord')) {
    models.get(String(ntid))?.fields.push(String(name))
  }
  for (const [ntid, ord, name, config] of rows(db, 'SELECT ntid, ord, name, config FROM templates ORDER BY ntid, ord')) {
    const cfg = readProto(config as Uint8Array)
    models.get(String(ntid))?.templates.push({ name: String(name), ord: Number(ord), qfmt: cfg.string(1), afmt: cfg.string(2) })
  }
  const decks = new Map<string, string>()
  for (const [id, name] of rows(db, 'SELECT id, name FROM decks')) decks.set(String(id), String(name).replaceAll('\x1f', '::'))
  return { models, decks }
}

async function readMedia(zip: JSZip): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>()
  const file = zip.file('media')
  if (!file) return out
  const raw = maybeZstd(await file.async('uint8array'))
  let names: [string, string][]
  if (raw[0] === 0x7b /* { */) {
    names = Object.entries(JSON.parse(utf8.decode(raw)) as Record<string, string>)
  } else {
    // MediaEntries { repeated MediaEntry entries = 1 } / MediaEntry { string name = 1; ... }
    names = readProto(raw).messages(1).map((e, i) => [String(e.varint(255) ?? i), e.string(1)])
  }
  for (const [entry, name] of names) {
    const f = zip.file(entry)
    if (f && name) out.set(name, maybeZstd(await f.async('uint8array')))
  }
  return out
}

interface Proto {
  varint(no: number): number | undefined
  string(no: number): string
  messages(no: number): Proto[]
}

/** Just enough protobuf decoding for Anki's config blobs: varints and length-delimited fields. */
function readProto(buf: Uint8Array | null): Proto {
  const fields = new Map<number, (number | Uint8Array)[]>()
  const b = buf ?? new Uint8Array()
  let p = 0
  const varint = () => {
    let result = 0
    let shift = 0
    for (;;) {
      const byte = b[p++]
      result += (byte & 0x7f) * 2 ** shift
      if (byte < 0x80 || p >= b.length) return result
      shift += 7
    }
  }
  while (p < b.length) {
    const key = varint()
    const no = Math.floor(key / 8)
    const wire = key & 7
    let value: number | Uint8Array
    if (wire === 0) value = varint()
    else if (wire === 2) {
      const len = varint()
      value = b.subarray(p, p + len)
      p += len
    } else if (wire === 1) { value = 0; p += 8 }
    else if (wire === 5) { value = 0; p += 4 }
    else break
    const list = fields.get(no) ?? []
    list.push(value)
    fields.set(no, list)
  }
  const first = (no: number) => fields.get(no)?.[0]
  return {
    varint: (no: number) => {
      const v = first(no)
      return typeof v === 'number' ? v : undefined
    },
    string: (no: number) => {
      const v = first(no)
      return v instanceof Uint8Array ? utf8.decode(v) : ''
    },
    messages: (no: number) => (fields.get(no) ?? []).filter((v): v is Uint8Array => v instanceof Uint8Array).map(readProto)
  }
}
