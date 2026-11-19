import JSZip from 'jszip'
import initSqlJs from 'sql.js'
import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { readApkg } from '../src/anki/apkg'
import { testLibrary } from './helpers'

// Builds small but structurally faithful Anki packages in both the legacy and current layouts.

const MODEL_ID = '1700000000001'
const DECK_ID = '1700000000002'
const MEDIA = { 'cat.jpg': new Uint8Array([0xff, 0xd8, 1, 2, 3]), 'neko.mp3': new Uint8Array([0x49, 0x44, 0x33, 9]) }

const notes = [
  { id: 1, guid: 'g-neko', fields: ['猫', 'cat <img src="cat.jpg">', 'ねこ [sound:neko.mp3]'], tags: ' n5 animal ' },
  { id: 2, guid: 'g-inu', fields: ['犬', 'dog', 'いぬ'], tags: ' n5 ' }
]
const templates = [
  { name: 'Recognition', ord: 0, qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id=answer>{{Back}}<br>{{Reading}}' },
  { name: 'Production', ord: 1, qfmt: '{{Back}}', afmt: '{{FrontSide}}<hr id=answer>{{Front}}' }
]
const css = '.card { font-size: 30px }'

async function baseDb() {
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  db.run(`CREATE TABLE notes (id integer primary key, guid text, mid integer, mod integer, usn integer, tags text, flds text, sfld text, csum integer, flags integer, data text);
          CREATE TABLE cards (id integer primary key, nid integer, did integer, ord integer);
          CREATE TABLE revlog (id integer primary key, cid integer, usn integer, ease integer, ivl integer, lastIvl integer, factor integer, time integer, type integer);`)
  for (const n of notes) {
    db.run('INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)', [n.id, n.guid, MODEL_ID, 0, 0, n.tags, n.fields.join('\x1f'), n.fields[0], 0, 0, ''])
    db.run('INSERT INTO cards VALUES (?,?,?,?)', [n.id * 10, n.id, DECK_ID, 0])
    db.run('INSERT INTO cards VALUES (?,?,?,?)', [n.id * 10 + 1, n.id, DECK_ID, 1])
  }
  const day = 86_400_000
  const t0 = Date.UTC(2026, 9, 1)
  db.run('INSERT INTO revlog VALUES (?,?,?,?,?,?,?,?,?)', [t0, 10, 0, 3, 1, 0, 2500, 4000, 0])
  db.run('INSERT INTO revlog VALUES (?,?,?,?,?,?,?,?,?)', [t0 + 3 * day, 10, 0, 3, 5, 1, 2500, 3000, 1])
  db.run('INSERT INTO revlog VALUES (?,?,?,?,?,?,?,?,?)', [t0 + 4 * day, 20, 0, 0, 0, 0, 0, 0, 4]) // manual: skipped
  return db
}

async function legacyApkg(): Promise<Uint8Array> {
  const db = await baseDb()
  const models = {
    [MODEL_ID]: {
      name: 'JLPT Vocab', type: 0, css,
      flds: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }, { name: 'Reading', ord: 2 }],
      tmpls: templates
    }
  }
  const decks = { 1: { name: 'Default' }, [DECK_ID]: { name: 'JLPT::N5 Animals' } }
  db.run('CREATE TABLE col (id integer, models text, decks text)')
  db.run('INSERT INTO col VALUES (1, ?, ?)', [JSON.stringify(models), JSON.stringify(decks)])
  const zip = new JSZip()
  zip.file('collection.anki2', db.export())
  zip.file('media', JSON.stringify({ 0: 'cat.jpg', 1: 'neko.mp3' }))
  zip.file('0', MEDIA['cat.jpg'])
  zip.file('1', MEDIA['neko.mp3'])
  return zip.generateAsync({ type: 'uint8array' })
}

// Minimal protobuf writer for the test fixtures.
const varint = (n: number) => {
  const out: number[] = []
  while (n > 127) {
    out.push((n & 127) | 128)
    n = Math.floor(n / 128)
  }
  out.push(n)
  return out
}
const pbString = (no: number, s: string | Uint8Array) => {
  const b = typeof s === 'string' ? new TextEncoder().encode(s) : s
  return [...varint(no * 8 + 2), ...varint(b.length), ...b]
}
const pbVarint = (no: number, v: number) => [...varint(no * 8), ...varint(v)]

async function modernApkg(): Promise<Uint8Array> {
  const db = await baseDb()
  db.run(`CREATE TABLE notetypes (id integer primary key, name text, mtime_secs integer, usn integer, config blob);
          CREATE TABLE fields (ntid integer, ord integer, name text, config blob);
          CREATE TABLE templates (ntid integer, ord integer, name text, mtime_secs integer, usn integer, config blob);
          CREATE TABLE decks (id integer primary key, name text, mtime_secs integer, usn integer, common blob, kind blob);`)
  db.run('INSERT INTO notetypes VALUES (?,?,?,?,?)', [MODEL_ID, 'JLPT Vocab', 0, 0, new Uint8Array([...pbVarint(1, 0), ...pbVarint(2, 0), ...pbString(3, css)])])
  ;['Front', 'Back', 'Reading'].forEach((f, i) => db.run('INSERT INTO fields VALUES (?,?,?,?)', [MODEL_ID, i, f, new Uint8Array()]))
  for (const t of templates) {
    db.run('INSERT INTO templates VALUES (?,?,?,?,?,?)', [MODEL_ID, t.ord, t.name, 0, 0, new Uint8Array([...pbString(1, t.qfmt), ...pbString(2, t.afmt)])])
  }
  db.run('INSERT INTO decks VALUES (?,?,?,?,?,?)', [DECK_ID, 'JLPT\x1fN5 Animals', 0, 0, new Uint8Array(), new Uint8Array()])
  const entries = Object.keys(MEDIA).map((name) => pbString(1, new Uint8Array(pbString(1, name))))
  const zip = new JSZip()
  zip.file('collection.anki21b', zstdCompressSync(db.export()))
  zip.file('collection.anki2', new Uint8Array([0])) // the "please update Anki" stub
  zip.file('media', zstdCompressSync(new Uint8Array(entries.flat())))
  zip.file('0', zstdCompressSync(MEDIA['cat.jpg']))
  zip.file('1', zstdCompressSync(MEDIA['neko.mp3']))
  return zip.generateAsync({ type: 'uint8array' })
}

describe.each([
  ['legacy', legacyApkg],
  ['anki21b', modernApkg]
])('apkg (%s)', (_, build) => {
  it('reads note types, notes, cards, revlog and media', async () => {
    const col = await readApkg(await build(), () => initSqlJs())
    const model = col.models.get(MODEL_ID)!
    expect(model.fields).toEqual(['Front', 'Back', 'Reading'])
    expect(model.templates.map((t) => t.qfmt)).toEqual(['{{Front}}', '{{Back}}'])
    expect(model.css).toBe(css)
    expect(col.decks.get(DECK_ID)).toBe('JLPT::N5 Animals')
    expect(col.notes.map((n) => n.guid)).toEqual(['g-neko', 'g-inu'])
    expect(col.notes[0].tags).toEqual(['n5', 'animal'])
    expect(col.cards).toHaveLength(4)
    expect(col.revlog).toHaveLength(3)
    expect([...col.media.keys()].sort()).toEqual(['cat.jpg', 'neko.mp3'])
    expect(col.media.get('cat.jpg')).toEqual(MEDIA['cat.jpg'])
  })

  it('imports into a raw deck with content-addressed media', async () => {
    const { lib, mem } = testLibrary()
    const bytes = await build()
    const { deck, added } = await lib.importApkg(bytes)
    expect(added).toBe(2)
    expect(deck).toMatchObject({ id: 'jlpt-n5-animals', name: 'JLPT · N5 Animals', lang: 'ja', source: 'apkg' })

    const files = [...mem.files.keys()]
    expect(files).toContain('decks/jlpt-n5-animals/tpl/JLPT Vocab/front.html')
    expect(files).toContain('decks/jlpt-n5-animals/tpl/JLPT Vocab/front.2.html')
    expect(files).toContain('decks/jlpt-n5-animals/tpl/JLPT Vocab/template.json')
    const media = files.filter((f) => f.includes('/media/'))
    expect(media).toHaveLength(2)
    expect(media.every((f) => /\/[0-9a-f]{64}\.(jpg|mp3)$/.test(f))).toBe(true)

    const [neko] = await lib.getNotes(deck.id)
    expect(neko).toMatchObject({ type: 'raw', key: 'raw:g-neko', template: 'JLPT Vocab', tags: ['n5', 'animal'] })
    const fields = (neko as { fields: Record<string, string> }).fields
    expect(fields.Back).toMatch(/<img src="[0-9a-f]{64}\.jpg">/)
    expect(fields.Reading).toMatch(/\[sound:[0-9a-f]{64}\.mp3\]/)

    const due = await lib.dueCards({ lang: 'ja', limit: 10, newLimit: 10 })
    expect(due.map((c) => c.cardId)).toEqual([`${neko.id}:0`, expect.stringMatching(/:0$/)])
  })

  it('re-imports idempotently and maps the revlog onto the same cards', async () => {
    const { lib } = testLibrary()
    const bytes = await build()
    const first = await lib.importApkg(bytes)
    const ids = (await lib.getNotes(first.deck.id)).map((n) => n.id)
    const second = await lib.importApkg(bytes)
    expect(second).toMatchObject({ deck: { id: first.deck.id, version: 2 }, added: 0, updated: 2 })
    expect((await lib.getNotes(first.deck.id)).map((n) => n.id)).toEqual(ids)

    expect(await lib.importRevlog(bytes)).toBe(2)
    expect(await lib.importRevlog(bytes)).toBe(0)
    const card = await lib.getCard(`${ids[0]}:0`)
    expect(card!.state!.reps).toBe(2)
  })
})
