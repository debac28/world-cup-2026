// Per-match goal scorers parsed from Wikipedia's WC2026 match articles. The football-data
// and TheSportsDB free tiers don't give complete goal events; Wikipedia does, and it's free
// (no key, no quota). We only fetch goals for FINISHED matches and only accept them when the
// parsed goal count matches the known scoreline — so a half-edited article never shows a
// partial list. Callers cache the result permanently (a finished match never changes).
//
// Shared by the Node updater (scripts/update_results.mjs) and the Cloudflare Worker
// (worker/src/index.js) — keep it pure (global `fetch` only, no Node/Workers APIs).

import { norm, pairKey } from './map.mjs'

const WIKI_API = 'https://en.wikipedia.org/w/api.php'
const UA = 'worldcup26-pwa/1.0 (https://debac28.github.io/world-cup-2026/)'
const GROUP_ARTICLE = (g) => `2026 FIFA World Cup Group ${g}`
const KNOCKOUT_ARTICLE = '2026 FIFA World Cup knockout stage'

// --- wikitext parsing -------------------------------------------------------

// Each match is a `{{#invoke:football box|main ...}}`; return the inner bodies.
function findBoxes(wt) {
  const boxes = []
  let i = 0
  while ((i = wt.indexOf('{{#invoke:football box', i)) >= 0) {
    let d = 0
    let end = i
    for (let k = i; k < wt.length; k++) {
      if (wt[k] === '{' && wt[k + 1] === '{') { d++; k++ }
      else if (wt[k] === '}' && wt[k + 1] === '}') { d--; k++; if (d === 0) { end = k + 1; break } }
    }
    boxes.push(wt.slice(i + 2, end - 2)) // strip outer {{ }} so params sit at depth 0
    i = end
  }
  return boxes
}

// Split a template body on top-level `|` (ignoring `|` inside nested {{ }} / [[ ]]).
function splitParams(s) {
  const out = []
  let buf = ''
  let d = 0
  for (let i = 0; i < s.length; i++) {
    const a = s[i]
    const b = s[i + 1]
    if ((a === '{' && b === '{') || (a === '[' && b === '[')) { d++; buf += a + b; i++ }
    else if ((a === '}' && b === '}') || (a === ']' && b === ']')) { d--; buf += a + b; i++ }
    else if (a === '|' && d === 0) { out.push(buf); buf = '' }
    else buf += a
  }
  out.push(buf)
  return out
}

function param(parts, name) {
  for (const p of parts) {
    const m = p.match(new RegExp(`^\\s*${name}\\s*=([\\s\\S]*)$`))
    if (m) return m[1].trim()
  }
  return null
}

// Parse a goals block into [{player, minute, pen, og, wiki}]. Wikipedia editors mix two styles:
// `{{goal|67}}` templates and plain `31', 45+5'` text; lines may or may not be bulleted.
// `minute` is kept as a string to preserve stoppage time (e.g. "45+5").
function parseGoals(block) {
  if (!block) return []
  const clean = block.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '').replace(/<ref[^>]*\/>/gi, '')
  const out = []
  for (const line of clean.split('\n')) {
    if (!line.includes('[[')) continue
    const nm = line.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/)
    const player = nm ? (nm[2] || nm[1]).trim() : 'Unknown'
    // The `[[Article|Display]]` link target is an exact Wikipedia article title — a free,
    // never-404 player link. Keep it (display name may be a nickname) so the app can link.
    const wiki = nm ? nm[1].trim() : null
    const og = /o\.g\.|own goal/i.test(line)
    const pen = /\(pen/i.test(line)
    const mins = []
    const tmpl = [...line.matchAll(/\{\{\s*goal\s*\|([^}]*)\}\}/gi)]
    if (tmpl.length) {
      for (const gm of tmpl) for (const part of gm[1].split('|')) {
        const m = part.match(/\d+(?:\+\d+)?/)
        if (m) mins.push(m[0])
      }
    } else {
      for (const mm of line.matchAll(/(\d+(?:\+\d+)?)\s*['’]/g)) mins.push(mm[1])
    }
    for (const minute of mins) out.push({ player, minute, pen, og, wiki })
  }
  return out
}

// Parse one article's wikitext -> Map pairKey -> { team1, team2, goals1, goals2 }.
function parseArticle(wt) {
  const byPair = new Map()
  for (const body of findBoxes(wt)) {
    const parts = splitParams(body)
    const score = param(parts, 'score') || ''
    const anchor = (score.match(/#([^|\]]+)/) || [])[1]
    if (!anchor || !/ vs /.test(anchor)) continue // unplayed boxes anchor to "Match NN"
    const [t1, t2] = anchor.split(' vs ').map((s) => norm(s.trim()))
    byPair.set(pairKey(t1, t2), {
      team1: t1,
      team2: t2,
      goals1: parseGoals(param(parts, 'goals1')),
      goals2: parseGoals(param(parts, 'goals2')),
    })
  }
  return byPair
}

// --- public API -------------------------------------------------------------

function groupIndex(seed) {
  const m = new Map()
  for (const [letter, teams] of Object.entries(seed.groups || {})) {
    for (const t of teams) m.set(norm(t), letter)
  }
  return m
}

async function fetchArticle(title, fetchImpl) {
  const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2`
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } })
    if (!res.ok) return null
    const data = await res.json()
    return data?.parse?.wikitext || null
  } catch {
    return null
  }
}

// Returns { [seedMatchId]: [{player, team, minute, pen, og, wiki}] } for finished matches.
// Only matches whose parsed goal count equals their scoreline are included. `existingGoals`
// (a {id: goals} map) is skipped so already-known matches aren't refetched.
export async function fetchMatchGoals(seed, results, opts = {}) {
  const { fetchImpl = fetch, existingGoals = {} } = opts
  const groupOf = groupIndex(seed)

  // Finished matches still missing goals, grouped by the article that holds them.
  const articles = new Map() // title -> [{id, r}]
  for (const [id, r] of Object.entries(results)) {
    if (r.status !== 'FT' || !r.home || !r.away) continue
    if (existingGoals[id]?.length) continue
    const title =
      r.stage === 'knockout' || !groupOf.has(norm(r.home))
        ? KNOCKOUT_ARTICLE
        : GROUP_ARTICLE(groupOf.get(norm(r.home)))
    if (!articles.has(title)) articles.set(title, [])
    articles.get(title).push({ id, r })
  }

  const out = {}
  for (const [title, matches] of articles) {
    const wt = await fetchArticle(title, fetchImpl)
    if (!wt) continue
    const byPair = parseArticle(wt)
    for (const { id, r } of matches) {
      const box = byPair.get(pairKey(r.home, r.away))
      if (!box) continue
      const goals = [
        ...box.goals1.map((g) => ({ ...g, team: box.team1 })),
        ...box.goals2.map((g) => ({ ...g, team: box.team2 })),
      ]
      // Integrity guard: only accept a fully-entered match.
      const expected = (r.homeGoals ?? 0) + (r.awayGoals ?? 0)
      if (goals.length !== expected) continue
      out[id] = goals
    }
  }
  return out
}
