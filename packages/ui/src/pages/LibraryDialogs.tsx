import type { Lang } from '@fragmemo/core'
import { useState } from 'react'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { LANG_LABELS } from '../lib/format'

export function CreateDeckDialog({ lang: initial, onClose, onCreated }: { lang?: Lang; onClose: () => void; onCreated: (deckId: string) => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [lang, setLang] = useState<Lang>(initial ?? 'ja')
  async function run() {
    const deck = await toast.track(api.createDeck({ name: name.trim(), lang }), { pending: '正在创建…', done: '卡组建好了' }).catch(() => null)
    if (deck) {
      onClose()
      onCreated(deck.id)
    }
  }
  return (
    <Modal
      title="新建卡组"
      onClose={onClose}
      footer={
        <>
          <button className="button" onClick={onClose}>取消</button>
          <button className="button button-primary" disabled={!name.trim()} onClick={run}>创建</button>
        </>
      }
    >
      <label className="field">
        <span>名称</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：N3 情绪类形容词" onKeyDown={(e) => e.key === 'Enter' && name.trim() && run()} />
      </label>
      <div className="field">
        <span>语言</span>
        <div className="segmented">
          {(['ja', 'en'] as Lang[]).map((l) => (
            <button key={l} className={lang === l ? 'active' : ''} onClick={() => setLang(l)}>{LANG_LABELS[l]}</button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
