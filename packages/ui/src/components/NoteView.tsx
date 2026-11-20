import type { Example, GrammarNote, Note, SentenceNote, WordNote } from '@fragmemo/core'

// How standard notes look on a review card: the prompt for each face, and the full answer.

type Standard = Exclude<Note, { type: 'raw' }>

export function Prompt({ note, face, hideText }: { note: Standard; face: number; hideText?: boolean }) {
  if (hideText) return null
  switch (note.type) {
    case 'word':
      return face === 0 ? <p className="prompt-term">{note.fields.term}</p> : <p className="prompt-meaning">{note.fields.meaning}</p>
    case 'sentence':
      return face === 0 ? <p className="prompt-sentence">{note.fields.text}</p> : null
    case 'grammar':
      return face === 0 ? <p className="prompt-term">{note.fields.pattern}</p> : <FillIn note={note} />
  }
}

function FillIn({ note }: { note: GrammarNote }) {
  const core = note.fields.pattern.replace(/[〜~～]/g, '')
  const ex = note.fields.examples?.find((e) => e.text.includes(core))
  if (!ex) return <p className="prompt-meaning">{note.fields.meaning}</p>
  const [before, ...rest] = ex.text.split(core)
  return (
    <div className="prompt-fill">
      <p className="prompt-sentence">
        {before}
        <span className="blank">{'　'.repeat(Math.min(core.length, 6))}</span>
        {rest.join(core)}
      </p>
      <p className="prompt-hint">{ex.translation}</p>
    </div>
  )
}

/** `showTerm` is false when the prompt already shows the headword in full. */
export function AnswerView({ note, showTerm = true }: { note: Standard; face?: number; showTerm?: boolean }) {
  switch (note.type) {
    case 'word':
      return <WordAnswer note={note} showTerm={showTerm} />
    case 'sentence':
      return <SentenceAnswer note={note} />
    case 'grammar':
      return <GrammarAnswer note={note} />
  }
}

function WordAnswer({ note, showTerm }: { note: WordNote; showTerm: boolean }) {
  const f = note.fields
  const reading = f.reading && f.reading !== f.term ? f.reading : ''
  return (
    <div className="answer">
      <div className="answer-head">
        {showTerm && <span className="answer-term">{f.term}</span>}
        {reading && <span className={showTerm ? 'answer-reading' : 'answer-reading answer-reading-lead'}>{reading}</span>}
        {f.pos && <span className="chip">{f.pos}</span>}
      </div>
      <p className="answer-meaning">{f.meaning}</p>
      <Examples items={f.examples} term={f.term} />
      {(f.notes || !!f.confusables?.length) && (
        <div className="answer-extra">
          {f.notes && <p className="answer-notes">{f.notes}</p>}
          {!!f.confusables?.length && (
            <p className="answer-confusables">
              <span>易混</span>
              {f.confusables.map((c) => <span key={c} className="chip">{c}</span>)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function SentenceAnswer({ note }: { note: SentenceNote }) {
  const f = note.fields
  return (
    <div className="answer">
      <p className="answer-sentence">{f.text}</p>
      {f.reading && <p className="answer-reading">{f.reading}</p>}
      <p className="answer-meaning">{f.translation}</p>
      {!!f.grammar?.length && (
        <p className="answer-tags">
          {f.grammar.map((g) => <span key={g} className="chip">{g}</span>)}
        </p>
      )}
    </div>
  )
}

function GrammarAnswer({ note }: { note: GrammarNote }) {
  const f = note.fields
  return (
    <div className="answer">
      <div className="answer-head">
        <span className="answer-term">{f.pattern}</span>
        {f.connection && <span className="chip">{f.connection}</span>}
      </div>
      <p className="answer-meaning">{f.meaning}</p>
      {f.nuance && <p className="answer-notes">{f.nuance}</p>}
      <Examples items={f.examples} term={f.pattern.replace(/[〜~～]/g, '')} />
    </div>
  )
}

function Examples({ items, term }: { items?: Example[]; term?: string }) {
  if (!items?.length) return null
  return (
    <ul className="examples">
      {items.map((e, i) => (
        <li key={i}>
          <span className="example-text"><Marked text={e.text} term={term} /></span>
          <span className="example-translation">{e.translation}</span>
        </li>
      ))}
    </ul>
  )
}

/** The headword inside an example, also when inflected: 嬉しい marks 嬉し in 嬉しかった. */
function Marked({ text, term }: { text: string; term?: string }) {
  if (!term) return text
  const stems = [term, term.length > 2 ? term.slice(0, -1) : ''].filter(Boolean)
  for (const stem of stems) {
    const at = text.toLowerCase().indexOf(stem.toLowerCase())
    if (at < 0) continue
    // English inflections are letters on the end; Japanese ones are too ambiguous, so only the stem is marked.
    let end = at + stem.length
    while (end < text.length && end - at < stem.length + 3 && /[a-z]/i.test(text[end])) end++
    return <>{text.slice(0, at)}<mark>{text.slice(at, end)}</mark>{text.slice(end)}</>
  }
  return text
}
