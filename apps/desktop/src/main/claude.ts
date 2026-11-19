import type { AgentEvent, CliProvider } from '@fragmemo/ai'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { claudeArgs } from './cli-args'
import { startMcpServer } from './mcp'
import { cleanEnv, findExecutable } from './sync'

// Claude Code, already installed and logged in on this Mac, as an agent backend. It runs its
// own tool loop; our tools reach it through a loopback MCP server for the length of one run.

export interface ClaudeCliConfig {
  /** Explicit path to the claude binary; found automatically when empty. */
  path?: string
  model?: string
  /** Optional Anthropic-compatible endpoint (e.g. DeepSeek) instead of the logged-in account. */
  baseUrl?: string
  authToken?: string
  /** Working directory for sessions, away from any project's CLAUDE.md. */
  workDir: string
}

const CANDIDATES = [join(homedir(), '.local/bin/claude'), join(homedir(), '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']

export function createClaudeCliProvider(cfg: ClaudeCliConfig): CliProvider {
  // An explicit path is taken as is; only an unset one is searched for.
  const locate = async () => {
    if (!cfg.path) return findExecutable('claude', CANDIDATES)
    if (!existsSync(cfg.path)) throw new Error(`找不到 ${cfg.path}`)
    return cfg.path
  }

  const env = () => {
    const e = cleanEnv()
    if (cfg.baseUrl) e.ANTHROPIC_BASE_URL = cfg.baseUrl
    if (cfg.authToken) e.ANTHROPIC_AUTH_TOKEN = cfg.authToken
    return e
  }

  return {
    id: 'claude-cli',
    kind: 'cli',

    async available() {
      try {
        await locate()
        return true
      } catch {
        return false
      }
    },

    async run({ system, prompt, session, tools, call, maxSteps, signal, onEvent }) {
      const bin = await locate()
      let steps = 0
      const mcp = await startMcpServer(tools, async (name, input) => {
        // Claude Code has no turn limit flag in print mode; cap tool use here instead.
        if (++steps > maxSteps * 2) return { output: '已经达到这次任务的步数上限，请停止调用工具并总结。', error: true }
        return call(name, input)
      })
      mkdirSync(cfg.workDir, { recursive: true })
      try {
        return await runProcess(bin, claudeArgs({ system, mcpUrl: mcp.url, mcpToken: mcp.token, model: cfg.model, session }), {
          cwd: cfg.workDir, env: env(), stdin: prompt, signal, onEvent
        })
      } finally {
        await mcp.close()
      }
    }
  }
}

interface StreamLine {
  type: string
  subtype?: string
  session_id?: string
  is_error?: boolean
  result?: string
  message?: { content?: { type: string; text?: string }[] }
  event?: { type: string; delta?: { type: string; text?: string } }
}

function runProcess(
  bin: string,
  args: string[],
  o: { cwd: string; env: NodeJS.ProcessEnv; stdin: string; signal: AbortSignal; onEvent?: (e: AgentEvent) => void }
): Promise<{ text: string; session?: string }> {
  return new Promise((resolve, reject) => {
    if (o.signal.aborted) return reject(o.signal.reason)
    const child = spawn(bin, args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] })
    const abort = () => child.kill('SIGTERM')
    o.signal.addEventListener('abort', abort, { once: true })

    let session: string | undefined
    // With partial messages the text arrives as deltas; the full assistant message repeats it.
    let streamed = false
    let result: StreamLine | undefined
    let buf = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buf += chunk
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        let ev: StreamLine
        try {
          ev = JSON.parse(line)
        } catch {
          continue
        }
        session = ev.session_id ?? session
        if (ev.type === 'stream_event' && ev.event?.delta?.type === 'text_delta' && ev.event.delta.text) {
          streamed = true
          o.onEvent?.({ type: 'text', delta: ev.event.delta.text })
        } else if (ev.type === 'assistant' && !streamed) {
          for (const c of ev.message?.content ?? []) if (c.type === 'text' && c.text) o.onEvent?.({ type: 'text', delta: c.text })
        } else if (ev.type === 'result') result = ev
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (c: string) => (stderr = (stderr + c).slice(-4000)))
    child.on('error', (err) => reject(new Error(`启动 Claude Code 失败：${err.message}`)))
    child.on('close', (code) => {
      o.signal.removeEventListener('abort', abort)
      if (o.signal.aborted) return reject(o.signal.reason)
      if (result && !result.is_error) return resolve({ text: result.result ?? '', session })
      const why = result?.result || stderr.trim().split('\n').pop() || `退出码 ${code}`
      reject(new Error(/log ?in|auth|credential/i.test(why) ? 'Claude Code 还没登录，先在终端里运行 claude 登录一次' : `Claude Code 出错：${why}`))
    })
    child.stdin.end(o.stdin)
  })
}
