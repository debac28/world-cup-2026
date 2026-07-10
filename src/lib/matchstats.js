// On-demand match detail — lineups + live/full team stats — from ESPN's free, keyless
// per-match summary endpoint. Fetched ONLY when a user opens a card's "Match details", so it
// stays out of live.json and the feed stays lean. ESPN sends `access-control-allow-origin: *`,
// so the browser calls it directly. Oriented onto our seed home/away by team name via `norm`.
import { norm } from '../../scripts/lib/map.mjs'

const SUMMARY = (id) =>
  `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${id}`

// Stats we surface, in display order: [espnStatName, label, isPercent].
const STAT_SPEC = [
  ['possessionPct', 'Possession', true],
  ['totalShots', 'Shots', false],
  ['shotsOnTarget', 'Shots on target', false],
  ['accuratePasses', 'Passes completed', false],
  ['passPct', 'Pass accuracy', true],
  ['foulsCommitted', 'Fouls', false],
  ['wonCorners', 'Corners', false],
  ['offsides', 'Offsides', false],
  ['yellowCards', 'Yellow cards', false],
  ['saves', 'Saves', false],
]

const cache = new Map() // espnId -> { at, data }
const LIVE_TTL = 30_000 // re-fetch a live match's stats after 30s; finished data is stable

function statMap(team) {
  const out = {}
  for (const s of team?.statistics || []) out[s.name] = s.displayValue
  return out
}

// ESPN's boxscore/roster team order is its own home/away, which may not match our seed's.
// Return the two entries [home, away] oriented to `home` (seed home name) by normalized name;
// fall back to ESPN's order if neither side matches (e.g. a missing alias).
function orient(entries, home) {
  const [a, b] = entries
  if (norm(a?.team?.displayName) === home) return [a, b]
  if (norm(b?.team?.displayName) === home) return [b, a]
  return [a, b]
}

// passPct/shotPct etc. arrive as a 0–1 fraction; possessionPct as a whole number. Render both
// as a percent, scaling the fraction forms up. isPercent stats never feed a comparison bar off
// a raw count, so scaling here keeps the label ("90%") and the bar proportion consistent.
function fmtVal(v, pct) {
  if (v == null || v === '') return null
  if (!pct) return { text: String(v), n: parseFloat(v) || 0 }
  const n = parseFloat(v)
  const whole = n <= 1 ? Math.round(n * 100) : Math.round(n)
  return { text: `${whole}%`, n: whole }
}

function readLineup(roster) {
  const players = (roster?.roster || []).map((p) => ({
    num: p.jersey || '',
    name: p.athlete?.displayName || p.athlete?.shortName || '',
    pos: p.position?.abbreviation || '',
    starter: !!p.starter,
    subbedIn: !!p.subbedIn,
    subbedOut: !!p.subbedOut,
  }))
  return {
    team: roster?.team?.displayName || '',
    formation: roster?.formation || '',
    starters: players.filter((p) => p.starter),
    subs: players.filter((p) => !p.starter && p.subbedIn), // only subs who actually came on
  }
}

function parse(json, home) {
  const [hT, aT] = orient(json?.boxscore?.teams || [], home)
  const hs = statMap(hT)
  const as = statMap(aT)
  const stats = STAT_SPEC.map(([key, label, pct]) => {
    const h = fmtVal(hs[key], pct)
    const a = fmtVal(as[key], pct)
    if (!h && !a) return null
    return { label, home: h?.text ?? '—', away: a?.text ?? '—', hn: h?.n ?? 0, an: a?.n ?? 0 }
  }).filter(Boolean)

  const [hR, aR] = orient(json?.rosters || [], home)
  return { stats, lineups: { home: readLineup(hR), away: readLineup(aR) } }
}

// Fetch + parse a match's detail. `home` is the seed home name (for orientation). Cached per
// event id; a live match re-fetches after LIVE_TTL, a finished one is served from cache forever.
export async function fetchMatchDetail(espnId, home, { live = false } = {}) {
  if (!espnId) return null
  const hit = cache.get(espnId)
  if (hit && (!live || Date.now() - hit.at < LIVE_TTL)) return hit.data
  const res = await fetch(SUMMARY(espnId))
  if (!res.ok) throw new Error(`ESPN ${res.status}`)
  const data = parse(await res.json(), home)
  cache.set(espnId, { at: Date.now(), data })
  return data
}
