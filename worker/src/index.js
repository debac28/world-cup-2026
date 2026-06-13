// Cloudflare Worker: the live backend for the World Cup app.
//
//  GET /live  (fetch handler) — returns fresh scores + scorers from football-data.org,
//             mapped onto our fixtures (shared scripts/lib/map.mjs), with highlight
//             links merged in from KV. Cached ~60s via the Cache API, so football-data
//             is hit at most ~once/minute regardless of traffic. CORS enabled.
//
//  cron       (scheduled handler) — hourly: searches YouTube for finished matches still
//             missing a US highlight and stores them in KV. This replaces GitHub's
//             unreliable scheduler, so highlights appear automatically.
//
// Bindings/secrets (see wrangler.toml + `wrangler secret put`):
//   FOOTBALL_DATA_TOKEN, YOUTUBE_API_KEY (secrets); KV (namespace); BASE_LIVE_URL (var).

import seed from '../../public/data/seed.json'
import { buildResults, norm } from '../../scripts/lib/map.mjs'
import { youtubeHighlight, matchesNeedingHighlights } from '../../scripts/lib/highlights.mjs'
import { fetchMatchGoals } from '../../scripts/lib/scorers.mjs'

const FD_BASE = 'https://api.football-data.org/v4'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
const CACHE_SECONDS = 60
const HL_KEY = 'highlights' // KV: { [matchId]: { US: {...} } }
const GOALS_KEY = 'goals' // KV: { [matchId]: [ {player, team, minute, pen, og}, ... ] }
const HL_BUDGET = 4 // YouTube searches per cron run (100 units each / 10k daily)
const HL_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })

    const cache = caches.default
    const cacheKey = new Request(new URL('/live', request.url).toString())
    const cached = await cache.match(cacheKey)
    if (cached) return withCors(cached)

    const payload = await buildPayload(env)
    const res = new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
        ...CORS,
      },
    })
    ctx.waitUntil(cache.put(cacheKey, res.clone()))
    return res
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshHighlights(env))
    ctx.waitUntil(refreshGoals(env))
  },
}

function withCors(res) {
  const r = new Response(res.body, res)
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v)
  return r
}

async function fetchJSON(url, init) {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  return res.json()
}

const fdHeaders = (env) => ({ 'X-Auth-Token': env.FOOTBALL_DATA_TOKEN })
const compQuery = (env) => {
  const comp = env.FOOTBALL_DATA_COMP || 'WC'
  const season = env.FOOTBALL_DATA_SEASON ? `&season=${env.FOOTBALL_DATA_SEASON}` : ''
  return { comp, season }
}

async function fdMatches(env) {
  const { comp, season } = compQuery(env)
  const q = season ? `?${season.slice(1)}` : ''
  const data = await fetchJSON(`${FD_BASE}/competitions/${comp}/matches${q}`, {
    headers: fdHeaders(env),
  })
  return data.matches || []
}

async function fdScorers(env) {
  const { comp, season } = compQuery(env)
  const data = await fetchJSON(
    `${FD_BASE}/competitions/${comp}/scorers?limit=30${season}`,
    { headers: fdHeaders(env) },
  )
  return (data.scorers || [])
    .map((s) => ({ player: s.player?.name, team: norm(s.team?.name), goals: s.goals ?? 0 }))
    .filter((s) => s.player && s.goals > 0)
}

async function readHighlights(env) {
  if (!env.KV) return {}
  try {
    return JSON.parse((await env.KV.get(HL_KEY)) || '{}')
  } catch {
    return {}
  }
}

async function readGoals(env) {
  if (!env.KV) return {}
  try {
    return JSON.parse((await env.KV.get(GOALS_KEY)) || '{}')
  } catch {
    return {}
  }
}

async function buildPayload(env) {
  let results = {}
  let scorers = []

  if (env.FOOTBALL_DATA_TOKEN) {
    try {
      results = buildResults(seed, await fdMatches(env))
    } catch (e) {
      console.log('matches fetch failed:', e.message)
    }
    try {
      scorers = await fdScorers(env)
    } catch (e) {
      console.log('scorers fetch failed:', e.message)
    }
  }

  // Fallback to the GitHub-committed base if football-data is unavailable.
  if (!Object.keys(results).length && env.BASE_LIVE_URL) {
    const base = await fetchJSON(env.BASE_LIVE_URL).catch(() => null)
    if (base) {
      results = base.results || {}
      if (!scorers.length) scorers = base.scorers || []
    }
  }

  // Merge highlight links from KV.
  const map = await readHighlights(env)
  for (const [id, r] of Object.entries(results)) {
    if (map[id]) r.highlights = map[id]
  }

  // Merge per-match goal scorers from KV (populated by the scheduled Wikipedia refresh).
  const goalsMap = await readGoals(env)
  for (const [id, r] of Object.entries(results)) {
    if (goalsMap[id]) r.goals = goalsMap[id]
  }

  return {
    updated: new Date().toISOString(),
    source: 'cloudflare-worker',
    results,
    scorers,
  }
}

// Hourly: find US highlight videos for finished matches that don't have one yet.
async function refreshHighlights(env) {
  if (!env.KV || !env.YOUTUBE_API_KEY || !env.FOOTBALL_DATA_TOKEN) {
    console.log('refreshHighlights: missing KV / YOUTUBE_API_KEY / token — skipping.')
    return
  }
  let results
  try {
    results = buildResults(seed, await fdMatches(env))
  } catch (e) {
    console.log('refreshHighlights matches failed:', e.message)
    return
  }
  const map = await readHighlights(env)
  const todo = matchesNeedingHighlights(results, map, HL_MAX_AGE_MS)
  let budget = HL_BUDGET
  let changed = false
  for (const [id, r] of todo) {
    if (budget <= 0) break
    budget--
    try {
      const h = await youtubeHighlight(r.home, r.away, 'US', env.YOUTUBE_API_KEY)
      if (h) {
        map[id] = { US: h }
        changed = true
        console.log(`highlight #${id} ${r.home} v ${r.away} -> ${h.videoId}`)
      }
    } catch (e) {
      console.log('YouTube search failed:', e.message)
      break
    }
  }
  if (changed) await env.KV.put(HL_KEY, JSON.stringify(map))
}

// Scheduled: parse goal scorers from Wikipedia for finished matches missing them, cache in
// KV forever (a finished match never changes). The shared module validates count vs score.
async function refreshGoals(env) {
  if (!env.KV || !env.FOOTBALL_DATA_TOKEN) {
    console.log('refreshGoals: missing KV / token — skipping.')
    return
  }
  let results
  try {
    results = buildResults(seed, await fdMatches(env))
  } catch (e) {
    console.log('refreshGoals matches failed:', e.message)
    return
  }
  const have = await readGoals(env)
  let found
  try {
    found = await fetchMatchGoals(seed, results, { existingGoals: have })
  } catch (e) {
    console.log('refreshGoals Wikipedia failed:', e.message)
    return
  }
  let changed = false
  for (const [id, goals] of Object.entries(found)) {
    if (goals.length) {
      have[id] = goals
      changed = true
      console.log(`goals #${id}: ${goals.length} scorers`)
    }
  }
  if (changed) await env.KV.put(GOALS_KEY, JSON.stringify(have))
}
