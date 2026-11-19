import type { SyncBackend } from '@fragmemo/core'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

// The Library is a git repository: git gives us history, revert and (with a remote) sync.
// We drive the system git so the user's credentials and config just work.

const found = new Map<string, string>()

/**
 * Locate a command-line tool: the given candidates first, then the login shell's PATH, since
 * apps launched from Finder do not inherit it.
 */
export async function findExecutable(name: string, candidates: string[]): Promise<string> {
  const cached = found.get(name)
  if (cached && existsSync(cached)) return cached
  let path = candidates.find((p) => existsSync(p))
  if (!path) {
    const shell = process.env.SHELL || '/bin/zsh'
    const { stdout } = await run(shell, ['-lc', `command -v ${name}`], { env: cleanEnv() }).catch(() => ({ stdout: '' }))
    path = stdout.trim().split('\n').pop() || undefined
  }
  if (!path) throw new Error(`${name} not found`)
  found.set(name, path)
  return path
}

const findGit = () => findExecutable('git', ['/opt/homebrew/bin/git', '/usr/local/bin/git', '/usr/bin/git'])

/** Child-process environment without credentials meant for other tools, with a usable PATH. */
export function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('ANTHROPIC_')) env[k] = v
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
  env.PATH = [...new Set([...(env.PATH ?? '').split(':').filter(Boolean), ...extra])].join(':')
  env.GIT_TERMINAL_PROMPT = '0'
  return env
}

export function createGitSync(root: string): SyncBackend & { init(): Promise<void>; hasRemote(): Promise<boolean> } {
  const git = async (...args: string[]) => {
    const { stdout } = await run(await findGit(), args, { cwd: root, env: cleanEnv(), maxBuffer: 64 * 1024 * 1024 })
    return stdout.trim()
  }
  // Commits must succeed even on a machine where git has no identity configured yet.
  const identity = async () => {
    const email = await git('config', 'user.email').catch(() => '')
    return email ? [] : ['-c', 'user.name=Fragmemo', '-c', 'user.email=fragmemo@localhost']
  }
  const hasRemote = async () => (await git('remote').catch(() => '')).split('\n').includes('origin')

  const sync = {
    async init() {
      if (existsSync(join(root, '.git'))) return
      await git('init', '-q', '-b', 'main')
      // Phones append to the inbox concurrently; union merge keeps both sides' lines.
      await writeFile(join(root, '.gitattributes'), 'inbox.jsonl merge=union\n')
      await sync.commit('init: library')
    },
    hasRemote,
    async pull() {
      if (await hasRemote()) await git('pull', '--rebase', '--autostash', '-q', 'origin', 'main')
    },
    async commit(message: string) {
      await git('add', '-A')
      const staged = await git('diff', '--cached', '--name-only')
      if (!staged) return null
      await git(...(await identity()), 'commit', '-q', '-m', message)
      return git('rev-parse', 'HEAD')
    },
    async push() {
      if (await hasRemote()) await git('push', '-q', 'origin', 'HEAD:main')
    }
  }
  return sync
}
