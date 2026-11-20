import type { Proposal, TaskInput, TaskKind } from '@fragmemo/ai'
import type {
  AnswerMode, DeckMeta, GrammarNote, ImportResult, Lang, LangSummary, Note, NoteRow, PresetDeck, Rating, ReviewItem,
  ReviewQueue, ReviewScope, StudyActivity, SentenceNote, Settings, SettingsPatch, WordNote
} from '@fragmemo/core'

// The UI's only door to the outside world. Each shell provides one implementation:
// the Electron preload over IPC, the Android WebView directly over core + Capacitor.

export type Theme = 'light' | 'dark' | 'sepia' | 'system'
/** The accent colour family, independent of light or dark. */
export type Palette = 'sky' | 'sakura' | 'mint' | 'matcha' | 'plain'

export interface AppState {
  libraryPath: string | null
  deviceId: string
  theme: Theme
  palette: Palette
  version: string
  platform: string
}

type Draft<N extends Note> = Pick<N, 'type' | 'fields'> & { id?: string; tags?: string[]; mode?: AnswerMode }
export type NoteDraft = Draft<WordNote> | Draft<SentenceNote> | Draft<GrammarNote>

export interface Answer { rating: Rating; mode: AnswerMode; correct?: boolean; durationMs: number }

export interface LocalModel { id: string; label: string; efforts: string[] }

export type AiProviderId = 'codex-cli' | 'deepseek' | 'claude-cli' | 'openai-compatible'
/** write: every task that changes notes; qa: the side panel. */
export type AiPurpose = 'write' | 'qa'

export interface AiSettings {
  purposes: Record<AiPurpose, { provider: AiProviderId; model: string; effort?: string }>
  deepseek: { hasKey: boolean }
  claude: { path: string; model: string; baseUrl: string; hasAuthToken: boolean }
  openai: { baseUrl: string; model: string; hasApiKey: boolean }
}

/** Secrets are write-only: send a value to set it, an empty string to clear it. */
export interface AiSettingsPatch {
  purposes?: Partial<AiSettings['purposes']>
  deepseek?: { key: string }
  claude?: Partial<{ path: string; model: string; baseUrl: string; authToken: string }>
  openai?: Partial<{ baseUrl: string; model: string; apiKey: string }>
}

export type TaskStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'
export type TaskAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'undo' | 'remove'

export interface PendingProposal { proposal: Proposal; issues: string[] }

export interface AiTaskResult {
  summary: string
  deckId?: string
  applied: number
  commit?: string
  /** Set once the learner undid the whole batch. */
  undone?: { at: number; skipped: string[] }
  /** Notes that failed the checks, waiting for the learner. */
  pending: PendingProposal[]
}

export interface TaskRecord {
  id: string
  kind: TaskKind
  title: string
  input: TaskInput
  status: TaskStatus
  stage?: string
  /** 0–1, or -1 when unknown. */
  progress?: number
  error?: string
  createdAt: number
  updatedAt: number
  device: string
  result?: AiTaskResult
}

/** A preset deck and whether its package is already downloaded. */
export interface PresetInfo extends PresetDeck { downloaded: boolean }

export interface Api {
  readNotebook(root: string, deckId?: string): Promise<string | null>
  writeNotebook(root: string, deckId: string | undefined, document: string): Promise<void>
  getApp(): Promise<AppState>
  setTheme(theme: Theme): Promise<void>
  setPalette(palette: Palette): Promise<void>
  /** Pick or create a Library folder; null when cancelled. */
  chooseLibrary(): Promise<AppState | null>
  revealLibrary(): Promise<void>

  getSettings(): Promise<Settings>
  saveSettings(patch: SettingsPatch): Promise<Settings>

  /** Reviews per day over the last `days` days (default 7), the streak and recent words. */
  studyActivity(days?: number): Promise<StudyActivity>
  listPresets(): Promise<PresetInfo[]>
  /** Downloads the package first if needed, reporting through onPresetProgress. */
  importPreset(id: string, withHistory: boolean): Promise<ImportResult>
  onPresetProgress(fn: (e: { id: string; received: number; total: number }) => void): () => void
  /** Per-language totals and deck summaries for today. */
  overview(): Promise<LangSummary[]>
  createDeck(o: { name: string; lang: Lang }): Promise<DeckMeta>
  renameDeck(deckId: string, name: string): Promise<DeckMeta>
  importApkg(o: { withHistory: boolean }): Promise<ImportResult | null>
  listNotes(deckId: string): Promise<NoteRow[]>
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

  codexModels(): Promise<LocalModel[]>
  getAiSettings(): Promise<AiSettings>
  saveAiSettings(patch: AiSettingsPatch): Promise<AiSettings>
  /** Resolves with a short status line, rejects with what is wrong. */
  testAi(purpose: AiPurpose): Promise<string>
  getProfile(lang: Lang): Promise<string>
  saveProfile(lang: Lang, text: string): Promise<void>

  listTasks(): Promise<TaskRecord[]>
  createTask(input: TaskInput): Promise<TaskRecord>
  taskAction(id: string, action: TaskAction): Promise<void>
  /** Accept or drop notes a task left for review. */
  resolvePending(taskId: string, noteIds: string[], accept: boolean): Promise<void>
  onTasksChanged(fn: (tasks: TaskRecord[]) => void): () => void

  /** Ask in a side-panel conversation; the answer also streams through onAskDelta. */
  ask(conversationId: string, lang: Lang, question: string): Promise<string>
  stopAsking(conversationId: string): Promise<void>
  forgetConversation(conversationId: string): Promise<void>
  onAskDelta(fn: (e: { conversationId: string; delta: string }) => void): () => void
}
