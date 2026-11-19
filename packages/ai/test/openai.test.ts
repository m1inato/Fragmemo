import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenAICompatProvider } from '../src'

const provider = createOpenAICompatProvider({ baseUrl: 'https://api.example.com/v1/', apiKey: 'sk-test', model: 'm-1' })
const signal = new AbortController().signal

function sse(chunks: unknown[]): Response {
  const enc = new TextEncoder()
  const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  // Split mid-way through a multi-byte character to exercise streaming decode.
  const bytes = enc.encode(text)
  const parts = [bytes.slice(0, 37), bytes.slice(37)]
  return new Response(new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(p)); c.close() } }))
}

afterEach(() => vi.unstubAllGlobals())

describe('OpenAI-compatible provider', () => {
  it('sends system, history and tools in chat-completions shape', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '好', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'known_terms', arguments: '{}' } }] } }] })))
    vi.stubGlobal('fetch', fetch)
    const turn = await provider.step({
      system: 'sys',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c0', name: 'search_notes', input: { query: 'x' } }] },
        { role: 'tool', toolCallId: 'c0', name: 'search_notes', content: '[]' }
      ],
      tools: [{ name: 'known_terms', description: 'd', parameters: { type: 'object' } }],
      signal
    })
    expect(turn).toEqual({ text: '好', toolCalls: [{ id: 'c1', name: 'known_terms', input: {} }] })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(init.headers.authorization).toBe('Bearer sk-test')
    const body = JSON.parse(init.body)
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user', 'assistant', 'tool'])
    expect(body.messages[2].tool_calls[0].function).toEqual({ name: 'search_notes', arguments: '{"query":"x"}' })
    expect(body.tools[0]).toEqual({ type: 'function', function: { name: 'known_terms', description: 'd', parameters: { type: 'object' } } })
    expect(body.stream).toBe(false)
  })

  it('streams text and stitches tool call fragments', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      { choices: [{ delta: { content: '嬉し' } }] },
      { choices: [{ delta: { content: 'い' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c9', function: { name: 'propose_', arguments: '{"notes":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'notes', arguments: '[]}' } }] } }] }
    ])))
    const deltas: string[] = []
    const turn = await provider.step({ system: 's', messages: [{ role: 'user', content: 'x' }], signal }, (d) => deltas.push(d))
    expect(deltas.join('')).toBe('嬉しい')
    expect(turn).toEqual({ text: '嬉しい', toolCalls: [{ id: 'c9', name: 'propose_notes', input: { notes: [] } }] })
  })

  it('turns HTTP errors into short messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"bad key"}}', { status: 401 })))
    await expect(provider.step({ system: 's', messages: [], signal })).rejects.toThrow('这个 API key 不对')
  })
})
