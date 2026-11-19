import { createOpenAICompatProvider, readTools, runAgent, tutorSystem, type Msg, type Provider } from '@fragmemo/ai'
import { createAnalyzer, createIds, type Analyzer, type Lang } from '@fragmemo/core'
import type { AiPurpose, AiSettings, AiSettingsPatch } from '@fragmemo/ui/api'
import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { codexProvider } from './codex'
import { createClaudeCliProvider } from './claude'
import { commit, library } from './library'
import { getSettings, mergeAi, saveSettings, type StoredAiSettings } from './settings'

// Which model does what: settings, provider construction, and the Q&A side panel.

let analyzer: Analyzer | null = null

/** kuromoji's dictionary ships next to the main bundle (see electron.vite.config.ts). */
export function getAnalyzer(): Analyzer {
  return (analyzer ??= createAnalyzer({ jaDictPath: join(__dirname, 'dict') }))
}

// Secrets never leave this machine and are encrypted with the OS keychain when it is available.
const seal = (s: string) => (!s ? '' : safeStorage.isEncryptionAvailable() ? `enc:${safeStorage.encryptString(s).toString('base64')}` : `raw:${s}`)
const open = (s: string) => {
  if (s.startsWith('enc:')) {
    try {
      return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'))
    } catch {
      return ''
    }
  }
  return s.startsWith('raw:') ? s.slice(4) : s
}

export function getAiSettings(): AiSettings {
  const { purposes, claude, openai, deepseek } = getSettings().ai
  return {
    purposes, deepseek: { hasKey: !!deepseek.key },
    claude: { path: claude.path, model: claude.model, baseUrl: claude.baseUrl, hasAuthToken: !!claude.authToken },
    openai: { baseUrl: openai.baseUrl, model: openai.model, hasApiKey: !!openai.apiKey }
  }
}

export function saveAiSettings(patch: AiSettingsPatch): AiSettings {
  const cur = getSettings().ai
  const next: StoredAiSettings = mergeAi(cur, {
    purposes: patch.purposes,
    deepseek: patch.deepseek ? { key: seal(patch.deepseek.key) } : undefined,
    claude: { ...patch.claude, ...(patch.claude?.authToken !== undefined ? { authToken: seal(patch.claude.authToken) } : {}) },
    openai: { ...patch.openai, ...(patch.openai?.apiKey !== undefined ? { apiKey: seal(patch.openai.apiKey) } : {}) }
  })
  saveSettings({ ai: next })
  return getAiSettings()
}

export function providerFor(purpose: AiPurpose): Provider {
  const { purposes, claude, openai, deepseek } = getSettings().ai
  const choice = purposes[purpose]
  const workDir = join(app.getPath('userData'), 'agent')
  if (choice.provider === 'codex-cli') return codexProvider(workDir, choice.model, choice.effort)
  if (choice.provider === 'deepseek') {
    const authToken = open(deepseek.key)
    if (!authToken) throw new Error('请先在设置里保存 DeepSeek API Key')
    return createClaudeCliProvider({ path: claude.path, workDir, model: choice.model || 'deepseek-flash', effort: choice.effort,
      baseUrl: 'https://api.deepseek.com/anthropic', authToken, deepseek: true })
  }
  if (choice.provider === 'openai-compatible') {
    return createOpenAICompatProvider({ baseUrl: openai.baseUrl, apiKey: open(openai.apiKey), model: choice.model || openai.model })
  }
  return createClaudeCliProvider({
    effort: choice.effort,
    path: claude.path || undefined,
    model: choice.model || claude.model || undefined,
    baseUrl: claude.baseUrl || undefined,
    authToken: open(claude.authToken) || undefined,
    workDir: join(app.getPath('userData'), 'agent')
  })
}

/** Ask the configured model for a one-word reply, so settings can show whether it works. */
export async function testAi(purpose: AiPurpose): Promise<string> {
  const provider = providerFor(purpose)
  if (!(await provider.available())) {
    if (provider.id === 'codex-cli') throw new Error('请安装 ChatGPT 桌面版或 Codex CLI，并登录 ChatGPT')
    throw new Error(provider.id === 'claude-cli' ? '没找到 Claude Code，装好后在终端里登录一次' : '先填好 Base URL、API key 和模型')
  }
  const res = await runAgent({
    provider,
    system: '你是连通性测试。',
    prompt: '只回复两个字：可以',
    tools: [],
    ctx: { library: library(), analyzer: getAnalyzer(), lang: 'ja', ids: createIds() },
    maxSteps: 1,
    signal: AbortSignal.timeout(90_000)
  })
  return res.text.trim() ? '连接正常' : '连上了，但模型没有回复'
}

export const getProfile = (lang: Lang) => library().profile(lang)

export async function saveProfile(lang: Lang, text: string) {
  await library().saveProfile(lang, text)
  await commit(`edit: profile.${lang}`)
}

// Q&A: one conversation per side-panel session, read-only tools, answer streamed as it comes.

interface Conversation { lang: Lang; history: Msg[]; session?: string; controller?: AbortController }
const conversations = new Map<string, Conversation>()

export async function ask(id: string, lang: Lang, question: string, onDelta: (delta: string) => void): Promise<string> {
  let conv = conversations.get(id)
  if (!conv || conv.lang !== lang) conversations.set(id, (conv = { lang, history: [] }))
  conv.controller?.abort()
  const controller = (conv.controller = new AbortController())
  const res = await runAgent({
    provider: providerFor('qa'),
    system: tutorSystem(lang, await library().profile(lang)),
    prompt: question,
    tools: readTools,
    ctx: { library: library(), analyzer: getAnalyzer(), lang, ids: createIds() },
    maxSteps: 6,
    signal: controller.signal,
    history: conv.history,
    session: conv.session,
    onEvent: (e) => e.type === 'text' && onDelta(e.delta)
  })
  conv.history = res.transcript
  conv.session = res.session ?? conv.session
  return res.text
}

export function stopAsking(id: string) {
  conversations.get(id)?.controller?.abort()
}

export function forgetConversation(id: string) {
  stopAsking(id)
  conversations.delete(id)
}
