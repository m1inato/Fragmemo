import { useMemo } from 'react'
import { isDark } from '../lib/theme'

// Imported Anki templates bring their own CSS and scripts. They run in a sandboxed iframe with an
// opaque origin: scripts work, but nothing inside can reach the app or window.api.

const BASE = `
html,body{margin:0;padding:0;background:transparent}
body{font:22px/1.6 -apple-system,"Hiragino Sans","PingFang SC",sans-serif;color:#1f2328;padding:24px;text-align:center}
.nightMode body,body.nightMode{color:#e6e6e6}
img{max-width:100%;height:auto}
hr#answer{border:0;border-top:1px solid rgba(127,127,127,.3);margin:20px 0}
.cloze{font-weight:600;color:#3b6ea5}
.nightMode .cloze{color:#8ab4e8}
.fm-sound{border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;border-radius:999px;width:2em;height:2em;cursor:pointer;font-size:.7em;vertical-align:middle}
`

const SCRIPT = `
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('.fm-sound');
  if (b) { e.preventDefault(); new Audio(b.dataset.src).play().catch(function () {}); }
});
`

export function CardFrame({ html, css, autoplay }: { html: string; css: string; autoplay?: boolean }) {
  const doc = useMemo(() => {
    const night = isDark() ? 'nightMode night_mode' : ''
    const play = autoplay ? `var s=document.querySelector('.fm-sound');if(s)new Audio(s.dataset.src).play().catch(function(){});` : ''
    return `<!doctype html><html class="${night}"><head><meta charset="utf-8"><style>${BASE}${css}</style></head>` +
      `<body class="card ${night}">${html}<script>${SCRIPT}${play}</script></body></html>`
  }, [html, css, autoplay])
  return <iframe className="card-frame" sandbox="allow-scripts" srcDoc={doc} title="卡片" />
}
