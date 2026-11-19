import type {
  AnswerMode, DeckMeta, GrammarNote, ImportResult, Lang, LangSummary, Note, Rating, ReviewItem, ReviewQueue,
  ReviewScope, SentenceNote, Settings, SettingsPatch, WordNote
} from '@fragmemo/core'

// The UI's only door to the outside world. Each shell provides one implementation:
// the Electron preload over IPC, the Android WebView directly over core + Capacitor.

export type Theme = 'light' | 'dark' | 'sepia' | 'system'

export interface AppState {
  libraryPath: string | null
  deviceId: string
  theme: Theme
  version: string
  platform: string
}

type Draft<N extends Note> = Pick<N, 'type' | 'fields'> & { id?: string; tags?: string[]; mode?: AnswerMode }
export type NoteDraft = Draft<WordNote> | Draft<SentenceNote> | Draft<GrammarNote>

export interface Answer { rating: Rating; mode: AnswerMode; correct?: boolean; durationMs: number }

export interface Api {
  getApp(): Promise<AppState>
  setTheme(theme: Theme): Promise<void>
  /** Pick or create a Library folder; null when cancelled. */
  chooseLibrary(): Promise<AppState | null>
  revealLibrary(): Promise<void>

  getSettings(): Promise<Settings>
  saveSettings(patch: SettingsPatch): Promise<Settings>

  /** Per-language totals and deck summaries for today. */
  overview(): Promise<LangSummary[]>
  createDeck(o: { name: string; lang: Lang }): Promise<DeckMeta>
  importApkg(o: { withHistory: boolean }): Promise<ImportResult | null>
  listNotes(deckId: string): Promise<Note[]>
  saveNote(deckId: string, draft: NoteDraft): Promise<Note>
  deleteNote(deckId: string, noteId: string): Promise<void>

  nextReview(scope: ReviewScope): Promise<ReviewQueue>
  prepareReview(cardId: string, mode?: AnswerMode): Promise<ReviewItem>
  answer(cardId: string, a: Answer): Promise<void>
  undoReview(): Promise<ReviewItem | null>
  pinMode(cardId: string, mode: AnswerMode | null): Promise<void>
  /** End the round; returns how many cards were answered. */
  finishReview(): Promise<number>

  onLibraryChanged(fn: () => void): () => void
}
