import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Theme } from '@fragmemo/ui/api'

// Settings that belong to this machine, not to the Library: where the Library lives,
// this device's id for log files, and the window theme. Library-wide settings live in
// the Library's own settings.json (see library.ts).

export interface LocalSettings {
  libraryPath: string | null
  deviceId: string
  theme: Theme
}

const THEMES: Theme[] = ['light', 'dark', 'sepia', 'system']
let cache: LocalSettings | null = null

function file() {
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): LocalSettings {
  if (cache) return cache
  let raw: Record<string, unknown> = {}
  try {
    raw = JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    // First launch or unreadable file: start from defaults.
  }
  cache = {
    libraryPath: typeof raw.libraryPath === 'string' ? raw.libraryPath : null,
    deviceId: typeof raw.deviceId === 'string' && /^mac-[a-z0-9]+$/.test(raw.deviceId) ? raw.deviceId : `mac-${randomBytes(3).toString('hex')}`,
    theme: THEMES.includes(raw.theme as Theme) ? (raw.theme as Theme) : 'system'
  }
  if (raw.deviceId !== cache.deviceId) persist(cache)
  return cache
}

export function saveSettings(patch: Partial<LocalSettings>): LocalSettings {
  cache = { ...getSettings(), ...patch }
  persist(cache)
  return cache
}

function persist(s: LocalSettings) {
  mkdirSync(app.getPath('userData'), { recursive: true })
  const tmp = `${file()}.tmp`
  writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n')
  renameSync(tmp, file())
}
