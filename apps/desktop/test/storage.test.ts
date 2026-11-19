import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNodeStorage, resolveInside } from '../src/main/storage'

describe('NodeStorage', () => {
  const root = mkdtempSync(join(tmpdir(), 'fm-storage-'))
  const storage = createNodeStorage(root)

  it('survives overlapping atomic writes to one file', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => storage.writeText('tasks/a.json', String(i))))
    expect(Number(await storage.readText('tasks/a.json'))).toBeGreaterThanOrEqual(0)
    expect(await storage.list('tasks')).toEqual(['a.json'])
  })

  it('reads missing files as null and lists missing dirs as empty', async () => {
    expect(await storage.readText('nope.json')).toBeNull()
    expect(await storage.list('nope')).toEqual([])
  })

  it('refuses paths outside the Library', () => {
    expect(() => resolveInside(root, '../x')).toThrow()
    expect(() => resolveInside(root, '/etc/passwd')).toThrow()
    expect(() => resolveInside(root, 'decks/../../x')).toThrow()
    expect(resolveInside(root, 'decks/a/notes.jsonl')).toBe(join(root, 'decks/a/notes.jsonl'))
  })
})
