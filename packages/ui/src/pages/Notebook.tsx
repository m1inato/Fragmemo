import { Popup, PopupOption } from '../components/Popup'
import { useRef, useState } from 'react'
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TableKit } from '@tiptap/extension-table'
import { Image } from '@tiptap/extension-image'
import { Mathematics } from '@tiptap/extension-mathematics'
import 'katex/dist/katex.min.css'
import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { useToast } from '../components/Toast'

type Props = { root: string; deckId?: string; title: string }

export function Notebook(props: Props) {
  const { data, error, reload } = useAsync(async () => {
    const saved = await api.readNotebook(props.root, props.deckId)
    return saved ? JSON.parse(saved) as JSONContent : null
  }, [props.root, props.deckId])
  if (error) return <p role="alert">{error.message} <button className="link" onClick={reload}>重试</button></p>
  if (data === undefined) return <p className="muted">正在打开笔记…</p>
  return <Writer {...props} initial={data} />
}

function Writer({ root, deckId, title, initial }: Props & { initial: JSONContent | null }) {
  const toast = useToast()
  const insertButton = useRef<HTMLButtonElement>(null)
  const [formula, setFormula] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const revision = useRef(0)
  const picker = useRef<HTMLInputElement>(null)
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), Markdown, TableKit, Image.configure({ allowBase64: true }), Mathematics],
    content: initial ?? undefined,
    editorProps: { attributes: { 'aria-label': '笔记正文', role: 'textbox', 'aria-multiline': 'true' },
      handleKeyDown: (view, event) => {
        if (event.key === '/' && !event.isComposing && !view.state.selection.$from.parent.textContent) { insertButton.current?.click(); return true }
        return false
      }
    },
    onUpdate: ({ editor }) => {
      const seq = ++revision.current
      setStatus('保存中…')
      api.writeNotebook(root, deckId, JSON.stringify(editor.getJSON())).then(
        () => { if (revision.current === seq) setStatus('已保存') },
        () => { if (revision.current === seq) setStatus('保存失败，请导出副本') })
    }
  })
  if (!editor) return null
  const chain = () => editor.chain().focus()
  const blocks: [string, () => unknown][] = [
    ['正文', () => chain().setParagraph().run()], ['标题', () => chain().toggleHeading({ level: 2 }).run()],
    ['列表', () => chain().toggleBulletList().run()], ['编号列表', () => chain().toggleOrderedList().run()],
    ['引用', () => chain().toggleBlockquote().run()], ['表格', () => chain().insertTable({ rows: 3, cols: 2 }).run()],
    ['公式', () => setFormula('')], ['图片', () => picker.current?.click()]
  ]
  function exportNote() {
    const url = URL.createObjectURL(new Blob([editor!.getMarkdown()], { type: 'text/markdown' }))
    const a = document.createElement('a')
    a.href = url
    a.download = title + '.md'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="notebook">
    <div className="note-chrome"><header><h2>{title}</h2><span className="faint">{status}</span></header>
    <div className="note-bar">
      <Popup label="插入笔记内容" value="插入" triggerRef={insertButton}>
        {dismiss => <div className="popup-options">{blocks.map(([name, act]) => <PopupOption key={name} label={name}
          onClick={() => { dismiss(); act() }} />)}</div>}
      </Popup>
      <button title="粗体" onClick={() => chain().toggleBold().run()}><b>B</b></button>
      <button title="斜体" onClick={() => chain().toggleItalic().run()}><i>I</i></button>
      <button onClick={exportNote} title="导出 Markdown">导出</button>
    </div>
    {formula !== null && <form onSubmit={e => { e.preventDefault(); if (formula.trim()) chain().insertBlockMath({ latex: formula }).run(); setFormula(null) }}>
      <input aria-label="LaTeX 公式" placeholder="LaTeX 公式" value={formula} autoFocus onChange={e => setFormula(e.target.value)} /><button>插入</button><button type="button" onClick={() => setFormula(null)}>取消</button>
    </form>}
    </div>
    <input type="file" hidden ref={picker} accept="image/png,image/jpeg,image/webp,image/gif" onChange={async e => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => { if (!editor.isDestroyed) chain().setImage({ src: String(reader.result), alt: file.name }).run() }
      reader.onerror = () => toast.show('图片读取失败', 'error')
      reader.readAsDataURL(file)
    }} />
    <EditorContent editor={editor} />
  </section>
}
