import { judgeSpelling, type AnswerMode, type Rating, type ReviewItem, type ReviewScope, type SpellVerdict } from '@fragmemo/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CardFrame } from '../components/CardFrame'
import { AnswerView, Prompt } from '../components/NoteView'
import { TitleBar } from '../components/TitleBar'
import { errorText, useToast } from '../components/Toast'
import { api } from '../lib/api'
import { formatInterval, MODE_LABELS, RATING_LABELS } from '../lib/format'
import { speak, stop } from '../lib/speech'

/**
 * ask      → the prompt, waiting for an answer
 * revealed → answer shown; `correct` is set for auto-graded modes
 * close    → spelling was one edit off; the learner decides
 */
type Phase = { name: 'ask' } | { name: 'revealed'; correct?: boolean } | { name: 'close'; input: string }

export function Review({ scope, title, onExit }: { scope: ReviewScope; title: string; onExit: () => void }) {
  const toast = useToast()
  const [item, setItem] = useState<ReviewItem | null | undefined>(undefined)
  const [left, setLeft] = useState({ due: 0, fresh: 0 })
  const [phase, setPhase] = useState<Phase>({ name: 'ask' })
  const [picked, setPicked] = useState<string | null>(null)
  const [done, setDone] = useState(0)
  const shownAt = useRef(Date.now())
  const busy = useRef(false)

  const show = useCallback((next: ReviewItem | null) => {
    stop()
    setItem(next)
    setPhase({ name: 'ask' })
    setPicked(null)
    shownAt.current = Date.now()
    if (next?.mode === 'listen') play(next)
  }, [])

  const loadNext = useCallback(async () => {
    const q = await api.nextReview(scope)
    setLeft({ due: q.due, fresh: q.fresh })
    show(q.item)
  }, [scope, show])

  useEffect(() => {
    loadNext().catch((err) => toast.show(errorText(err), 'error'))
    return () => stop()
  }, [loadNext])

  async function exit() {
    stop()
    await api.finishReview().catch(() => 0)
    onExit()
  }

  async function submit(rating: Rating) {
    if (!item || busy.current) return
    busy.current = true
    try {
      const correct = phase.name === 'revealed' ? phase.correct : undefined
      await api.answer(item.cardId, { rating, mode: item.mode, correct, durationMs: Date.now() - shownAt.current })
      setDone((n) => n + 1)
      await loadNext()
    } catch (err) {
      toast.show(errorText(err), 'error')
    } finally {
      busy.current = false
    }
  }

  async function undo() {
    const back = await api.undoReview().catch(() => null)
    if (!back) return toast.show('没有可以撤销的了')
    setDone((n) => Math.max(0, n - 1))
    const q = await api.nextReview(scope)
    setLeft({ due: q.due, fresh: q.fresh })
    show(back)
  }

  async function switchMode(mode: AnswerMode) {
    if (!item || mode === item.mode) return
    show(await api.prepareReview(item.cardId, mode))
  }

  async function togglePin() {
    if (!item) return
    const pinned = item.note.mode === item.mode
    await api.pinMode(item.cardId, pinned ? null : item.mode)
    setItem({ ...item, note: { ...item.note, mode: pinned ? undefined : item.mode } })
    toast.show(pinned ? '已取消固定，按记忆程度自动选择' : `这张卡以后都用「${MODE_LABELS[item.mode]}」`)
  }

  function choose(option: string) {
    if (!item || phase.name !== 'ask') return
    setPicked(option)
    setPhase({ name: 'revealed', correct: option === item.answer })
  }

  function spell(input: string) {
    if (!item || item.note.type !== 'word') return
    const verdict: SpellVerdict = judgeSpelling(item.lang, input, [item.note.fields.term, item.note.fields.reading])
    if (verdict === 'close') return setPhase({ name: 'close', input })
    setPhase({ name: 'revealed', correct: verdict === 'correct' })
  }

  function reveal() {
    setPhase({ name: 'revealed' })
  }

  // Keyboard: Space/Enter reveals or continues, 1–4 picks an option or a rating, ⌘Z undoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        undo()
        return
      }
      if (!item || e.target instanceof HTMLInputElement) return
      if (e.key === 'Escape') return void exit()
      if (e.key === 'r') return void play(item)
      const n = Number(e.key)
      if (phase.name === 'ask') {
        if ((e.key === ' ' || e.key === 'Enter') && (item.mode === 'flip' || item.mode === 'listen')) {
          e.preventDefault()
          reveal()
        } else if (item.choices && n >= 1 && n <= item.choices.length) choose(item.choices[n - 1])
      } else if (phase.name === 'revealed') {
        if (phase.correct === false && (e.key === ' ' || e.key === 'Enter')) {
          e.preventDefault()
          submit(1)
        } else if (phase.correct !== false && n >= (phase.correct ? 2 : 1) && n <= 4) submit(n as Rating)
        else if (phase.correct === undefined && (e.key === ' ' || e.key === 'Enter')) {
          e.preventDefault()
          submit(3)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const header = (
    <TitleBar
      left={<button className="button button-ghost" onClick={exit}>← 结束</button>}
      center={<span className="titlebar-title">{title}</span>}
      right={
        <>
          <span className="review-left" title="待复习 · 新卡">{left.due} · {left.fresh} 新</span>
          <button className="icon-button" onClick={undo} title="撤销 (⌘Z)" aria-label="撤销">↶</button>
        </>
      }
    />
  )

  if (item === undefined) return <div className="page review">{header}</div>
  if (item === null) {
    return (
      <div className="page review">
        {header}
        <main className="review-done">
          <p className="eyebrow">{title}</p>
          <h1>这一轮完成了</h1>
          <p>{done ? `复习了 ${done} 张卡，明天见。` : '现在没有要复习的卡片。'}</p>
          <button className="button button-primary" onClick={exit}>返回</button>
        </main>
      </div>
    )
  }

  const revealed = phase.name === 'revealed'
  const note = item.note

  return (
    <div className="page review">
      {header}
      <main className="review-main" lang={item.lang}>
        <div className="review-meta">
          <span className="chip">{item.deckName}</span>
          {item.faceLabel && <span className="chip chip-quiet">{item.faceLabel}</span>}
          {item.isNew && <span className="chip chip-new">新</span>}
          <div className="review-modes">
            {item.modes.length > 1 && (
              <div className="segmented segmented-small">
                {item.modes.map((m) => (
                  <button key={m} className={m === item.mode ? 'active' : ''} onClick={() => switchMode(m)}>{MODE_LABELS[m]}</button>
                ))}
              </div>
            )}
            {item.modes.length > 1 && (
              <button className={`pin${note.mode === item.mode ? ' pin-on' : ''}`} onClick={togglePin} title="固定这张卡的作答模式">
                {note.mode === item.mode ? '已固定' : '固定'}
              </button>
            )}
          </div>
        </div>

        <section className={`review-card${revealed ? ' is-revealed' : ''}`}>
          {note.type === 'raw' ? (
            item.raw ? <CardFrame key={`${item.cardId}-${revealed}`} html={revealed ? item.raw.back : item.raw.front} css={item.raw.css} autoplay /> : <p className="muted">找不到这张卡的模板</p>
          ) : (
            <>
              <div className="prompt">
                {item.mode === 'spell' && note.type === 'word' ? (
                  <p className="prompt-meaning">{note.fields.meaning}</p>
                ) : (
                  <Prompt note={note} face={item.face} hideText={item.mode === 'listen' && !revealed} />
                )}
                {(item.mode === 'listen' || item.speech) && (
                  <button className={`speaker${item.mode === 'listen' && !revealed ? ' speaker-large' : ''}`} onClick={() => play(item)} title="播放 (R)" aria-label="播放">
                    ♪
                  </button>
                )}
              </div>

              {item.mode === 'choice' && item.choices && (
                <ol className="choices">
                  {item.choices.map((c, i) => {
                    const state = !revealed ? '' : c === item.answer ? ' is-answer' : c === picked ? ' is-wrong' : ' is-dim'
                    return (
                      <li key={c}>
                        <button className={`choice${state}`} onClick={() => choose(c)} disabled={revealed}>
                          <kbd>{i + 1}</kbd>
                          <span>{c}</span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              )}

              {item.mode === 'spell' && (phase.name === 'ask' || phase.name === 'close') && (
                <SpellInput key={item.cardId} onSubmit={spell} close={phase.name === 'close' ? phase.input : null}
                  onAccept={() => setPhase({ name: 'revealed', correct: true })}
                  onReject={() => setPhase({ name: 'revealed', correct: false })} />
              )}

              {revealed && (
                <div className="answer-wrap">
                  <AnswerView note={note} />
                </div>
              )}
            </>
          )}
        </section>

        <footer className="review-actions">
          {phase.name === 'ask' && (item.mode === 'flip' || item.mode === 'listen') && (
            <button className="button button-primary button-large" onClick={reveal}>
              显示答案 <kbd>Space</kbd>
            </button>
          )}
          {revealed && phase.correct === false && (
            <div className="verdict verdict-wrong">
              <span>答错了，记为「忘记」</span>
              <button className="button button-primary" onClick={() => submit(1)}>继续 <kbd>Space</kbd></button>
            </div>
          )}
          {revealed && phase.correct !== false && (
            <div className="ratings">
              {([1, 2, 3, 4] as Rating[])
                .filter((r) => !(phase.correct && r === 1))
                .map((r) => (
                  <button key={r} className={`rating rating-${r}`} onClick={() => submit(r)}>
                    <span className="rating-label">{RATING_LABELS[r]}</span>
                    <span className="rating-interval">{formatInterval(item.intervals[r])}</span>
                    <kbd>{r}</kbd>
                  </button>
                ))}
            </div>
          )}
        </footer>
      </main>
    </div>
  )
}

function play(item: ReviewItem) {
  speak({ lang: item.lang, text: item.speech, url: item.audioUrl })
}

function SpellInput({ onSubmit, close, onAccept, onReject }: {
  onSubmit: (input: string) => void
  close: string | null
  onAccept: () => void
  onReject: () => void
}) {
  const [value, setValue] = useState('')
  if (close !== null) {
    return (
      <div className="spell-close">
        <p>「{close}」差一点点。算对吗？</p>
        <div className="spell-close-actions">
          <button className="button" onClick={onReject}>算错</button>
          <button className="button button-primary" onClick={onAccept}>算对</button>
        </div>
      </div>
    )
  }
  return (
    <form className="spell" onSubmit={(e) => { e.preventDefault(); if (value.trim()) onSubmit(value) }}>
      <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="写出这个词" spellCheck={false} autoComplete="off" />
      <button className="button button-primary" type="submit" disabled={!value.trim()}>确定</button>
    </form>
  )
}
