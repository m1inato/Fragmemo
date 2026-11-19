import type { Lang } from '@fragmemo/core'

const LOCALES: Record<Lang, string> = { ja: 'ja-JP', en: 'en-US' }
let audio: HTMLAudioElement | null = null

/** Play a recording when there is one, otherwise the system voice. Never throws. */
export async function speak(o: { lang: Lang; text?: string; url?: string }): Promise<void> {
  stop()
  if (o.url) {
    audio = new Audio(o.url)
    try {
      await audio.play()
      return
    } catch {
      // Missing or undecodable file: fall through to the system voice.
    }
  }
  if (!o.text || typeof speechSynthesis === 'undefined') return
  const u = new SpeechSynthesisUtterance(o.text)
  u.lang = LOCALES[o.lang]
  const voice = speechSynthesis.getVoices().find((v) => v.lang === u.lang && v.localService)
  if (voice) u.voice = voice
  speechSynthesis.speak(u)
}

export function stop() {
  audio?.pause()
  audio = null
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}
