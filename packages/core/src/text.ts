import { toHiragana } from './modes'
import type { Lang } from './types'

// Tokenizing for checks and the AI's analyze_text tool: surface, dictionary form, reading.
// Japanese goes through kuromoji (IPADIC); English uses a light rule-based lemmatizer.

export interface Token {
  surface: string
  /** Dictionary form: 食べた → 食べる, running → run. */
  base: string
  /** Reading in hiragana (Japanese only). */
  reading?: string
  pos: string
  /** False when the tokenizer guessed (word not in its dictionary). */
  known: boolean
}

export interface Analyzer {
  analyze(lang: Lang, text: string): Promise<Token[]>
}

interface KuromojiToken {
  surface_form: string
  basic_form: string
  reading?: string
  pos: string
  word_type: string
}
interface KuromojiTokenizer { tokenize(text: string): KuromojiToken[] }
interface KuromojiModule {
  builder(o: { dicPath: string }): { build(cb: (err: Error | null, t: KuromojiTokenizer) => void): void }
}

/**
 * `jaDictPath` is where the kuromoji dictionary lives: a directory in Node, a URL in a WebView.
 * The dictionary loads on first Japanese call and stays in memory.
 */
export function createAnalyzer(o: { jaDictPath: string }): Analyzer {
  let tokenizer: Promise<KuromojiTokenizer> | null = null
  const ja = () =>
    (tokenizer ??= import('kuromoji').then((m) => {
      const k = ((m as { default?: KuromojiModule }).default ?? m) as KuromojiModule
      return new Promise<KuromojiTokenizer>((resolve, reject) =>
        k.builder({ dicPath: o.jaDictPath }).build((err, t) => (err ? reject(err) : resolve(t))))
    }))

  return {
    async analyze(lang, text) {
      if (lang === 'en') return analyzeEnglish(text)
      return (await ja()).tokenize(text).map((t) => ({
        surface: t.surface_form,
        base: t.basic_form && t.basic_form !== '*' ? t.basic_form : t.surface_form,
        ...(t.reading && t.reading !== '*' ? { reading: toHiragana(t.reading) } : {}),
        pos: t.pos,
        known: t.word_type === 'KNOWN'
      }))
    }
  }
}

export function analyzeEnglish(text: string): Token[] {
  return (text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? []).map((w) => ({
    surface: w,
    base: lemmatize(w.toLowerCase()),
    pos: '',
    known: true
  }))
}

const IRREGULAR: Record<string, string> = {
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', has: 'have', had: 'have', did: 'do', does: 'do',
  went: 'go', gone: 'go', made: 'make', took: 'take', taken: 'take', got: 'get', saw: 'see', seen: 'see',
  came: 'come', knew: 'know', known: 'know', thought: 'think', told: 'tell', said: 'say', found: 'find',
  gave: 'give', given: 'give', left: 'leave', felt: 'feel', kept: 'keep', began: 'begin', begun: 'begin',
  wrote: 'write', written: 'write', ran: 'run', children: 'child', men: 'man', women: 'woman', people: 'person'
}

/** Good enough to tell whether an example sentence uses a word; not a general lemmatizer. */
function lemmatize(w: string): string {
  if (IRREGULAR[w]) return IRREGULAR[w]
  if (w.length <= 3) return w
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'
  if (w.endsWith('ied')) return w.slice(0, -3) + 'y'
  if (/(ss|sh|ch|x|z)es$/.test(w)) return w.slice(0, -2)
  if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1)
  const undouble = (s: string) => (/([bdgklmnprt])\1$/.test(s) ? s.slice(0, -1) : s)
  if (w.endsWith('ing') && w.length > 5) return undouble(w.slice(0, -3))
  if (w.endsWith('ed') && w.length > 4) return undouble(w.slice(0, -2))
  return w
}

/** Does `text` use `term` in some inflected form? Compares dictionary forms. */
export async function usesTerm(analyzer: Analyzer, lang: Lang, text: string, term: string): Promise<boolean> {
  if (lang === 'ja') {
    if (text.includes(term)) return true
    const tokens = await analyzer.analyze(lang, text)
    // Inflection changes only the last token of a word (勉強 + し + た → 勉強する), so try
    // every run of surfaces closed by one dictionary form.
    for (let i = 0; i < tokens.length; i++) {
      let prefix = ''
      for (let j = i; j < tokens.length && prefix.length <= term.length; j++) {
        if (prefix + tokens[j].base === term) return true
        prefix += tokens[j].surface
      }
    }
    return false
  }
  const want = term.toLowerCase().split(/\s+/).map((w) => lemmatize(w))
  const bases = analyzeEnglish(text).map((t) => t.base)
  return bases.some((_, i) => want.every((w, k) => bases[i + k] === w))
}

/** Reading of a whole term as the tokenizer sees it, or null when any part is a guess. */
export async function readingOf(analyzer: Analyzer, term: string): Promise<string | null> {
  const tokens = await analyzer.analyze('ja', term)
  if (!tokens.length || tokens.some((t) => !t.known || !t.reading)) return null
  return tokens.map((t) => t.reading).join('')
}
