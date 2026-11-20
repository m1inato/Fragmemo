import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiProviderId, Palette, Theme } from '@fragmemo/ui/api'

// Settings that belong to this machine, not to the Library: where the Library lives,
// this device's id for log files, and the window theme. Library-wide settings live in
// the Library's own settings.json (see library.ts).

export interface LocalSettings {
  libraryPath: string | null
  deviceId: string
  theme: Theme
  palette: Palette
  ai: StoredAiSettings
}

/** Secrets are stored encrypted with the OS keychain (safeStorage), see ai.ts. */
export interface StoredAiSettings {
  purposes: Record<'write' | 'qa', { provider: AiProviderId; model: string; effort?: string }>
  deepseek: { key: string }
  claude: { path: string; model: string; baseUrl: string; authToken: string }
  openai: { baseUrl: string; model: string; apiKey: string }
}

const DEFAULT_AI: StoredAiSettings = {
  deepseek: { key: '' },
  purposes: { write: { provider: 'claude-cli', model: '' }, qa: { provider: 'claude-cli', model: '' } },
  claude: { path: '', model: '', baseUrl: '', authToken: '' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '' }
}

const THEMES: Theme[] = ['light', 'dark', 'sepia', 'system']
const PALETTES: Palette[] = ['sky', 'sakura', 'mint', 'matcha', 'plain']
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
    theme: THEMES.includes(raw.theme as Theme) ? (raw.theme as Theme) : 'system',
    palette: PALETTES.includes(raw.palette as Palette) ? (raw.palette as Palette) : 'sky',
    ai: mergeAi(DEFAULT_AI, raw.ai)
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

/** Deep-merge one level down, so new fields get defaults and old files keep working. */
export function mergeAi(base: StoredAiSettings, patch: unknown): StoredAiSettings {
  const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, Record<string, unknown>>
  const purposes = (p.purposes ?? {}) as Record<string, object>
  return {
    purposes: {
      write: { ...base.purposes.write, ...(purposes.write ?? {}) },
      qa: { ...base.purposes.qa, ...(purposes.qa ?? {}) }
    },
    deepseek: { ...base.deepseek, ...(p.deepseek ?? {}) },
    claude: { ...base.claude, ...(p.claude ?? {}) },
    openai: { ...base.openai, ...(p.openai ?? {}) }
  }
}
