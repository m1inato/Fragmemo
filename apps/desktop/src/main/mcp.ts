import type { ToolSpec } from '@fragmemo/ai'
import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

// A minimal MCP server over Streamable HTTP, bound to loopback with a per-run bearer token.
// Agent CLIs connect to it so their tool calls run here, in the main process, against the
// same tools and change set the API providers use.

export interface McpServer {
  url: string
  token: string
  close(): Promise<void>
}

type Call = (name: string, input: unknown) => Promise<{ output: string; error?: boolean }>

interface RpcRequest { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> }

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

export async function startMcpServer(tools: ToolSpec[], call: Call): Promise<McpServer> {
  const token = randomBytes(24).toString('hex')

  async function handle(req: RpcRequest): Promise<unknown> {
    switch (req.method) {
      case 'initialize': {
        const asked = String(req.params?.protocolVersion ?? '')
        return {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'fragmemo', version: '1' }
        }
      }
      case 'ping':
        return {}
      case 'tools/list':
        return { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })) }
      case 'tools/call': {
        const res = await call(String(req.params?.name ?? ''), req.params?.arguments ?? {})
        return { content: [{ type: 'text', text: res.output }], isError: !!res.error }
      }
      default:
        throw Object.assign(new Error(`method not found: ${req.method}`), { code: -32601 })
    }
  }

  async function respond(msg: RpcRequest) {
    try {
      return { jsonrpc: '2.0', id: msg.id ?? null, result: await handle(msg) }
    } catch (err) {
      const e = err as Error & { code?: number }
      return { jsonrpc: '2.0', id: msg.id ?? null, error: { code: e.code ?? -32603, message: e.message } }
    }
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.headers.authorization !== `Bearer ${token}`) return end(res, 401)
    if (req.method !== 'POST') return end(res, 405)
    let body: RpcRequest | RpcRequest[]
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      return end(res, 400)
    }
    const messages = Array.isArray(body) ? body : [body]
    const requests = messages.filter((m) => m.id !== undefined && m.id !== null && m.method)
    // Notifications and responses need no answer.
    if (!requests.length) return end(res, 202)
    const replies = await Promise.all(requests.map(respond))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(Array.isArray(body) ? replies : replies[0]))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}

function end(res: ServerResponse, status: number) {
  res.writeHead(status)
  res.end()
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
