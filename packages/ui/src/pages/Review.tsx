import { judgeSpelling, type AnswerMode, type Rating, type ReviewItem, type ReviewScope, type SpellVerdict } from '@fragmemo/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CardFrame } from '../components/CardFrame'
import { AnswerView, Prompt } from '../components/NoteView'
import { Icon } from '../components/Icon'
import { ThemeButton, Topbar } from '../components/Topbar'
import { errorText, useToast } from '../components/Toast'
import { api } from '../lib/api'
import { formatInterval, langHue, MODE_LABELS, RATING_LABELS } from '../lib/format'
import { useShell } from '../lib/shell'
import { speak, stop } from '../lib/speech'

/**
 * ask      → the prompt, waiting for an answer
 * revealed → answer shown; `correct` is set for auto-graded modes
 * close    → spelling was one edit off; the learner decides
 */
type Phase = { name: 'ask' } | { name: 'revealed'; correct?: boolean } | { name: 'close'; input: string }

/** One answered card in this round, for the progress line and the summary. */
interface Answered { rating: Rating; ms: number }

export function Review({ scope, title, onExit }: { scope: ReviewScope; title: string; onExit: () => void }) {
  const { mac } = useShell()
  const toast = useToast()
  const [item, setItem] = useState<ReviewItem | null | undefined>(undefined)
  const [left, setLeft] = useState({ due: 0, fresh: 0 })
  const [phase, setPhase] = useState<Phase>({ name: 'ask' })
  const [picked, setPicked] = useState<string | null>(null)
  const [answered, setAnswered] = useState<Answered[]>([])
  const shownAt = useRef(Date.now())
  const startedAt = useRef(Date.now())
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
      const ms = Date.now() - shownAt.current
      await api.answer(item.cardId, { rating, mode: item.mode, correct, durationMs: ms })
      setAnswered((xs) => [...xs, { rating, ms }])
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
    setAnswered((xs) => xs.slice(0, -1))
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
    if (!item?.accepted) return
    const verdict: SpellVerdict = judgeSpelling(item.lang, input, item.accepted)
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
      if (e.key === 'Escape' || (item === null && e.key === 'Enter')) return void exit()
      if (!item || e.target instanceof HTMLInputElement) return
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

  const done = answered.length
  const total = done + left.due + left.fresh
  const header = (
    <>
      <Topbar
        inset
        left={
          <button className="button button-ghost" onClick={exit} title="结束 (Esc)">
            <Icon name="back" />
            结束
          </button>
        }
        title={
          <>
            {title}
            {item && <span className="review-count num"> · {done} / {total}</span>}
          </>
        }
        right={
          <>
            <span className="review-left num" title="待复习 · 新卡">
              <i className="due" />{left.due}
              <i className="fresh" />{left.fresh}
            </span>
            <button className="icon-button bordered" onClick={undo} title="撤销 (⌘Z)">
              <Icon name="undo" />
            </button>
            <ThemeButton />
          </>
        }
      />
      <div className="review-progress" aria-hidden>
        <span style={{ width: `${total ? (done / total) * 100 : item === null ? 100 : 0}%` }} />
      </div>
    </>
  )
  const frame = (body: React.ReactNode) => <div className={`page review${mac ? ' is-mac-window' : ''}`}>{header}{body}</div>

  if (item === undefined) return frame(null)
  if (item === null) return frame(<Summary title={title} answered={answered} startedAt={startedAt.current} onExit={exit} />)

  const revealed = phase.name === 'revealed'
  const note = item.note

  return frame(
    <main className="review-main" lang={item.lang}>
      <div className="review-stage">
        <div className="review-paper p2" />
        <div className="review-paper p1" />
        <section key={`${item.cardId}:${item.mode}`} className={`review-card${revealed ? ' is-revealed' : ''}${note.type === 'raw' ? ' is-raw' : ''}`}>
          <header className="review-card-head">
            <span className="chip tint" style={{ '--h': langHue(item.lang) } as React.CSSProperties}>{item.deckName}</span>
            {item.faceLabel && <span className="chip">{item.faceLabel}</span>}
            {item.isNew && <span className="chip new">新卡</span>}
            <span className="spacer" />
            {item.modes.length > 1 && (
              <>
                <div className="segmented segmented-small" role="group" aria-label="作答方式">
                  {item.modes.map((m) => (
                    <button key={m} className={m === item.mode ? 'active' : ''} onClick={() => switchMode(m)}>{MODE_LABELS[m]}</button>
                  ))}
                </div>
                <button className={`icon-button review-pin${note.mode === item.mode ? ' active' : ''}`} onClick={togglePin} title={note.mode === item.mode ? '已固定作答方式，点击取消' : '固定这张卡的作答方式'}>
                  <Icon name="pin" size={15} />
                </button>
              </>
            )}
          </header>

          {note.type === 'raw' && (revealed || item.mode === 'flip') ? (
            item.raw ? <CardFrame key={`${item.cardId}-${revealed}`} html={revealed ? item.raw.back : item.raw.front} css={item.raw.css} autoplay /> : <p className="muted">找不到这张卡的模板</p>
          ) : (
            <div className="review-card-body">
              <div className="prompt">
                {note.type === 'raw' ? (
                  <p className={item.mode === 'choice' && item.face === 0 ? 'prompt-term' : 'prompt-meaning'}>{item.prompt}</p>
                ) : item.mode === 'spell' && note.type === 'word' ? (
                  <p className="prompt-meaning">{note.fields.meaning}</p>
                ) : (
                  <Prompt note={note} face={item.face} hideText={item.mode === 'listen' && !revealed} />
                )}
                {note.type !== 'raw' && (item.mode === 'listen' || item.speech || item.audioUrl) && (
                  <button className={`speaker${item.mode === 'listen' && !revealed ? ' speaker-large' : ''}`} onClick={() => play(item)} title="朗读 (R)" aria-label="朗读">
                    <Icon name="volume" size={item.mode === 'listen' && !revealed ? 30 : 16} />
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
                          {revealed && c === item.answer && <Icon name="check" size={16} />}
                          {revealed && c === picked && c !== item.answer && <Icon name="x" size={16} />}
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

              {revealed && note.type !== 'raw' && (
                <div className="answer-wrap">
                  <AnswerView note={note} face={item.face} showTerm={item.mode !== 'flip' || item.face !== 0} />
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <footer className="review-actions">
        {phase.name === 'ask' && (item.mode === 'flip' || item.mode === 'listen') && (
          <button className="button button-primary button-large reveal" onClick={reveal}>
            显示答案 <kbd>Space</kbd>
          </button>
        )}
        {revealed && phase.correct === false && (
          <div className="verdict verdict-wrong">
            <Icon name="x" />
            <span>答错了，记为「忘记」</span>
            <button className="button button-primary" onClick={() => submit(1)}>继续 <kbd>Space</kbd></button>
          </div>
        )}
        {revealed && phase.correct !== false && (
          <div className="ratings">
            {phase.correct && <span className="verdict verdict-right"><Icon name="check" />答对了，有多轻松？</span>}
            <div className="rating-row">
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
          </div>
        )}
      </footer>
      <p className="review-keys">
        <span><kbd>Space</kbd> 显示 / 良好</span>
        <span><kbd>1</kbd>–<kbd>4</kbd> 评分</span>
        <span><kbd>R</kbd> 朗读</span>
        <span><kbd>⌘Z</kbd> 撤销</span>
        <span><kbd>Esc</kbd> 结束</span>
      </p>
    </main>
  )
}

function play(item: ReviewItem) {
  speak({ lang: item.lang, text: item.speech, url: item.audioUrl })
}

function Summary({ title, answered, startedAt, onExit }: { title: string; answered: Answered[]; startedAt: number; onExit: () => void }) {
  const n = answered.length
  const counts = ([1, 2, 3, 4] as Rating[]).map((r) => answered.filter((a) => a.rating === r).length)
  const recalled = n ? Math.round(((n - counts[0]) / n) * 100) : 0
  const minutes = Math.max(1, Math.round((Date.now() - startedAt) / 60000))
  const avg = n ? Math.round(answered.reduce((s, a) => s + a.ms, 0) / n / 1000) : 0

  return (
    <main className="review-done">
      <div className="done-mark"><Icon name="check" size={30} /></div>
      <p className="eyebrow">{title}</p>
      <h1>{n ? '这一轮完成了' : '现在没有要复习的卡片'}</h1>
      {n > 0 && (
        <div className="card done-card">
          <div className="done-numbers">
            <div><b className="num">{n}</b><span>张卡</span></div>
            <div><b className="num">{recalled}%</b><span>记得</span></div>
            <div><b className="num">{minutes}</b><span>分钟</span></div>
            <div><b className="num">{avg}s</b><span>平均每张</span></div>
          </div>
          <div className="done-bar" aria-label="评分分布">
            {counts.map((c, i) => c > 0 && <span key={i} className={`rating-${i + 1}`} style={{ flex: c }} />)}
          </div>
          <div className="done-legend">
            {counts.map((c, i) => (
              <span key={i} className={`rating-${i + 1}`}><i />{RATING_LABELS[(i + 1) as Rating]} {c}</span>
            ))}
          </div>
        </div>
      )}
      <button className="button button-primary button-large" onClick={onExit}>返回 <kbd>Enter</kbd></button>
    </main>
  )
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
