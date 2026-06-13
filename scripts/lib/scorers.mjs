// Per-match goal scorers from TheSportsDB (free), mapped onto our seed match numbers.
// football-data.org's free tier returns no goal events, so we layer them in from here.
// Shared by the Node updater (scripts/update_results.mjs) and the Cloudflare Worker
// (worker/src/index.js) — keep it pure (global `fetch` only, no Node/Workers APIs).

import { norm, pairKey } from './map.mjs'

const TSDB_BASE = 'https://www.thesportsdb.com/api/v1/json'
const TSDB_LEAGUE = '4429' // FIFA World Cup

// Build pairKey("A vs B") -> seed match id. Group fixtures come straight from the seed;
// knockout matches only get real team names once resolved, so we also index any live
// `results` entry that already carries home/away — that covers the bracket too.
function pairIndex(seed, results) {
  const idx = new Map()
  for (const f of seed.fixtures) idx.set(pairKey(f.home, f.away), f.id)
  for (const [id, r] of Object.entries(results || {})) {
    if (r && r.home && r.away) idx.set(pairKey(r.home, r.away), Number(id))
  }
  return idx
}

async function getJSON(url, fetchImpl) {
  try {
    const res = await fetchImpl(url)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// Extract scored goals from a TheSportsDB match timeline. Team is normalized to the seed
// name so the app can assign each goal to home/away by name (orientation-proof).
function goalsFromTimeline(timeline) {
  return (timeline || [])
    .filter((t) => (t.strTimeline || '').toLowerCase() === 'goal')
    .map((t) => ({
      player: t.strPlayer || 'Unknown',
      team: norm(t.strTeam),
      minute: t.intTime != null && t.intTime !== '' ? Number(t.intTime) : null,
      assist: t.strAssist && t.strAssist !== 'NULL' ? t.strAssist : null,
      type: t.strTimelineDetail || 'Normal Goal',
    }))
    .sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999))
}

// Returns { [seedMatchId]: [ {player, team, minute, assist, type}, ... ] } for matches
// that have a posted score (finished or live-with-goals). Bounded by `maxFetches` to stay
// friendly to the free key. Never throws — returns {} on any top-level failure.
export async function fetchMatchGoals(seed, results, opts = {}) {
  const {
    fetchImpl = fetch,
    key = '3',
    season = '2026',
    maxFetches = 60,
  } = opts

  const idx = pairIndex(seed, results)
  const base = `${TSDB_BASE}/${key}`

  const seasonData = await getJSON(
    `${base}/eventsseason.php?id=${TSDB_LEAGUE}&s=${season}`,
    fetchImpl,
  )
  const events = seasonData?.events || []

  // Only fetch timelines for matches that have actually produced a score, and that we can
  // map onto a seed match. Skip 0-0 / not-started events — nothing to show.
  const todo = []
  for (const ev of events) {
    if (ev.intHomeScore == null || ev.intHomeScore === '') continue
    const id = idx.get(pairKey(ev.strHomeTeam, ev.strAwayTeam))
    if (id == null) continue
    todo.push({ id, eventId: ev.idEvent })
  }

  const out = {}
  let budget = maxFetches
  for (const { id, eventId } of todo) {
    if (budget <= 0) break
    budget--
    const tl = await getJSON(`${base}/lookuptimeline.php?id=${eventId}`, fetchImpl)
    const goals = goalsFromTimeline(tl?.timeline)
    if (goals.length) out[id] = goals
  }
  return out
}
