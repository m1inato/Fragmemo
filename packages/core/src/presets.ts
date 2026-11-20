import type { Lang } from './types'

// Ready-made Anki decks offered on the import page. They are too large for the repository
// and the app bundle, so each shell downloads one on demand, checks its hash, and imports it.

export interface PresetDeck {
  id: string
  /** Deck name after import, in place of the package's own. */
  name: string
  lang: Lang
  description: string
  notes: number
  bytes: number
  sha256: string
  url: string
}

const RELEASE = 'https://github.com/m1inato/Fragmemo/releases/download/presets-2'

export const PRESET_DECKS: readonly PresetDeck[] = [
  {
    id: 'jlpt-10k',
    name: 'JLPT N1～N5 一万词',
    lang: 'ja',
    description: '按 JLPT 等级排列的一万词，带音高、真人发音和例句。',
    notes: 10641,
    bytes: 96147340,
    sha256: 'cf8a09615ef4cc6bb6959ef4b325349d764b48a49aae5641320ea01919ecf571',
    url: `${RELEASE}/jlpt-10k.apkg`
  },
  {
    id: 'toefl-green',
    name: '托福绿宝书',
    lang: 'en',
    description: '托福核心词，乱序，带音标、发音、例句和词根记忆。',
    notes: 4127,
    bytes: 77785638,
    sha256: 'eaf437f493fbc1bd6368b380bf8aad4e5a0ca8e61a237b0d930a27a0434158f0',
    url: `${RELEASE}/toefl-green.apkg`
  }
]
