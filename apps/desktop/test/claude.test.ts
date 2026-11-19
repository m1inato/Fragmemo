import { allTools, runAgent } from '@fragmemo/ai'
import { createLibrary, type Analyzer } from '@fragmemo/core'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fakeClock, memoryStorage, recordingSync, seqIds } from '../../../packages/core/test/helpers'
import { createClaudeCliProvider } from '../src/main/claude'
import { startMcpServer } from '../src/main/mcp'

const fake = join(__dirname, 'fixtures/fake-claude.mjs')
const analyzer: Analyzer = { analyze: async (_l, text) => [{ surface: text, base: text, pos: '', known: false }] }

async function setup() {
  const library = createLibrary({ storage: memoryStorage().storage, sync: recordingSync(), clock: fakeClock(), ids: seqIds('L'), deviceId: 'mac-t' })
  const deck = await library.createDeck({ name: 'D', lang: 'ja' })
  return { library, deck }
}

describe('MCP server', () => {
  it('rejects requests without the token and serves tools with it', async () => {
    const mcp = await startMcpServer([{ name: 'echo', description: 'd', parameters: { type: 'object' } }], async (_n, input) => ({ output: JSON.stringify(input) }))
    try {
      expect((await fetch(mcp.url, { method: 'POST', body: '{}' })).status).toBe(401)
      const post = (body: unknown) =>
        fetch(mcp.url, { method: 'POST', headers: { authorization: `Bearer ${mcp.token}` }, body: JSON.stringify(body) })
      type Rpc = { result: { protocolVersion?: string; content?: unknown; isError?: boolean }; error: { code: number } }
      const rpc = async (body: unknown) => (await (await post(body)).json()) as Rpc
      const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })
      expect(init.result.protocolVersion).toBe('2025-03-26')
      expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
      const call = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo', arguments: { a: 1 } } })
      expect(call.result).toEqual({ content: [{ type: 'text', text: '{"a":1}' }], isError: false })
      const missing = await rpc({ jsonrpc: '2.0', id: 3, method: 'nope' })
      expect(missing.error.code).toBe(-32601)
    } finally {
      await mcp.close()
    }
  })
})

describe('Claude CLI provider', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'fm-claude-'))

  it('runs the CLI with Fragmemo tools over MCP and streams its text', async () => {
    const { library, deck } = await setup()
    const argsFile = join(workDir, 'args.json')
    process.env.FAKE_CLAUDE_ARGS = argsFile
    const provider = createClaudeCliProvider({ path: fake, model: 'haiku', workDir })
    const deltas: string[] = []
    const res = await runAgent({
      provider, system: 'SYS', prompt: '做一条', tools: allTools,
      ctx: { library, analyzer, lang: 'ja', deckId: deck.id, ids: seqIds('A') },
      signal: new AbortController().signal,
      onEvent: (e) => e.type === 'text' && deltas.push(e.delta)
    })
    expect(res.text).toBe(`做好了 tools=${allTools.length} ok=true`)
    expect(res.session).toBe('session-1')
    expect(deltas.join('')).toBe('做好了')
    expect([...res.changes.proposals.values()].map((p) => p.note.key)).toEqual(['ja:嬉しい'])

    const { args, prompt } = JSON.parse(readFileSync(argsFile, 'utf8'))
    expect(prompt).toBe('做一条')
    expect(args).toEqual(expect.arrayContaining(['-p', '--system-prompt', 'SYS', '--tools', '', '--strict-mcp-config', '--model', 'haiku']))
    expect(args).not.toContain('做一条')

    // A follow-up continues the same session.
    const again = await runAgent({
      provider, system: 'SYS', prompt: '再来', tools: allTools, session: res.session,
      ctx: { library, analyzer, lang: 'ja', deckId: deck.id, ids: seqIds('B') }, signal: new AbortController().signal
    })
    expect(again.session).toBe('session-1')
    expect(JSON.parse(readFileSync(argsFile, 'utf8')).args).toEqual(expect.arrayContaining(['--resume', 'session-1']))
  })

  it('surfaces CLI errors as short messages', async () => {
    const { library } = await setup()
    const provider = createClaudeCliProvider({ path: fake, workDir })
    await expect(runAgent({
      provider, system: 's', prompt: 'FAIL', tools: [], ctx: { library, analyzer, lang: 'ja', ids: seqIds('C') }, signal: new AbortController().signal
    })).rejects.toThrow('Claude Code 出错：boom')
  })

  it('reports itself unavailable when the binary is missing', async () => {
    expect(await createClaudeCliProvider({ path: '/nonexistent/claude', workDir }).available()).toBe(false)
  })
})
