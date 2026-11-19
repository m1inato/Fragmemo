import type { Lang } from '@fragmemo/core'
import { useState } from 'react'
import { Modal } from '../components/Modal'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { LANG_LABELS } from '../lib/format'

export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (deckId: string) => void }) {
  const toast = useToast()
  const [withHistory, setWithHistory] = useState(true)
  async function run() {
    const res = await toast
      .track(api.importApkg({ withHistory }), {
        pending: '正在导入…',
        done: (r) => (r ? `导入完成：新增 ${r.added} 条，更新 ${r.updated} 条` : null)
      })
      .catch(() => null)
    if (res) {
      onClose()
      onImported(res.deck.id)
    }
  }
  return (
    <Modal
      title="导入 Anki 卡包"
      onClose={onClose}
      footer={
        <>
          <button className="button" onClick={onClose}>取消</button>
          <button className="button button-primary" onClick={run}>选择 .apkg 文件</button>
        </>
      }
    >
      <p className="modal-text">支持新旧两种 .apkg / .colpkg 格式。卡片按原模板显示，图片和音频一并导入；同一个卡包再导入一次会更新原卡组，不会重复。</p>
      <label className="check">
        <input type="checkbox" checked={withHistory} onChange={(e) => setWithHistory(e.target.checked)} />
        同时导入复习记录（卡包需包含学习进度）
      </label>
    </Modal>
  )
}

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
