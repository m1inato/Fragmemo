#!/usr/bin/env node
// Stands in for the claude CLI: reads the prompt on stdin, talks to the MCP server it was given,
// and prints stream-json the way Claude Code does.
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const flag = (name) => args[args.indexOf(name) + 1]
const prompt = await new Promise((resolve) => {
  let s = ''
  process.stdin.on('data', (c) => (s += c))
  process.stdin.on('end', () => resolve(s))
})
if (process.env.FAKE_CLAUDE_ARGS) writeFileSync(process.env.FAKE_CLAUDE_ARGS, JSON.stringify({ args, prompt }))
if (prompt.includes('FAIL')) {
  console.log(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'boom', session_id: 's1' }))
  process.exit(1)
}

const server = JSON.parse(flag('--mcp-config')).mcpServers.fragmemo
let id = 0
const rpc = async (method, params) => {
  const res = await fetch(server.url, { method: 'POST', headers: { ...server.headers, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })
  return (await res.json()).result
}
const session = args.includes('--resume') ? flag('--resume') : 'session-1'
const out = (o) => console.log(JSON.stringify({ session_id: session, ...o }))
out({ type: 'system', subtype: 'init' })
await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake', version: '0' } })
const { tools } = await rpc('tools/list', {})
const called = await rpc('tools/call', {
  name: 'propose_notes',
  arguments: { notes: [{ type: 'word', fields: { term: '嬉しい', meaning: '高兴的' } }] }
})
out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '做' } } })
out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '好了' } } })
out({ type: 'assistant', message: { content: [{ type: 'text', text: '做好了' }] } })
out({ type: 'result', subtype: 'success', is_error: false, result: `做好了 tools=${tools.length} ok=${!called.isError}` })
