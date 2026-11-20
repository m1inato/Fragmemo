import { PRESET_DECKS, sha256Hex, type ImportResult, type PresetDeck } from '@fragmemo/core'
import type { PresetInfo } from '@fragmemo/ui/api'
import { app, net } from 'electron'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { importPackage } from './library'

// Preset decks are downloaded once into the app cache (not the Library), checked against the
// catalog hash, then imported like any picked .apkg.

const dir = () => join(app.getPath('userData'), 'presets')
const fileOf = (p: PresetDeck) => join(dir(), `${p.id}.apkg`)
const inflight = new Map<string, Promise<void>>()

export async function listPresets(): Promise<PresetInfo[]> {
  return Promise.all(PRESET_DECKS.map(async (p) => ({
    ...p,
    downloaded: await stat(fileOf(p)).then((s) => s.size === p.bytes, () => false)
  })))
}

export async function importPreset(
  id: string,
  withHistory: boolean,
  onProgress: (e: { id: string; received: number; total: number }) => void
): Promise<ImportResult> {
  const preset = PRESET_DECKS.find((p) => p.id === id)
  if (!preset) throw new Error('没有这个预设卡包')
  if (!(await listPresets()).find((p) => p.id === id)?.downloaded) {
    let job = inflight.get(id)
    if (!job) {
      job = download(preset, (received) => onProgress({ id, received, total: preset.bytes })).finally(() => inflight.delete(id))
      inflight.set(id, job)
    }
    await job
  }
  const bytes = new Uint8Array(await readFile(fileOf(preset)))
  // The cached file could have been touched since download; check again before importing.
  if ((await sha256Hex(bytes)) !== preset.sha256) {
    await rm(fileOf(preset), { force: true })
    throw new Error('卡包文件已损坏，请重新下载')
  }
  return importPackage(bytes, { withHistory, name: preset.name })
}

async function download(p: PresetDeck, onProgress: (received: number) => void) {
  await mkdir(dir(), { recursive: true })
  const tmp = `${fileOf(p)}.${process.pid}.part`
  const res = await net.fetch(p.url).catch(() => null)
  if (!res?.ok || !res.body) throw new Error('下载失败，检查网络后重试')
  const hash = createHash('sha256')
  const out = createWriteStream(tmp)
  let received = 0
  let last = 0
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk)
      received += chunk.length
      if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()))
      if (received - last > 512 * 1024) {
        last = received
        onProgress(received)
      }
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
    if (hash.digest('hex') !== p.sha256) throw new Error('下载的文件校验不通过，请重试')
    await rename(tmp, fileOf(p))
    onProgress(received)
  } catch (err) {
    out.destroy()
    await rm(tmp, { force: true })
    throw err instanceof Error && /[一-鿿]/.test(err.message) ? err : new Error('下载中断，请重试')
  }
}
