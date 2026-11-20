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

function subscribe<T>(channel: string, fn: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T) => fn(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api = {
  readNotebook: (root, id) => invoke('notebook:read', root, id),
  writeNotebook: (root, id, doc) => invoke('notebook:write', root, id, doc),
  getApp: () => invoke('app:get'),
  setTheme: (theme) => invoke('app:setTheme', theme),
  setPalette: (palette) => invoke('app:setPalette', palette),
  chooseLibrary: () => invoke('library:choose'),
  revealLibrary: () => invoke('library:reveal'),

  getSettings: () => invoke('settings:get'),
  saveSettings: (patch) => invoke('settings:save', patch),

  studyActivity: (days) => invoke('study:activity', days),
  listPresets: () => invoke('presets:list'),
  importPreset: (id, history) => invoke('presets:import', id, history),
  onPresetProgress: (fn) => subscribe('presets:progress', fn),
  overview: () => invoke('decks:overview'),
  createDeck: (o) => invoke('decks:create', o),
  renameDeck: (id, name) => invoke('decks:rename', id, name),
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

  onLibraryChanged: (fn) => subscribe('library:changed', () => fn()),

  codexModels: () => invoke('ai:codexModels'),
  getAiSettings: () => invoke('ai:getSettings'),
  saveAiSettings: (patch) => invoke('ai:saveSettings', patch),
  testAi: (purpose) => invoke('ai:test', purpose),
  getProfile: (lang) => invoke('profile:get', lang),
  saveProfile: (lang, text) => invoke('profile:save', lang, text),

  listTasks: () => invoke('tasks:list'),
  createTask: (input) => invoke('tasks:create', input),
  taskAction: (id, action) => invoke('tasks:act', id, action),
  resolvePending: (taskId, noteIds, accept) => invoke('tasks:resolve', taskId, noteIds, accept),
  onTasksChanged: (fn) => subscribe('tasks:changed', fn),

  ask: (id, lang, question) => invoke('qa:ask', id, lang, question),
  stopAsking: (id) => invoke('qa:stop', id),
  forgetConversation: (id) => invoke('qa:forget', id),
  onAskDelta: (fn) => subscribe('qa:delta', fn)
} satisfies Api

contextBridge.exposeInMainWorld('api', api)

export type { Api }
