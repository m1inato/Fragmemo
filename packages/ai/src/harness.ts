import { toolSpec, type Tool } from './tools'
import type { AgentEvent, ChangeSet, Msg, Provider, ToolCtx } from './types'

export interface AgentResult {
  text: string
  changes: ChangeSet
  /** CLI providers: id to continue the conversation. */
  session?: string
  /** API providers: the full conversation, to continue it. */
  transcript: Msg[]
}

const MAX_OUTPUT = 12_000

export function createChangeSet(): ChangeSet {
  return { proposals: new Map() }
}

/**
 * Run one agent turn to completion. API providers loop here until the model stops calling tools
 * or `maxSteps` is reached; CLI providers loop on their own and call back into the same tools.
 */
export async function runAgent(o: {
  provider: Provider
  system: string
  prompt: string
  tools: Tool<any, any>[]
  ctx: Omit<ToolCtx, 'changes' | 'signal'> & { changes?: ChangeSet }
  maxSteps?: number
  signal: AbortSignal
  onEvent?: (e: AgentEvent) => void
  /** Continue an earlier run: its transcript (API) or session (CLI). */
  history?: Msg[]
  session?: string
}): Promise<AgentResult> {
  const changes = o.ctx.changes ?? createChangeSet()
  const ctx: ToolCtx = { ...o.ctx, changes, signal: o.signal }
  const maxSteps = o.maxSteps ?? 12
  const byName = new Map(o.tools.map((t) => [t.name, t]))
  const emit = (e: AgentEvent) => o.onEvent?.(e)

  async function call(name: string, input: unknown): Promise<{ output: string; error?: boolean }> {
    emit({ type: 'tool', name, input })
    const tool = byName.get(name)
    let res: { output: string; error?: boolean }
    if (!tool) res = { output: `没有这个工具：${name}`, error: true }
    else {
      const parsed = tool.input.safeParse(input)
      if (!parsed.success) res = { output: `参数不对：${parsed.error.message}`, error: true }
      else {
        try {
          res = { output: clip(JSON.stringify(await tool.run(parsed.data, ctx))) }
        } catch (err) {
          res = { output: `工具出错：${err instanceof Error ? err.message : String(err)}`, error: true }
        }
      }
    }
    emit({ type: 'tool-result', name, ...res })
    return res
  }

  const specs = o.tools.map(toolSpec)

  if (o.provider.kind === 'cli') {
    const res = await o.provider.run({
      system: o.system, prompt: o.provider.id === 'codex-cli' && o.history?.length
        ? JSON.stringify([...o.history, { role: 'user', content: o.prompt }])
        : o.prompt, session: o.session, tools: specs, call, maxSteps, signal: o.signal, onEvent: o.onEvent
    })
    return { text: res.text, changes, session: res.session, transcript: [...(o.history ?? []), { role: 'user', content: o.prompt }, { role: 'assistant', content: res.text }] }
  }

  const messages: Msg[] = [...(o.history ?? []), { role: 'user', content: o.prompt }]
  let text = ''
  for (let step = 1; step <= maxSteps; step++) {
    o.signal.throwIfAborted()
    emit({ type: 'step', step })
    const turn = await o.provider.step(
      { system: o.system, messages, tools: specs.length ? specs : undefined, signal: o.signal },
      (delta) => emit({ type: 'text', delta })
    )
    messages.push({ role: 'assistant', content: turn.text, ...(turn.toolCalls.length ? { toolCalls: turn.toolCalls } : {}) })
    text = turn.text
    if (!turn.toolCalls.length) break
    for (const tc of turn.toolCalls) {
      const res = await call(tc.name, tc.input)
      messages.push({ role: 'tool', toolCallId: tc.id, name: tc.name, content: res.output })
    }
  }
  return { text, changes, transcript: messages }
}

function clip(s: string): string {
  return s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}…（已截断，缩小查询范围再试）` : s
}
