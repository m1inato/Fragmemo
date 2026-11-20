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

const RELEASE = 'https://github.com/m1inato/Fragmemo/releases/download/presets-1'

export const PRESET_DECKS: readonly PresetDeck[] = [
  {
    id: 'jlpt-10k',
    name: 'JLPT N1～N5 一万词',
    lang: 'ja',
    description: '按 JLPT 等级排列的一万词，带音高、真人发音和例句。',
    notes: 10641,
    bytes: 131414715,
    sha256: '5097123f9d98582122af75a5f775ec9a36b17c793d41ccd246960ede745d4865',
    url: `${RELEASE}/jlpt-10k.apkg`
  },
  {
    id: 'toefl-green',
    name: '托福绿宝书',
    lang: 'en',
    description: '托福核心词，乱序，带音标、发音、例句和词根记忆。',
    notes: 4127,
    bytes: 81846527,
    sha256: '88462a5ef9eb68fd3d1ff4c247d7755cc605ef931d1beccb2346c5c6ae21de9a',
    url: `${RELEASE}/toefl-green.apkg`
  }
]
