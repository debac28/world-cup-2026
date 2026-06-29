// Print a compact digest of the live Worker feed dumped at argv[2]. Used by wc-live-feed.sh.
import { readFileSync } from 'node:fs'
const path = process.argv[2] || '/tmp/wc26-live.json'
const j = JSON.parse(readFileSync(path, 'utf8'))
const r = Object.entries(j.results || {})
const ago = Math.round((Date.now() - new Date(j.updated).getTime()) / 60000)
const live = r.filter(([, m]) => m.status && !['FT', 'NS'].includes(m.status))
const fin = r.filter(([, m]) => m.status === 'FT')
const pens = r.filter(([, m]) => m.homePens != null || m.awayPens != null)
const min = (m) => (m.minute ? ` ${m.minute}'` : '')
const out = []
out.push('[wc-live] FRESH live feed injected — USE THIS, not public/data/live.json (a stale fallback).')
out.push(`updated: ${j.updated} (${ago} min ago) | results:${r.length} finished:${fin.length} live:${live.length} scorers:${(j.scorers || []).length}`)
out.push(`Full JSON at ${path} — read it for any match detail or per-match goals.`)
if (live.length) out.push('LIVE now: ' + live.map(([id, m]) => `#${id} ${m.home} ${m.homeGoals ?? 0}-${m.awayGoals ?? 0} ${m.away} (${m.status}${min(m)})`).join(' | '))
if (pens.length) out.push('Shootouts: ' + pens.map(([id, m]) => `#${id} ${m.home} ${m.homeGoals}-${m.awayGoals} ${m.away} (pens ${m.homePens}-${m.awayPens})`).join(' | '))
const ts = (j.scorers || []).slice(0, 10).map((s) => `${s.player} ${s.goals}${s.team ? ' (' + s.team + ')' : ''}`)
if (ts.length) out.push('Top scorers: ' + ts.join(', '))
console.log(out.join('\n'))
