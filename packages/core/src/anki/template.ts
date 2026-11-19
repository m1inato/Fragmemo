// A subset of Anki's template language, enough to show imported note types faithfully:
// {{Field}}, {{#Field}}…{{/Field}}, {{^Field}}…{{/Field}}, {{FrontSide}}, {{Tags}}, {{Card}},
// and the filters text, furigana, kana, kanji, cloze, hint and type. Filters apply right to left.

export interface RenderContext {
  fields: Record<string, string>
  tags?: string[]
  deck?: string
  card?: string
  /** Card ordinal; for cloze note types this is cloze number − 1. */
  ord?: number
  side?: 'front' | 'back'
  frontSide?: string
}

type Node =
  | { t: 'text'; v: string }
  | { t: 'var'; v: string }
  | { t: 'section'; name: string; inverted: boolean; children: Node[] }

const TAG = /\{\{\s*([#^/]?)\s*([^}]*?)\s*\}\}/g

function parse(src: string): Node[] {
  const root: Node[] = []
  const stack: { name: string; children: Node[] }[] = [{ name: '', children: root }]
  let last = 0
  for (const m of src.matchAll(TAG)) {
    const top = stack[stack.length - 1]
    if (m.index > last) top.children.push({ t: 'text', v: src.slice(last, m.index) })
    last = m.index + m[0].length
    const [, sigil, name] = m
    if (sigil === '#' || sigil === '^') {
      const node: Node = { t: 'section', name, inverted: sigil === '^', children: [] }
      top.children.push(node)
      stack.push({ name, children: node.children })
    } else if (sigil === '/') {
      // Tolerate stray closers the way Anki's legacy renderer did instead of failing the card.
      if (stack.length > 1 && top.name === name) stack.pop()
    } else {
      top.children.push({ t: 'var', v: name })
    }
  }
  if (last < src.length) stack[stack.length - 1].children.push({ t: 'text', v: src.slice(last) })
  return root
}

export function renderTemplate(src: string, ctx: RenderContext): string {
  return renderNodes(parse(src), ctx)
}

function renderNodes(nodes: Node[], ctx: RenderContext): string {
  let out = ''
  for (const n of nodes) {
    if (n.t === 'text') out += n.v
    else if (n.t === 'var') out += renderVar(n.v, ctx)
    else {
      const present = stripForTest(fieldValue(n.name, ctx)) !== ''
      if (present !== n.inverted) out += renderNodes(n.children, ctx)
    }
  }
  return out
}

function fieldValue(name: string, ctx: RenderContext): string {
  switch (name) {
    case 'FrontSide':
      return ctx.frontSide ?? ''
    case 'Tags':
      return (ctx.tags ?? []).join(' ')
    case 'Deck':
      return ctx.deck ?? ''
    case 'Subdeck':
      return (ctx.deck ?? '').split('::').pop() ?? ''
    case 'Card':
      return ctx.card ?? ''
    default:
      return ctx.fields[name] ?? ''
  }
}

function renderVar(expr: string, ctx: RenderContext): string {
  const parts = expr.split(':')
  const name = parts.pop() ?? ''
  let value = fieldValue(name, ctx)
  for (const filter of parts.reverse()) value = applyFilter(filter.trim(), value, name, ctx)
  return value
}

function applyFilter(filter: string, value: string, field: string, ctx: RenderContext): string {
  switch (filter) {
    case 'text':
      return stripTags(value)
    case 'furigana':
      return value.replace(FURIGANA, (_, base: string, reading: string) =>
        reading.startsWith('sound:') ? _ : `<ruby><rb>${base}</rb><rt>${reading}</rt></ruby>`)
    case 'kana':
      return value.replace(FURIGANA, (_, _b: string, reading: string) => (reading.startsWith('sound:') ? _ : reading))
    case 'kanji':
      return value.replace(FURIGANA, (_, base: string, reading: string) => (reading.startsWith('sound:') ? _ : base))
    case 'cloze':
      return renderCloze(value, (ctx.ord ?? 0) + 1, ctx.side ?? 'front')
    case 'hint':
      return value
        ? `<a class="hint" href="#" onclick="this.style.display='none';this.nextElementSibling.style.display='inline';return false;">${field}</a><span class="hint-body" style="display:none">${value}</span>`
        : ''
    case 'type':
      // Typing is handled by Fragmemo's own spell mode; Anki's input box is dropped.
      return ''
    default:
      // Unknown filters (tts, custom add-on filters) degrade to the plain value.
      return value
  }
}

const FURIGANA = / ?([^ >]+?)\[(.+?)\]/g
const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g

function renderCloze(text: string, n: number, side: 'front' | 'back'): string {
  return text.replace(CLOZE, (_, num: string, body: string, hint?: string) => {
    if (Number(num) !== n) return body
    if (side === 'back') return `<span class="cloze">${body}</span>`
    return `<span class="cloze">[${hint ?? '...'}]</span>`
  })
}

/** Cloze ordinals (number − 1) referenced by the fields a cloze template actually shows. */
export function clozeOrdinals(front: string, fields: Record<string, string>): number[] {
  const used = new Set<number>()
  for (const m of front.matchAll(/\{\{[^}]*cloze:([^}]+?)\s*\}\}/g)) {
    for (const c of (fields[m[1]] ?? '').matchAll(/\{\{c(\d+)::/g)) used.add(Number(c[1]) - 1)
  }
  return [...used].sort((a, b) => a - b)
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

function stripForTest(html: string): string {
  return stripTags(html).replace(/&nbsp;/g, ' ').trim()
}

/** Rewrite media references in rendered HTML to URLs the host can serve. */
export function rewriteMedia(html: string, url: (file: string) => string): string {
  return html
    .replace(/(\bsrc\s*=\s*)(["']?)([^"'\s>]+)\2/gi, (m, pre: string, _q: string, file: string) =>
      /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(file) ? m : `${pre}"${url(decodeEntities(file))}"`)
    .replace(/\[sound:([^\]]+)\]/g, (_, file: string) =>
      `<button type="button" class="fm-sound" data-src="${url(decodeEntities(file))}" aria-label="播放">▶</button>`)
}

/** Rewrite `url(...)` references in CSS (Anki ships fonts as `_name.ttf` media). */
export function rewriteCssUrls(css: string, url: (file: string) => string): string {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (m, _q: string, file: string) =>
    /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(file) ? m : `url("${url(file)}")`)
}

export function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

export interface RenderedCard {
  front: string
  back: string
  css: string
}

export function renderRawCard(
  tpl: { kind: 'standard' | 'cloze'; css: string; cards: { name: string; front: string; back: string }[] },
  note: { fields: Record<string, string>; tags: string[] },
  face: number,
  opts: { deck?: string; mediaUrl: (file: string) => string }
): RenderedCard {
  const card = tpl.kind === 'cloze' ? tpl.cards[0] : tpl.cards[face]
  if (!card) return { front: '', back: '', css: tpl.css }
  const ctx: RenderContext = { fields: note.fields, tags: note.tags, deck: opts.deck, card: card.name, ord: face }
  const front = renderTemplate(card.front, { ...ctx, side: 'front' })
  const back = renderTemplate(card.back, { ...ctx, side: 'back', frontSide: front })
  return {
    front: rewriteMedia(front, opts.mediaUrl),
    back: rewriteMedia(back, opts.mediaUrl),
    css: rewriteCssUrls(tpl.css, opts.mediaUrl)
  }
}
