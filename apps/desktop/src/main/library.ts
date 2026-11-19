import {
  createIds, createLibrary, noteKey, paths, systemClock,
  type DeckMeta, type ImportResult, type Lang, type LangSummary, type Library, type Note, type Settings, type SettingsPatch, type Storage
} from '@fragmemo/core'
import type { NoteDraft } from '@fragmemo/ui/api'
import { app, dialog, shell, type BrowserWindow } from 'electron'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
import { createNodeStorage, resolveInside } from './storage'
import { getSettings, saveSettings } from './settings'
import { createGitSync } from './sync'

let current: { root: string; lib: Library; storage: Storage; sync: ReturnType<typeof createGitSync> } | null = null
let notify: () => void = () => {}
let opened: (storage: Storage, deviceId: string) => void = () => {}

/** `onOpen` runs each time a Library is opened, for modules that keep state inside it. */
export async function initLibrary(onChanged: () => void, onOpen: (storage: Storage, deviceId: string) => void) {
  notify = onChanged
  opened = onOpen
  try {
    const { libraryPath } = getSettings()
    if (libraryPath) {
      await open(libraryPath)
      return
    }
    const root = process.env.FRAGMEMO_USER_DATA
      ? join(app.getPath('userData'), 'Library')
      : join(app.getPath('documents'), 'Fragmemo')
    await mkdir(root, { recursive: true })
    await openOrCreate(root, { ignoreHidden: false })
  } catch (err) {
    console.error('[library] open failed', err)
  }
}

export function library(): Library {
  if (!current) throw new Error('还没有打开 Library')
  return current.lib
}

/** Tell the UI that notes or decks changed outside the usual IPC calls (e.g. a finished task). */
export function notifyChanged() {
  notify()
}

/** Raw file access inside the Library, for shell-owned files such as tasks.json. */
export function libraryStorage(): Storage {
  if (!current) throw new Error('还没有打开 Library')
  return current.storage
}

export function libraryRoot(): string | null {
  return current?.root ?? null
}

async function open(root: string) {
  if (!(await stat(root)).isDirectory()) throw new Error('Library 必须是文件夹')
  const sync = createGitSync(root)
  await sync.init().catch((err) => console.warn('[library] git unavailable, history disabled', err))
  await sync.pull().catch((err) => console.warn('[library] pull failed', err))
  const { deviceId } = getSettings()
  const storage = createNodeStorage(root)
  const lib = createLibrary({
    storage,
    sync,
    clock: systemClock,
    ids: createIds(),
    deviceId,
    // The wasm is emitted next to the main bundle (see electron.vite.config.ts).
    loadSql: () => initSqlJs({ locateFile: (f) => join(__dirname, f) })
  })
  await lib.listDecks()
  saveSettings({ libraryPath: root })
  current = { root, lib, storage, sync }
  opened(storage, deviceId)
  notify()
}

async function openOrCreate(root: string, { ignoreHidden = true } = {}) {
  const entries = await readdir(root)
  const isLibrary = entries.includes(paths.decks) || entries.includes(paths.settings)
  if (!isLibrary) {
    if (entries.some((name) => !ignoreHidden || !name.startsWith('.'))) {
      throw new Error('这个文件夹里已经有别的东西了，换一个空文件夹吧')
    }
    await writeFile(resolveInside(root, paths.settings), '{}\n', { flag: 'wx' }).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'EEXIST') throw err
    })
  }
  await open(root)
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
  await openOrCreate(root)
  return root
}

export async function revealLibrary() {
  if (current) await shell.openPath(current.root)
}

/** Commit, then push in the background; a failed push is retried with the next commit. */
export async function commit(message: string): Promise<string | null> {
  if (!current) return null
  const hash = await current.lib.commit(message).catch((err) => {
    console.warn('[library] commit failed', err)
    return null
  })
  if (hash) current.sync.push().catch((err) => console.warn('[library] push failed', err))
  return hash
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
