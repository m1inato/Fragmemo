import { useState } from 'react'
import { Icon } from '../components/Icon'
import { DeckList } from './Home'
import { api } from '../lib/api'
import { useAsync } from '../lib/useAsync'
import { useShell } from '../lib/shell'

export function Activity() {
  const { version, go, langs, openGenerate } = useShell()
  const [prompt, setPrompt] = useState('')
  const { data, error, reload } = useAsync(() => api.studyActivity(), [version])
  const days = data?.days ?? []
  const total = days.reduce((sum, day) => sum + day.count, 0)
  const peak = Math.max(1, ...days.map(day => day.count))
  return <div className="page"><div className="page-scroll"><main className="page-inner activity">
    <header className="hero shelf-heading"><div><h1>词汇书架</h1>
      <p className="stats"><span>共 <b>{langs?.reduce((n, l) => n + l.decks.length, 0) ?? 0}</b> 个卡组</span>
      <span>已学 <b>{langs?.reduce((n, l) => n + l.learned, 0) ?? 0}</b> 张</span></p></div>
    </header>
    <form className="card shelf-entry" onSubmit={e => { e.preventDefault(); if (prompt.trim()) openGenerate({ request: prompt.trim() }) }}>
      <label className="shelf-input"><Icon name="sparkles" /><input className="bare" aria-label="制卡主题" placeholder="输入要学习的词或主题…" value={prompt} onChange={e => setPrompt(e.target.value)} /></label>
      <button className="button button-primary" disabled={!prompt.trim()}>AI 制卡</button>
      <button type="button" className="button" onClick={() => go({ name: 'import' })}><Icon name="file" />导入词组</button>
    </form>
    <DeckList />
    {error ? <p role="alert">{error.message} <button className="link" onClick={reload}>重试</button></p> : !data ? <p>正在读取学习记录…</p> : <>
      <div className="shelf-journal"><section className="activity-section">
        <header><h2>近七天</h2><span className="muted">复习 <b>{total}</b> 次 · 学习 {days.filter(day => day.count > 0).length} 天</span></header>
        <div className="activity-chart" aria-label="近七天每日复习次数">
          {days.map(({ date, count }, i) => <div key={date} className="activity-day" title={date + ' · ' + count + ' 次'}>
            <div className="activity-track"><span>{count || ''}</span><i style={{ height: (count / peak * 70) + 'px' }} /></div>
            <small>{i === 6 ? '今天' : date.slice(5).replace('-', '/')}</small>
          </div>)}
        </div>
      </section>
      <section className="activity-section"><header><h2>最近学过的词</h2></header>
        {data.recent.length ? data.recent.map(item => <button key={item.id} className="activity-word" onClick={() => go({ name: 'deck', deckId: item.deckId })}>
          <strong>{item.term}</strong><span>{item.deckName}</span><time>{new Date(item.at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</time>
        </button>) : <p className="muted">复习过的词会出现在这里。 <button className="link" onClick={() => go({ name: 'home' })}>去今天复习</button></p>}
      </section></div>
    </>}
  </main></div></div>
}
