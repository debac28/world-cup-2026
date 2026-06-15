// Pure mapping from ESPN's (free, keyless) soccer scoreboard onto our seed match numbers,
// plus a merge that overlays ESPN data onto a football-data results map. Shared by the
// Cloudflare Worker (worker/src/index.js) and the Node updater (scripts/update_results.mjs),
// so the logic lives in one place. No Node- or Workers-specific APIs — keep it pure.
//
// Why: football-data.org's free tier lags (it can report a live match as still TIMED long
// after kickoff). ESPN's scoreboard is near-real-time, so we surface whichever source is
// furthest along per match. ESPN is purely additive — if it fails, football-data stands.
//
// Endpoint: https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard
// Each event: competitions[0].status.type.{state,name} (state = pre|in|post) and
// competitions[0].competitors[] with { homeAway, team.displayName, score }.

import { norm, pairKey } from './map.mjs'

export const ESPN_SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard'

// ESPN status -> our short codes (same vocabulary as map.mjs statusShort).
export function espnStatusShort(state, name) {
  if (state === 'post') return 'FT'
  if (state === 'in') return name === 'STATUS_HALFTIME' ? 'HT' : '2H'
  return 'NS' // 'pre' or anything unexpected
}

// How "far along" a result is, for choosing the fresher source. NS < live < FT.
function statusRank(status) {
  if (status === 'FT') return 2
  if (status === 'HT' || status === '2H' || status === '1H') return 1
  return 0
}

// Pull the two teams + goals out of an ESPN event, oriented home/away.
function readEvent(ev) {
  const comp = ev?.competitions?.[0]
  if (!comp) return null
  const type = comp.status?.type || {}
  const cs = comp.competitors || []
  const homeC = cs.find((c) => c.homeAway === 'home')
  const awayC = cs.find((c) => c.homeAway === 'away')
  if (!homeC || !awayC) return null
  const home = norm(homeC.team?.displayName)
  const away = norm(awayC.team?.displayName)
  if (!home || !away) return null
  const num = (s) => (s == null || s === '' ? null : Number(s))
  return {
    home,
    away,
    homeGoals: num(homeC.score),
    awayGoals: num(awayC.score),
    status: espnStatusShort(type.state, type.name),
    kickoff: ev.date || comp.date || null,
  }
}

// Build a results map (keyed by seed match number) from ESPN scoreboard events.
// Group matches map by unordered team pair (goals oriented to seed home/away); any other
// event is treated as knockout and zipped to seed knockout slots by nearest kickoff.
export function buildEspnResults(seed, events) {
  const results = {}

  const seedGroupByPair = new Map()
  for (const f of seed.fixtures) seedGroupByPair.set(pairKey(f.home, f.away), f)

  const knockoutCandidates = []

  for (const ev of events || []) {
    const e = readEvent(ev)
    if (!e) continue

    const seedFx = seedGroupByPair.get(pairKey(e.home, e.away))
    if (seedFx) {
      const sameOrder = norm(seedFx.home) === e.home
      results[seedFx.id] = {
        home: seedFx.home,
        away: seedFx.away,
        homeGoals: sameOrder ? e.homeGoals : e.awayGoals,
        awayGoals: sameOrder ? e.awayGoals : e.homeGoals,
        status: e.status,
        kickoff: e.kickoff,
      }
      continue
    }

    knockoutCandidates.push({ ...e, date: e.kickoff ? new Date(e.kickoff).getTime() : null })
  }

  // Knockout: zip each seed slot to its nearest-kickoff ESPN event (real team names from ESPN).
  for (const ko of seed.knockout) {
    if (!ko.kickoff) continue
    const target = new Date(ko.kickoff).getTime()
    let best = null
    let bestDiff = Infinity
    for (const cand of knockoutCandidates) {
      if (cand.used || cand.date == null) continue
      const diff = Math.abs(cand.date - target)
      if (diff < bestDiff) {
        bestDiff = diff
        best = cand
      }
    }
    if (best) {
      best.used = true
      results[ko.id] = {
        home: best.home,
        away: best.away,
        homeGoals: best.homeGoals,
        awayGoals: best.awayGoals,
        status: best.status,
        kickoff: best.kickoff,
      }
    }
  }

  return results
}

const hasGoals = (r) => r && r.homeGoals != null && r.awayGoals != null

// Overlay `overlay` onto `base`, keeping whichever source is further along per match. Returns
// a new map; base entries not present in overlay are untouched. When overlay wins, only the
// score/status/kickoff fields overwrite — base-only keys (highlights, goals, pens) are kept.
export function mergeResults(base, overlay) {
  const merged = { ...base }
  for (const [id, ov] of Object.entries(overlay || {})) {
    const cur = merged[id]
    if (!cur) {
      merged[id] = ov
      continue
    }
    const rOv = statusRank(ov.status)
    const rCur = statusRank(cur.status)
    let takeOverlay
    if (rOv > rCur) takeOverlay = true
    else if (rOv < rCur) takeOverlay = false
    else if (rOv === 1) takeOverlay = true // both live -> ESPN is the fresher live source
    else takeOverlay = !hasGoals(cur) && hasGoals(ov) // NS/FT tie: only if overlay adds goals
    if (!takeOverlay) continue
    merged[id] = {
      ...cur,
      home: ov.home ?? cur.home,
      away: ov.away ?? cur.away,
      homeGoals: ov.homeGoals,
      awayGoals: ov.awayGoals,
      status: ov.status,
      kickoff: ov.kickoff ?? cur.kickoff,
      // Live minute only comes from FIFA; carry it when the overlay wins, drop it otherwise
      // (a finished/non-FIFA winner has no minute to show).
      ...(ov.minute != null ? { minute: ov.minute } : { minute: undefined }),
      ...(ov.homePens != null ? { homePens: ov.homePens } : {}),
      ...(ov.awayPens != null ? { awayPens: ov.awayPens } : {}),
    }
  }
  return merged
}
