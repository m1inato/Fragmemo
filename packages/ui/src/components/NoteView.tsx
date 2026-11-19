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

export function AnswerView({ note }: { note: Standard }) {
  switch (note.type) {
    case 'word':
      return <WordAnswer note={note} />
    case 'sentence':
      return <SentenceAnswer note={note} />
    case 'grammar':
      return <GrammarAnswer note={note} />
  }
}

function WordAnswer({ note }: { note: WordNote }) {
  const f = note.fields
  return (
    <div className="answer">
      <div className="answer-head">
        <span className="answer-term">{f.term}</span>
        {f.reading && f.reading !== f.term && <span className="answer-reading">{f.reading}</span>}
        {f.pos && <span className="chip">{f.pos}</span>}
      </div>
      <p className="answer-meaning">{f.meaning}</p>
      <Examples items={f.examples} />
      {f.notes && <p className="answer-notes">{f.notes}</p>}
      {!!f.confusables?.length && <p className="answer-confusables">易混：{f.confusables.join('、')}</p>}
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
      <Examples items={f.examples} />
    </div>
  )
}

function Examples({ items }: { items?: Example[] }) {
  if (!items?.length) return null
  return (
    <ul className="examples">
      {items.map((e, i) => (
        <li key={i}>
          <span className="example-text">{e.text}</span>
          <span className="example-translation">{e.translation}</span>
        </li>
      ))}
    </ul>
  )
}
