import { describe, expect, it } from 'vitest'
import { cardFaces, renderRawCard, renderTemplate, type RawNote, type RawTemplate } from '../src'

describe('renderTemplate', () => {
  const fields = { Front: '食べる', Back: 'to eat', Reading: '食[た]べる', Empty: '' }
  it('substitutes fields and special fields', () => {
    expect(renderTemplate('{{Front}} / {{Back}} {{Tags}}', { fields, tags: ['n5', 'verb'] })).toBe('食べる / to eat n5 verb')
  })
  it('handles sections, inverted sections and nesting', () => {
    const src = '{{#Back}}[{{Back}}{{#Empty}}never{{/Empty}}]{{/Back}}{{^Empty}}(no extra){{/Empty}}'
    expect(renderTemplate(src, { fields })).toBe('[to eat](no extra)')
  })
  it('applies furigana, kana and kanji filters', () => {
    expect(renderTemplate('{{furigana:Reading}}', { fields })).toBe('<ruby><rb>食</rb><rt>た</rt></ruby>べる')
    expect(renderTemplate('{{kana:Reading}}', { fields })).toBe('たべる')
    expect(renderTemplate('{{kanji:Reading}}', { fields })).toBe('食べる')
    expect(renderTemplate('{{text:Front}}', { fields: { Front: '<b>x</b>' } })).toBe('x')
  })
  it('renders cloze per side and ordinal', () => {
    const f = { Text: '{{c1::東京}}は{{c2::日本::国}}の首都' }
    expect(renderTemplate('{{cloze:Text}}', { fields: f, ord: 0, side: 'front' })).toBe('<span class="cloze">[...]</span>は日本の首都')
    expect(renderTemplate('{{cloze:Text}}', { fields: f, ord: 1, side: 'front' })).toBe('東京は<span class="cloze">[国]</span>の首都')
    expect(renderTemplate('{{cloze:Text}}', { fields: f, ord: 1, side: 'back' })).toBe('東京は<span class="cloze">日本</span>の首都')
  })
  it('drops type: inputs and tolerates unknown filters', () => {
    expect(renderTemplate('{{type:Back}}{{tts ja_JP:Front}}', { fields })).toBe('食べる')
  })
})

describe('raw cards', () => {
  const note: RawNote = {
    id: 'n', type: 'raw', key: 'raw:g', template: 'Basic', tags: [], updatedAt: 0, deleted: false,
    fields: { Front: '<img src="abc.png">犬', Back: 'dog [sound:dog.mp3]', Extra: '' }
  }
  const tpl: RawTemplate = {
    name: 'Basic', kind: 'standard', css: '.card { font-family: url(_font.ttf) }',
    cards: [
      { name: 'Card 1', front: '{{Front}}', back: '{{FrontSide}}<hr id=answer>{{Back}}' },
      { name: 'Card 2', front: '{{Back}}', back: '{{Front}}' },
      { name: 'Card 3', front: '{{#Extra}}{{Extra}}{{/Extra}}', back: '{{Front}}' }
    ]
  }
  it('creates a card only for templates with a non-empty front', () => {
    expect(cardFaces(note, tpl)).toEqual([0, 1])
  })
  it('counts cloze cards from the cloze numbers present', () => {
    const cloze: RawTemplate = { name: 'Cloze', kind: 'cloze', css: '', cards: [{ name: 'Cloze', front: '{{cloze:Text}}', back: '{{cloze:Text}}' }] }
    const n: RawNote = { ...note, template: 'Cloze', fields: { Text: '{{c1::a}} {{c3::b}} {{c1::c}}' } }
    expect(cardFaces(n, cloze)).toEqual([0, 2])
  })
  it('rewrites media references to host URLs', () => {
    const r = renderRawCard(tpl, note, 0, { mediaUrl: (f) => `fragmemo://media/d/${f}` })
    expect(r.front).toContain('src="fragmemo://media/d/abc.png"')
    expect(r.back).toContain('data-src="fragmemo://media/d/dog.mp3"')
    expect(r.back.startsWith(r.front)).toBe(true)
    expect(r.css).toContain('url("fragmemo://media/d/_font.ttf")')
  })
})
