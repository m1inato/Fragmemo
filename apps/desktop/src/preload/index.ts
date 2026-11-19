import type { Api } from '@fragmemo/ui/api'
import { contextBridge, ipcRenderer } from 'electron'

// Electron wraps rejected invokes as "Error invoking remote method '…': Error: <message>";
// the UI only ever shows the message.
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return await ipcRenderer.invoke(channel, ...args)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(msg.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, ''))
  }
}

function subscribe(channel: string, fn: () => void): () => void {
  const listener = () => fn()
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  getApp: () => invoke('app:get'),
  setTheme: (theme) => invoke('app:setTheme', theme),
  chooseLibrary: () => invoke('library:choose'),
  revealLibrary: () => invoke('library:reveal'),

  getSettings: () => invoke('settings:get'),
  saveSettings: (patch) => invoke('settings:save', patch),

  overview: () => invoke('decks:overview'),
  createDeck: (o) => invoke('decks:create', o),
  importApkg: (o) => invoke('decks:importApkg', o),
  listNotes: (deckId) => invoke('notes:list', deckId),
  saveNote: (deckId, draft) => invoke('notes:upsert', deckId, draft),
  deleteNote: (deckId, noteId) => invoke('notes:delete', deckId, noteId),

  nextReview: (scope) => invoke('review:next', scope),
  prepareReview: (cardId, mode) => invoke('review:prepare', cardId, mode),
  answer: (cardId, a) => invoke('review:answer', cardId, a),
  undoReview: () => invoke('review:undo'),
  pinMode: (cardId, mode) => invoke('review:pin', cardId, mode),
  finishReview: () => invoke('review:finish'),

  onLibraryChanged: (fn) => subscribe('library:changed', fn)
} satisfies Api

contextBridge.exposeInMainWorld('api', api)

export type { Api }
