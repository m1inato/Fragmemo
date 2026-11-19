import { normalizeRelative, type Storage } from '@fragmemo/core'
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

/** Resolve a Library-relative path, refusing anything that would land outside the root. */
export function resolveInside(root: string, rel: string): string {
  const abs = resolve(root, normalizeRelative(rel))
  const back = relative(root, abs)
  if (!back || back.split(sep)[0] === '..' || isAbsolute(back)) throw new Error(`path escapes library: ${rel}`)
  return abs
}

export function createNodeStorage(root: string): Storage {
  const at = (p: string) => resolveInside(root, p)

  async function atomicWrite(p: string, data: string | Uint8Array) {
    const file = at(p)
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await writeFile(tmp, data)
    await rename(tmp, file)
  }

  return {
    async readText(p) {
      return readFile(at(p), 'utf8').catch(missing)
    },
    writeText: atomicWrite,
    async appendText(p, data) {
      const file = at(p)
      await mkdir(dirname(file), { recursive: true })
      await appendFile(file, data, 'utf8')
    },
    async list(dir) {
      const names = await readdir(at(dir)).catch(() => [] as string[])
      return names.filter((n) => !n.startsWith('.') && !n.endsWith('.tmp')).sort()
    },
    async readBytes(p) {
      const buf = await readFile(at(p)).catch(missing)
      return buf ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : null
    },
    writeBytes: atomicWrite
  }
}

function missing(err: NodeJS.ErrnoException): null {
  if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null
  throw err
}
