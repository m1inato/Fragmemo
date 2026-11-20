import { describe, expect, it } from 'vitest'
import { noteDetail, noteTitle, rawDisplay } from '../src/notes'
import type { RawNote, RawTemplate } from '../src/types'

const raw = (i: number, fields: Record<string, string>): RawNote => ({
  id: `n${i}`, type: 'raw', key: `raw:g${i}`, template: 't', fields, tags: [], updatedAt: 0, deleted: false
})
const tpl = (front: string, back: string): RawTemplate => ({ name: 't', kind: 'standard', css: '', cards: [{ name: 'Card 1', front, back }] })

describe('raw note display', () => {
  it('skips id and list fields when picking the headword', () => {
    const notes = ['嬉しい', '悲しい', '楽しい', '寂しい'].map((w, i) =>
      raw(i, { NoteID: String(1000 + i), Level: 'N3', Kanji: `<b>${w}</b>`, Pitch: '', Def: `def ${i}`, Audio: '[sound:a.mp3]' }))
    const display = rawDisplay(tpl('{{Level}} {{furigana:Kanji}}{{#Pitch}}{{Pitch}}{{/Pitch}}{{Audio}}', '{{FrontSide}}<hr>{{Def}}'), notes)
    expect(display.title[0]).toBe('Kanji')
    expect(display.detail[0]).toBe('Def')
    expect(noteTitle(notes[1], display)).toBe('悲しい')
    expect(noteDetail(notes[1], display)).toBe('def 1')
  })

  it('falls back to the note type field order without a template', () => {
    const notes = ['essence', 'pastel'].map((w, i) => raw(i, { word: w, definition: `n. ${w}`, word_list: 'Word List 1' }))
    const display = rawDisplay(undefined, notes)
    expect(display.title[0]).toBe('word')
    expect(noteDetail(notes[0], display)).toBe('n. essence')
  })
})
