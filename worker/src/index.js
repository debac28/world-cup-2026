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
import poll from '../../public/data/poll.json'
import { buildResults, norm } from '../../scripts/lib/map.mjs'
import { buildEspnResults, mergeResults, ESPN_SCOREBOARD_URL } from '../../scripts/lib/espn.mjs'
import { buildFifaResults, fetchFifaMatchGoals, FIFA_MATCHES_URL, FIFA_HEADERS } from '../../scripts/lib/fifa.mjs'
import { youtubeHighlights, matchesNeedingHighlights, sanitizeHighlights, mergeClips } from '../../scripts/lib/highlights.mjs'
import { fetchMatchGoals } from '../../scripts/lib/scorers.mjs'
import { attachWikiLinks } from '../../scripts/lib/wikilinks.mjs'

const FD_BASE = 'https://api.football-data.org/v4'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
const CACHE_SECONDS = 60
const HL_KEY = 'highlights' // KV: { [matchId]: { US: [...], INTL: [...] } } (candidate arrays)
const GOALS_KEY = 'goals' // KV: { [matchId]: [ {player, team, minute, pen, og, wiki}, ... ] }
const WIKI_KEY = 'wikilinks' // KV: { [playerName]: "Article Title" | "" } ("" = verified no-article)
const WIKI_PER_RUN = 40 // Wikipedia title lookups per cron run
const HL_BUDGET = 4 // YouTube searches per hourly run (100 units each / 10k daily)
const HL_PER_REGION = 3 // candidate videos kept per region (primary + geo-block fallbacks)
const LIVE_GOALS_CAP = 8 // max in-progress matches fetched for live scorers per /live build
const HL_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000
// Nightly catch-up: one run ~30 min before YouTube's midnight-Pacific quota reset, where the
// day's leftover quota (otherwise wasted) tops up each match to FOX + a globally-playable
// (FIFA) "+1" so non-US viewers get a real clip, not just the search link. Uncapped in
// practice (the budget just bounds a runaway); we only chase the +1 for ~36h after kickoff,
// then freeze. Cron is UTC: '30 6 * * *' = 23:30 in PDT (the tournament runs Jun–Jul).
const HL_NIGHTLY_CRON = '30 6 * * *'
const HL_NIGHTLY_BUDGET = 30
const HL_GLOBAL_MAX_AGE_MS = 36 * 60 * 60 * 1000
// In-progress statuses the live-goals overlay always covers.
const LIVE_MATCH_STATUSES = new Set(['1H', '2H', 'HT', 'ET'])
// How long after kickoff a finished match stays eligible for the live-goals overlay, so a
// match that goes final between hourly cron runs still gets its scorers from FIFA directly
// (a game runs ~2h; this comfortably covers extra time + shootouts, and excludes older days).
const RECENT_FT_WINDOW_MS = 4 * 60 * 60 * 1000

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })

    if (new URL(request.url).pathname === '/poll') return handlePoll(request, env)

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
    // Hourly run: land the (US) clip fast. Nightly run: top up to a FOX + global (FIFA) pair,
    // spending the day's leftover quota right before the midnight-Pacific reset.
    const nightly = event.cron === HL_NIGHTLY_CRON
    ctx.waitUntil(
      refreshHighlights(
        env,
        nightly
          ? { budget: HL_NIGHTLY_BUDGET, target: 'global', maxAgeMs: HL_GLOBAL_MAX_AGE_MS }
          : { budget: HL_BUDGET, target: 'first', maxAgeMs: HL_MAX_AGE_MS },
      ),
    )
    // Collect goals first, then resolve Wikipedia links over the freshly-stored goals + the
    // Golden Boot list (both share one name cache, so run them in sequence to avoid a KV race).
    ctx.waitUntil(refreshGoals(env).then(() => refreshWikiLinks(env)))
  },
}

function withCors(res) {
  const r = new Response(res.body, res)
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v)
  return r
}

// "Who wins the cup?" poll — one poll per knockout stage (qf|sf|final), the app showing the
// teams alive for the next round. GET /poll?stage=… returns that stage's real votes; POST
// { choice } records one. The client adds a committed seed baseline on top, so this endpoint
// stores ONLY real votes (starts empty per stage). One-vote-per-user is enforced client-side
// (localStorage); this is just the shared counter. Choices are validated against poll.json's
// team list so a stray request can't inject arbitrary KV keys.
const POLL_STAGES = new Set(['qf', 'sf', 'final'])
const POLL_NAMES = new Set(Object.keys(poll.seed))

async function readVotes(env, stage) {
  if (!env.KV) return {}
  try {
    return JSON.parse((await env.KV.get(`poll:${stage}`)) || '{}')
  } catch {
    return {}
  }
}

async function handlePoll(request, env) {
  const stage = new URL(request.url).searchParams.get('stage')
  if (!POLL_STAGES.has(stage)) return pollJSON({ error: 'invalid stage' }, 400)
  if (request.method === 'POST') {
    const choice = await request.json().then((b) => b?.choice).catch(() => null)
    if (!POLL_NAMES.has(choice)) return pollJSON({ error: 'invalid choice' }, 400)
    const counts = await readVotes(env, stage)
    counts[choice] = (counts[choice] || 0) + 1
    // ponytail: KV read-modify-write is last-write-wins, so two simultaneous votes can lose
    // one. Fine for a fun poll; switch to a Durable Object if exact tallies ever matter.
    if (env.KV) await env.KV.put(`poll:${stage}`, JSON.stringify(counts))
    return pollJSON({ counts })
  }
  return pollJSON({ counts: await readVotes(env, stage) })
}

function pollJSON(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
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

// ESPN's free, keyless scoreboard — a fresher second source (football-data's free tier lags).
async function espnEvents() {
  const data = await fetchJSON(ESPN_SCOREBOARD_URL)
  return data.events || []
}

// FIFA's own free, keyless calendar feed — the canonical source (highest precedence).
async function fifaMatches() {
  const data = await fetchJSON(FIFA_MATCHES_URL, { headers: FIFA_HEADERS })
  return data.Results || []
}

async function fdScorers(env) {
  const { comp, season } = compQuery(env)
  const data = await fetchJSON(
    `${FD_BASE}/competitions/${comp}/scorers?limit=100${season}`,
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

async function readWiki(env) {
  if (!env.KV) return {}
  try {
    return JSON.parse((await env.KV.get(WIKI_KEY)) || '{}')
  } catch {
    return {}
  }
}

async function buildPayload(env) {
  let results = {}
  let scorers = []
  const sources = []

  if (env.FOOTBALL_DATA_TOKEN) {
    try {
      results = buildResults(seed, await fdMatches(env))
      sources.push('football-data')
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
      sources.push('github-base')
    }
  }

  // Overlay ESPN's fresher live data per match. Additive: if ESPN fails, results stand.
  try {
    results = mergeResults(results, buildEspnResults(seed, await espnEvents()))
    sources.push('espn')
  } catch (e) {
    console.log('espn merge failed:', e.message)
  }

  // Overlay FIFA last — the canonical source, so it wins live ties (FIFA > ESPN >
  // football-data). Additive: if FIFA fails or geoblocks, the prior results stand. Keep the
  // calendar around so the live-goals overlay below can reuse it (no extra fetch).
  let fifaCal = null
  try {
    fifaCal = await fifaMatches()
    results = mergeResults(results, buildFifaResults(seed, fifaCal), { preserveBreak: true })
    sources.push('fifa')
  } catch (e) {
    console.log('fifa merge failed:', e.message)
  }

  // Merge highlight links from KV, validated against this match: drop any candidate whose
  // title doesn't name both teams (a different match's clip) or whose channel is scraped junk,
  // so bad data is never served even before the hourly cron rewrites KV.
  const map = await readHighlights(env)
  for (const [id, r] of Object.entries(results)) {
    if (!map[id]) continue
    const clean = sanitizeHighlights(map[id], r.home, r.away)
    if (clean) r.highlights = clean
  }

  // Merge per-match goal scorers from KV (populated by the scheduled Wikipedia refresh).
  const goalsMap = await readGoals(env)
  for (const [id, r] of Object.entries(results)) {
    if (goalsMap[id]) r.goals = goalsMap[id]
  }

  // Live & freshly-finished scorers: KV only holds matches the hourly cron has already
  // backfilled, so fetch FIFA's per-match goal events directly for (a) in-progress matches
  // and (b) matches that have just gone final but aren't in KV yet. (b) closes the handoff
  // gap where a stoppage-time goal and full-time land in the same minute — without it,
  // scorers blink out the instant a match ends and stay blank until the next hourly cron.
  // Matches the cron has already stored are skipped (existingGoals), and the recency window
  // keeps us from re-fetching long-finished matches every build. Budget-safe: the ~60s /live
  // cache means at most ~one fetch per eligible match per minute, and LIVE_GOALS_CAP bounds a
  // single run. The completeness guard is status-aware (requireComplete), so live matches
  // still stream partial goals while a freshly finished one only shows once complete.
  if (fifaCal) {
    try {
      const now = Date.now()
      const eligible = {}
      for (const [id, r] of Object.entries(results)) {
        const isLive = LIVE_MATCH_STATUSES.has(r.status)
        const isRecentFt =
          r.status === 'FT' &&
          (!r.kickoff || now - Date.parse(r.kickoff) < RECENT_FT_WINDOW_MS)
        if (isLive || isRecentFt) eligible[id] = r
      }
      const liveGoals = await fetchFifaMatchGoals(seed, eligible, {
        calendar: fifaCal,
        statuses: ['1H', '2H', 'HT', 'ET', 'FT'],
        requireComplete: true,
        existingGoals: goalsMap,
        limit: LIVE_GOALS_CAP,
      })
      let any = false
      for (const [id, goals] of Object.entries(liveGoals)) {
        if (goals.length) {
          results[id].goals = goals
          any = true
        }
      }
      if (any) sources.push('fifa-live-goals')
    } catch (e) {
      console.log('live goals failed:', e.message)
    }
  }

  // Attach verified Wikipedia titles from the KV cache (populated hourly by refreshWikiLinks).
  // Cache-only here — no Wikipedia calls on the hot /live path. Covers the Golden Boot list
  // and any freshly-fetched live goals whose title isn't already stored on the goal.
  const wikiMap = await readWiki(env)
  if (Object.keys(wikiMap).length) {
    for (const s of scorers) if (!s.wiki && wikiMap[s.player]) s.wiki = wikiMap[s.player]
    for (const r of Object.values(results))
      for (const g of r.goals || []) if (!g.wiki && wikiMap[g.player]) g.wiki = wikiMap[g.player]
  }

  return {
    updated: new Date().toISOString(),
    source: 'cloudflare-worker',
    sources,
    results,
    scorers,
  }
}

// Find official highlight videos for finished matches and store them in KV. `target` selects
// what counts as "done": 'first' (hourly — any one clip) or 'global' (nightly — also a FIFA
// clip). New clips are MERGED into the stored entry, so the nightly run adds FIFA without
// dropping the FOX clip the hourly run already found.
async function refreshHighlights(
  env,
  { budget = HL_BUDGET, target = 'first', maxAgeMs = HL_MAX_AGE_MS } = {},
) {
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
  // Repair stored entries first (costs no quota): strip any candidate that fails validation —
  // wrong-match titles or scraped-junk channels left by an older code path. An entry left with
  // no valid US candidate is dropped so the search loop below refetches it cleanly.
  let changed = false
  for (const [id, r] of Object.entries(results)) {
    if (!map[id]) continue
    const clean = sanitizeHighlights(map[id], r.home, r.away)
    if (JSON.stringify(clean) === JSON.stringify(map[id])) continue
    if (clean) map[id] = clean
    else delete map[id]
    changed = true
  }

  const todo = matchesNeedingHighlights(results, map, { target, maxAgeMs })
  for (const [id, r] of todo) {
    if (budget <= 0) break
    try {
      // US viewers get the exact official clips (region-biased search). Everyone else gets
      // the YouTube *search* link in-app, so for them we just collect a few region-neutral
      // direct links as extras — fetched only when budget remains.
      const us = await youtubeHighlights(r.home, r.away, 'US', env.YOUTUBE_API_KEY, HL_PER_REGION)
      budget--
      let intl = []
      if (budget > 0) {
        intl = await youtubeHighlights(r.home, r.away, '', env.YOUTUBE_API_KEY, HL_PER_REGION)
        budget--
      }
      if (us.length || intl.length) {
        const prev = map[id] || {}
        const entry = {}
        const usM = mergeClips(prev.US, us, r.home, r.away, HL_PER_REGION)
        const intlM = mergeClips(prev.INTL, intl, r.home, r.away, HL_PER_REGION)
        if (usM.length) entry.US = usM
        if (intlM.length) entry.INTL = intlM
        if (JSON.stringify(entry) !== JSON.stringify(map[id])) {
          map[id] = entry
          changed = true
          console.log(`highlight #${id} ${r.home} v ${r.away} -> US:${usM.length} INTL:${intlM.length}`)
        }
      }
    } catch (e) {
      console.log('YouTube search failed:', e.message)
      break
    }
  }
  if (changed) await env.KV.put(HL_KEY, JSON.stringify(map))
}

// Scheduled: collect per-match goal scorers for finished matches and cache in KV forever (a
// finished match never changes). FIFA's structured goal events are the primary source;
// Wikipedia (scorers.mjs) is the fallback for any match FIFA didn't cover. Both validate
// goal count vs scoreline so a partial feed is never stored.
const FIFA_GOALS_PER_RUN = 20 // cap per-match FIFA calls/run (Workers subrequest budget)

async function refreshGoals(env) {
  if (!env.KV) {
    console.log('refreshGoals: missing KV — skipping.')
    return
  }
  // Base scores from football-data (if available), then overlay FIFA's canonical status/score
  // — also reused to address FIFA's per-match goal endpoint.
  let results = {}
  if (env.FOOTBALL_DATA_TOKEN) {
    try {
      results = buildResults(seed, await fdMatches(env))
    } catch (e) {
      console.log('refreshGoals fd matches failed:', e.message)
    }
  }
  let fifaCal = []
  try {
    fifaCal = await fifaMatches()
    results = mergeResults(results, buildFifaResults(seed, fifaCal), { preserveBreak: true })
  } catch (e) {
    console.log('refreshGoals FIFA overlay failed:', e.message)
  }
  if (!Object.keys(results).length) {
    console.log('refreshGoals: no results — skipping.')
    return
  }

  const have = await readGoals(env)
  const collected = {}

  // Primary: FIFA structured goal events.
  try {
    Object.assign(
      collected,
      await fetchFifaMatchGoals(seed, results, {
        existingGoals: have,
        calendar: fifaCal,
        limit: FIFA_GOALS_PER_RUN,
      }),
    )
  } catch (e) {
    console.log('refreshGoals FIFA goals failed:', e.message)
  }

  // Fallback: Wikipedia for finished matches FIFA didn't cover this run.
  try {
    const seen = { ...have, ...collected }
    Object.assign(collected, await fetchMatchGoals(seed, results, { existingGoals: seen }))
  } catch (e) {
    console.log('refreshGoals Wikipedia failed:', e.message)
  }

  let changed = false
  for (const [id, goals] of Object.entries(collected)) {
    if (goals.length) {
      have[id] = goals
      changed = true
      console.log(`goals #${id}: ${goals.length} scorers`)
    }
  }
  if (changed) await env.KV.put(GOALS_KEY, JSON.stringify(have))
}

// Scheduled: resolve VERIFIED Wikipedia article titles for goal scorers (per-match goals in
// KV) and the Golden Boot list, caching name->title in KV ("" = verified no-article) so each
// name is looked up at most once. A link is attached only when a real article exists; the app
// renders everyone else as plain text. Budget-capped per run to stay polite to Wikipedia.
async function refreshWikiLinks(env) {
  if (!env.KV) {
    console.log('refreshWikiLinks: missing KV — skipping.')
    return
  }
  const cache = await readWiki(env)
  const cacheBefore = JSON.stringify(cache)
  let budget = WIKI_PER_RUN

  // (a) Per-match goals already in KV — fill in any goal still lacking a title, persisting the
  //     enriched goals so the hot /live path serves them without any Wikipedia call.
  const goalsMap = await readGoals(env)
  const goalsBefore = JSON.stringify(goalsMap)
  const goalItems = Object.values(goalsMap).flat()
  budget -= await attachWikiLinks(goalItems, cache, { limit: budget })
  if (JSON.stringify(goalsMap) !== goalsBefore) await env.KV.put(GOALS_KEY, JSON.stringify(goalsMap))

  // (b) Golden Boot scorers — resolve their names into the cache (applied to the live list in
  //     buildPayload), using whatever budget remains.
  if (budget > 0 && env.FOOTBALL_DATA_TOKEN) {
    try {
      await attachWikiLinks(await fdScorers(env), cache, { limit: budget })
    } catch (e) {
      console.log('refreshWikiLinks scorers failed:', e.message)
    }
  }

  if (JSON.stringify(cache) !== cacheBefore) {
    await env.KV.put(WIKI_KEY, JSON.stringify(cache))
    console.log(`wikilinks: ${Object.values(cache).filter(Boolean).length}/${Object.keys(cache).length} names resolved.`)
  }
}
