import type { ApiProvider, AssistantTurn, Msg, ToolCall, ToolSpec } from './types'
import { utf8 } from './util'

// Any endpoint that speaks OpenAI chat completions: OpenAI, DeepSeek, OpenRouter, Ollama, …

export interface OpenAICompatConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export function createOpenAICompatProvider(cfg: OpenAICompatConfig): ApiProvider {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` }

  return {
    id: 'openai-compatible',
    kind: 'api',

    async available() {
      return !!(cfg.baseUrl && cfg.apiKey && cfg.model)
    },

    async step({ system, messages, tools, signal }, onText) {
      const body = {
        model: cfg.model,
        messages: [{ role: 'system', content: system }, ...messages.map(toWire)],
        ...(tools?.length ? { tools: tools.map(toWireTool) } : {}),
        stream: !!onText
      }
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
      if (!res.ok) throw new Error(httpError(res.status, await res.text().catch(() => '')))
      return onText ? readStream(res, onText) : parseMessage(JSON.parse(await res.text()))
    }
  }
}

function toWire(m: Msg) {
  switch (m.role) {
    case 'user':
      return { role: 'user', content: m.content }
    case 'assistant':
      return {
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) }
          : {})
      }
    case 'tool':
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
  }
}

function toWireTool(t: ToolSpec) {
  return { type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }
}

interface WireToolCall { id?: string; index?: number; function?: { name?: string; arguments?: string } }

function parseMessage(json: { choices?: { message?: { content?: string | null; tool_calls?: WireToolCall[] } }[] }): AssistantTurn {
  const msg = json.choices?.[0]?.message
  return {
    text: msg?.content ?? '',
    toolCalls: (msg?.tool_calls ?? []).map((c, i) => toCall(c.id ?? `call_${i}`, c.function?.name ?? '', c.function?.arguments ?? ''))
  }
}

function toCall(id: string, name: string, args: string): ToolCall {
  let input: unknown = {}
  try {
    input = args.trim() ? JSON.parse(args) : {}
  } catch {
    // Leave malformed arguments as a string; the harness reports the schema error to the model.
    input = args
  }
  return { id, name, input }
}

/** Server-sent events: text deltas stream out, tool call fragments are stitched by index. */
async function readStream(res: Response, onText: (delta: string) => void): Promise<AssistantTurn> {
  if (!res.body) throw new Error('响应没有内容')
  const reader = res.body.getReader()
  const calls = new Map<number, { id: string; name: string; args: string }>()
  let text = ''
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (value) buf += utf8.decode(value, true)
    const lines = buf.split('\n')
    buf = done ? '' : lines.pop() ?? ''
    for (const line of lines) {
      const data = line.startsWith('data:') ? line.slice(5).trim() : ''
      if (!data || data === '[DONE]') continue
      let chunk: { choices?: { delta?: { content?: string | null; tool_calls?: WireToolCall[] } }[] }
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }
      const delta = chunk.choices?.[0]?.delta
      if (delta?.content) {
        text += delta.content
        onText(delta.content)
      }
      for (const c of delta?.tool_calls ?? []) {
        const i = c.index ?? 0
        const cur = calls.get(i) ?? { id: '', name: '', args: '' }
        if (c.id) cur.id = c.id
        if (c.function?.name) cur.name += c.function.name
        if (c.function?.arguments) cur.args += c.function.arguments
        calls.set(i, cur)
      }
    }
    if (done) break
  }
  return {
    text,
    toolCalls: [...calls.entries()].sort(([a], [b]) => a - b).map(([i, c]) => toCall(c.id || `call_${i}`, c.name, c.args))
  }
}

function httpError(status: number, body: string): string {
  if (status === 401 || status === 403) return '这个 API key 不对，去设置里检查一下'
  if (status === 404) return '找不到这个模型或接口地址，检查一下 Base URL 和模型名'
  if (status === 429) return '请求太频繁或额度用完了，稍后再试'
  const detail = body.match(/"message"\s*:\s*"([^"]+)"/)?.[1]
  return `AI 接口出错（${status}）${detail ? `：${detail}` : ''}`
}
