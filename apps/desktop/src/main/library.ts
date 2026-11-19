import {
  createIds, createLibrary, noteKey, paths, systemClock,
  type DeckMeta, type ImportResult, type Lang, type LangSummary, type Library, type Note, type Settings, type SettingsPatch
} from '@fragmemo/core'
import type { NoteDraft } from '@fragmemo/ui/api'
import { app, dialog, shell, type BrowserWindow } from 'electron'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
import { createNodeStorage, resolveInside } from './storage'
import { getSettings, saveSettings } from './settings'
import { createGitSync } from './sync'

let current: { root: string; lib: Library; sync: ReturnType<typeof createGitSync> } | null = null
let notify: () => void = () => {}

export function initLibrary(onChanged: () => void) {
  notify = onChanged
  const { libraryPath } = getSettings()
  if (libraryPath) open(libraryPath).catch((err) => console.error('[library] open failed', err))
}

export function library(): Library {
  if (!current) throw new Error('还没有打开 Library')
  return current.lib
}

export function libraryRoot(): string | null {
  return current?.root ?? null
}

async function open(root: string) {
  const sync = createGitSync(root)
  await sync.init().catch((err) => console.warn('[library] git unavailable, history disabled', err))
  await sync.pull().catch((err) => console.warn('[library] pull failed', err))
  const { deviceId } = getSettings()
  current = {
    root,
    sync,
    lib: createLibrary({
      storage: createNodeStorage(root),
      sync,
      clock: systemClock,
      ids: createIds(),
      deviceId,
      // The wasm is emitted next to the main bundle (see electron.vite.config.ts).
      loadSql: () => initSqlJs({ locateFile: (f) => join(__dirname, f) })
    })
  }
  await current.lib.listDecks()
  saveSettings({ libraryPath: root })
  notify()
}

/** Let the user pick a folder: an existing Library opens, an empty folder becomes one. */
export async function chooseLibrary(win: BrowserWindow): Promise<string | null> {
  const res = await dialog.showOpenDialog(win, {
    title: '选择 Library 文件夹',
    defaultPath: app.getPath('documents'),
    buttonLabel: '使用这个文件夹',
    properties: ['openDirectory', 'createDirectory']
  })
  const root = res.filePaths[0]
  if (res.canceled || !root) return null
  const entries = (await readdir(root)).filter((n) => !n.startsWith('.'))
  const isLibrary = entries.includes(paths.decks) || entries.includes(paths.settings)
  if (entries.length && !isLibrary) throw new Error('这个文件夹里已经有别的东西了，换一个空文件夹吧')
  if (!isLibrary) await writeFile(resolveInside(root, paths.settings), '{}\n')
  await open(root)
  return root
}

export async function revealLibrary() {
  if (current) await shell.openPath(current.root)
}

/** Commit, then push in the background; a failed push is retried with the next commit. */
export async function commit(message: string) {
  if (!current) return
  const hash = await current.lib.commit(message).catch((err) => {
    console.warn('[library] commit failed', err)
    return null
  })
  if (hash) current.sync.push().catch((err) => console.warn('[library] push failed', err))
}

export const getLibrarySettings = (): Promise<Settings> => library().settings()

export async function saveLibrarySettings(patch: SettingsPatch): Promise<Settings> {
  const next = await library().saveSettings(patch)
  await commit('edit: settings')
  notify()
  return next
}

export const overview = (): Promise<LangSummary[]> => library().overview()

export async function createDeck(o: { name: string; lang: Lang }): Promise<DeckMeta> {
  const deck = await library().createDeck({ name: o.name, lang: o.lang })
  await commit(`edit: ${deck.id}`)
  notify()
  return deck
}

export const listNotes = (deckId: string): Promise<Note[]> => library().getNotes(deckId)

export async function saveNote(deckId: string, draft: NoteDraft): Promise<Note> {
  const lib = library()
  const deck = await lib.getDeck(deckId)
  if (!deck) throw new Error('卡组不存在')
  const key = noteKey(deck.lang, draft)
  const dup = await lib.findByKey(key)
  if (dup && dup.note.id !== draft.id) throw new Error('这个词已经在卡组里了')
  const prev = draft.id ? (await lib.getNotes(deckId)).find((n) => n.id === draft.id) : undefined
  const note = {
    ...draft,
    id: draft.id ?? createIds().ulid(),
    key,
    tags: draft.tags ?? [],
    updatedAt: Date.now(),
    deleted: false,
    ...(prev?.mode && !('mode' in draft) ? { mode: prev.mode } : {})
  } as Note
  await lib.upsertNotes(deckId, [note])
  await commit(`edit: ${deckId}`)
  notify()
  return note
}

export async function deleteNote(deckId: string, noteId: string) {
  const lib = library()
  const note = (await lib.getNotes(deckId)).find((n) => n.id === noteId)
  if (!note) return
  await lib.upsertNotes(deckId, [{ ...note, deleted: true }])
  await commit(`edit: ${deckId}`)
  notify()
}

export async function importApkg(win: BrowserWindow, o: { withHistory: boolean }): Promise<ImportResult | null> {
  const res = await dialog.showOpenDialog(win, {
    title: '导入 Anki 卡包',
    filters: [{ name: 'Anki 卡包', extensions: ['apkg', 'colpkg'] }],
    properties: ['openFile']
  })
  const file = res.filePaths[0]
  if (res.canceled || !file) return null
  const bytes = new Uint8Array(await readFile(file))
  const lib = library()
  const result = await lib.importApkg(bytes)
  if (o.withHistory) await lib.importRevlog(bytes)
  await commit(`import: ${result.deck.id}`)
  notify()
  return result
}

/** Absolute path of a deck's media file, for the fragmemo://media protocol. */
export function mediaFile(deckId: string, file: string): string | null {
  if (!current) return null
  try {
    return resolveInside(current.root, paths.media(deckId, file))
  } catch {
    return null
  }
}
