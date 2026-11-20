import type { LocalModel } from '@fragmemo/ui/api'
import type { CliProvider } from '@fragmemo/ai'
import { promisify } from 'node:util'
import { execFile, spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { cleanEnv, findExecutable } from './sync'

function locate() {
  const candidates = ['/opt/homebrew/bin/codex', '/usr/local/bin/codex', join(homedir(), '.local/bin/codex')]
  for (const root of ['/Applications', join(homedir(), 'Applications')]) {
    const bin = join(root, 'ChatGPT.app/Contents/Resources/codex-cli')
    candidates.push(join(bin, 'bin/codex'), join(bin, 'CodexCLI.app/Contents/MacOS/codex'))
  }
  return findExecutable('codex', candidates)
}

export async function codexModels(): Promise<LocalModel[]> {
  try {
    const { stdout } = await promisify(execFile)(await locate(), ['debug', 'models'], { env: cleanEnv(), timeout: 8000, maxBuffer: 16 * 1024 * 1024 })
    const catalog: { models: { visibility: string; slug: string; display_name?: string; supported_reasoning_levels?: { effort: string }[] }[] } = JSON.parse(stdout)
    return catalog.models.filter(m => m.visibility === 'list').map(m => ({ id: m.slug, label: m.display_name || m.slug, efforts: m.supported_reasoning_levels?.map(level => level.effort) ?? [] }))
  } catch {
    return []
  }
}

export function codexProvider(workDir: string, model: string, effort?: string): CliProvider {
  return {
    kind: 'cli', id: 'codex-cli', resumable: false,
    available: () => locate().then(() => true, () => false),
    async run(request) {
      const bin = await locate()
      await mkdir(workDir, { recursive: true })
      request.signal.throwIfAborted()
      const args = ['app-server', '-c', 'features.apps=false', '-c', 'features.plugins=false', '-c', 'features.memories=false', '-c', 'features.shell_tool=false']
      const child = spawn(bin, args, { cwd: workDir, env: cleanEnv(), stdio: 'pipe' })
      const lines = createInterface({ input: child.stdout })
      const send = (message: object) => child.stdin.write(JSON.stringify(message) + '\n')
      const rpc = (id: number, method: string, params: object) => send({ id, method, params })
      let answer = '', steps = 0, submissions = 0
      const commentary = new Set<string>()
      child.stderr.resume()
      const stop = () => child.kill()
      request.signal.addEventListener('abort', stop, { once: true })
      try {
        return await new Promise<{ text: string }>((resolve, reject) => {
          child.once('error', reject)
          child.stdin.on('error', reject)
          child.once('close', () => reject(request.signal.reason ?? new Error('Codex 已退出，请检查 ChatGPT 登录状态')))
          lines.on('line', async line => {
            try {
              const m = JSON.parse(line)
              const p = m.params
              if (m.method && m.id != null) {
                if (m.method !== 'item/tool/call') {
                  send({ id: m.id, error: { code: -32601, message: 'Unsupported request' } })
                  return
                }
                const isProposal = p.tool === 'propose_notes' && request.tools.some(tool => tool.name === p.tool)
                const withinLimit = isProposal ? ++submissions <= request.maxSteps : ++steps <= request.maxSteps * 2
                const result = withinLimit
                  ? await request.call(p.tool, p.arguments)
                  : { error: true, output: isProposal ? '提交次数已用完。请结束本批。' : '查询次数已用完。制卡任务请直接调用 propose_notes 提交。' }
                send({ id: m.id, result: { success: !result.error, contentItems: [{ type: 'inputText', text: result.output }] } })
              } else if (m.error) reject(new Error(m.error.message))
              else if (m.id === 1) {
                send({ method: 'initialized' })
                rpc(2, 'thread/start', {
                  model: model || null, cwd: workDir, sandbox: 'read-only', approvalPolicy: 'never', ephemeral: true,
                  config: { web_search: 'disabled' }, serviceName: 'Fragmemo', baseInstructions: request.system,
                  dynamicTools: request.tools.map(t => ({ type: 'function', name: t.name, description: t.description, inputSchema: t.parameters }))
                })
              } else if (m.id === 2) {
                rpc(3, 'turn/start', { threadId: m.result.thread.id, input: [{ type: 'text', text: request.prompt, text_elements: [] }], ...(effort ? { effort } : {}) })
              } else if (m.method === 'item/started' && p.item.phase === 'commentary') commentary.add(p.item.id)
              else if (m.method === 'item/agentMessage/delta' && !commentary.has(p.itemId)) request.onEvent?.({ type: 'text', delta: p.delta })
              else if (m.method === 'item/completed' && p.item.type === 'agentMessage' && p.item.phase !== 'commentary') answer = p.item.text
              else if (m.method === 'turn/completed') {
                if (p.turn.status === 'completed') resolve({ text: answer })
                else reject(new Error(p.turn.error?.message || 'Codex 调用未完成'))
              }
            } catch (error) { reject(error) }
          })
          rpc(1, 'initialize', { clientInfo: { name: 'fragmemo', version: '1' }, capabilities: { experimentalApi: true } })
        })
      } finally {
        request.signal.removeEventListener('abort', stop)
        lines.close()
        child.kill()
      }
    }
  }
}
