import type { Lang, LangSummary, ReviewScope, StudyActivity } from '@fragmemo/core'
import { createContext, useContext } from 'react'
import type { Theme, TaskRecord } from '../api'

/** What the Generate dialog opens with: a tab and, optionally, a target deck. */
export interface GeneratePreset {
  tab?: 'generate-deck' | 'extract-from-text' | 'process-inbox' | 'leech-helper'
  lang?: Lang
  deckId?: string
  text?: string
  request?: string
}

export type ImportSource = 'presets' | 'anki' | 'text'

export type View =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'import'; source?: ImportSource; lang?: Lang; text?: string }
  | { name: 'deck'; deckId: string }
  | { name: 'review'; scope: ReviewScope; title: string }
export type Panel = 'qa' | 'tasks' | 'notes'

/** Days of history the home page and sidebar show. */
export const ACTIVITY_DAYS = 52 * 7

/** Everything the frame around the pages shares: navigation, the right panel, AI entry points. */
export interface Shell {
  view: View
  go(view: View): void
  /** Per-language overview, refreshed whenever the Library changes. */
  langs: LangSummary[] | undefined
  activity: StudyActivity | undefined
  /** Bumped on every Library change, for pages that load their own data. */
  version: number
  /** Ask every page to refetch, e.g. after a review round that did not touch the Library files. */
  refresh(): void
  tasks: TaskRecord[]
  panel: Panel | null
  setPanel(p: Panel | null): void
  openGenerate(preset?: GeneratePreset): void
  openCreateDeck(lang?: Lang): void
  openSettings(): void
  mac: boolean
  theme: Theme
  setTheme(t: Theme): void
}

export const ShellContext = createContext<Shell | null>(null)

export function useShell(): Shell {
  const s = useContext(ShellContext)
  if (!s) throw new Error('useShell outside ShellContext')
  return s
}
