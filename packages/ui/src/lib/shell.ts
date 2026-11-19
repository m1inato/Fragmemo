import type { Lang } from '@fragmemo/core'
import { createContext, useContext } from 'react'
import type { TaskRecord } from '../api'

/** What the Generate dialog opens with: a tab and, optionally, a target deck. */
export interface GeneratePreset {
  tab?: 'generate-deck' | 'extract-from-text' | 'process-inbox' | 'leech-helper'
  lang?: Lang
  deckId?: string
  text?: string
}

export interface Shell {
  tasks: TaskRecord[]
  panel: 'tasks' | 'qa' | null
  setPanel(p: 'tasks' | 'qa' | null): void
  openGenerate(preset?: GeneratePreset): void
}

export const ShellContext = createContext<Shell | null>(null)

export function useShell(): Shell {
  const s = useContext(ShellContext)
  if (!s) throw new Error('useShell outside ShellContext')
  return s
}
