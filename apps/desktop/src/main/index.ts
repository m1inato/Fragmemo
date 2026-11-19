import type { Theme } from '@fragmemo/ui/api'
import { app, BrowserWindow, ipcMain, nativeTheme, net, protocol, shell, type IpcMainInvokeEvent } from 'electron'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { TaskInput } from '@fragmemo/ai'
import type { AiPurpose, AiSettingsPatch, TaskAction } from '@fragmemo/ui/api'
import type { Lang } from '@fragmemo/core'
import * as ai from './ai'
import * as jobs from './jobs'
import * as lib from './library'
import * as review from './review'
import { getSettings, saveSettings } from './settings'
import * as tasks from './tasks'

// Wiring only: window, protocol and IPC registration. Behaviour lives in the domain modules.

if (process.env.FRAGMEMO_USER_DATA) app.setPath('userData', resolve(process.env.FRAGMEMO_USER_DATA))

protocol.registerSchemesAsPrivileged([
  { scheme: 'fragmemo', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

let win: BrowserWindow | null = null

const BACKGROUND: Record<Exclude<Theme, 'system'>, string> = { light: '#fcfcfc', dark: '#18191b', sepia: '#f6f0e3' }

function background(theme: Theme): string {
  return BACKGROUND[theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : theme]
}

function createWindow() {
  const { theme } = getSettings()
  win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: 'Fragmemo',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 21 },
    backgroundColor: background(theme),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))

  // The window only ever shows the app itself; links open in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault()
  })

  const query = { theme }
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query)}`)
  else win.loadFile(join(__dirname, '../renderer/index.html'), { query })
}

function registerMediaProtocol() {
  protocol.handle('fragmemo', (req) => {
    const url = new URL(req.url)
    const [deckId, file] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    const path = url.host === 'media' && deckId && file ? lib.mediaFile(deckId, file) : null
    if (!path) return new Response('not found', { status: 404 })
    return net.fetch(pathToFileURL(path).toString(), { headers: req.headers })
  })
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>) {
  ipcMain.handle(channel, (_e: IpcMainInvokeEvent, ...args: unknown[]) => fn(...(args as A)))
}

function broadcast(channel: string, payload?: unknown) {
  win?.webContents.send(channel, payload)
}

function appState() {
  const s = getSettings()
  return { libraryPath: lib.libraryRoot(), deviceId: s.deviceId, theme: s.theme, version: app.getVersion(), platform: process.platform }
}

function registerIpc(libraryReady: Promise<void>) {
  handle('app:get', async () => {
    await libraryReady
    return appState()
  })
  handle('app:setTheme', (theme: Theme) => {
    saveSettings({ theme })
    win?.setBackgroundColor(background(theme))
  })

  handle('library:choose', async () => (win && (await lib.chooseLibrary(win)) ? appState() : null))
  handle('library:reveal', lib.revealLibrary)

  handle('settings:get', lib.getLibrarySettings)
  handle('settings:save', lib.saveLibrarySettings)

  handle('decks:overview', lib.overview)
  handle('decks:create', lib.createDeck)
  handle('decks:importApkg', (o: { withHistory: boolean }) => (win ? lib.importApkg(win, o) : null))
  handle('notes:list', lib.listNotes)
  handle('notes:upsert', lib.saveNote)
  handle('notes:delete', lib.deleteNote)

  handle('review:next', review.next)
  handle('review:prepare', review.prepare)
  handle('review:answer', review.answer)
  handle('review:undo', review.undo)
  handle('review:pin', review.pinMode)
  handle('review:finish', review.finish)

  handle('ai:getSettings', ai.getAiSettings)
  handle('ai:saveSettings', (patch: AiSettingsPatch) => ai.saveAiSettings(patch))
  handle('ai:test', (purpose: AiPurpose) => ai.testAi(purpose))
  handle('profile:get', ai.getProfile)
  handle('profile:save', ai.saveProfile)

  handle('tasks:list', tasks.listTasks)
  handle('tasks:create', (input: TaskInput) => jobs.createTask(input))
  handle('tasks:act', (id: string, action: TaskAction) => tasks.act(id, action))
  handle('tasks:resolve', jobs.resolvePending)

  handle('qa:ask', (id: string, lang: Lang, question: string) =>
    ai.ask(id, lang, question, (delta) => broadcast('qa:delta', { conversationId: id, delta })))
  handle('qa:stop', ai.stopAsking)
  handle('qa:forget', ai.forgetConversation)
}

app.whenReady().then(() => {
  registerMediaProtocol()
  jobs.registerAiRunners()
  const libraryReady = lib.initLibrary(
    () => broadcast('library:changed'),
    (storage, deviceId) =>
      tasks.initTasks(storage, deviceId, (list) => broadcast('tasks:changed', list))
  )
  registerIpc(libraryReady)
  createWindow()
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow()
  })
})

// Commit an unfinished review round before quitting; quit again once it is written.
let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  e.preventDefault()
  quitting = true
  review.finish().catch(() => {}).finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
