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

import { norm, pairKey, matchKnockoutByKickoff } from './map.mjs'

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

// Undefined (not []) for an empty list so JSON.stringify drops the key — keeps live.json lean
// and lets mergeResults' `!= null` carry-through treat "no reds" as "don't overwrite".
const reds = (arr) => (arr && arr.length ? arr : undefined)

// Sending-offs from the scoreboard play list. ESPN labels a dismissal "Red Card" (straight)
// or "Yellow Red Card" (second yellow) — both contain "Red Card", so one test catches both.
// Returns [{ name, min }] split by team id. ESPN carries these live in the scoreboard feed
// itself (no per-match summary call needed), so a red card shows on the ~60s /live cadence.
function readReds(comp, homeId, awayId) {
  const home = []
  const away = []
  for (const d of comp.details || []) {
    if (!(d?.type?.text || '').includes('Red Card')) continue
    const entry = { name: d.athletesInvolved?.[0]?.displayName || '', min: d.clock?.displayValue || '' }
    const tid = d.team?.id == null ? null : String(d.team.id)
    if (tid && tid === String(homeId)) home.push(entry)
    else if (tid && tid === String(awayId)) away.push(entry)
  }
  return { home, away }
}

// Pull the two teams + goals (+ red cards) out of an ESPN event, oriented home/away.
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
  const r = readReds(comp, homeC.team?.id, awayC.team?.id)
  return {
    home,
    away,
    homeGoals: num(homeC.score),
    awayGoals: num(awayC.score),
    status: espnStatusShort(type.state, type.name),
    kickoff: ev.date || comp.date || null,
    redHome: r.home,
    redAway: r.away,
    // ESPN event id — the key for the on-demand per-match summary (lineups + stats) the app
    // fetches client-side. Carried through so the browser needn't re-resolve it by date.
    espnId: ev.id != null ? String(ev.id) : null,
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
        redHome: reds(sameOrder ? e.redHome : e.redAway),
        redAway: reds(sameOrder ? e.redAway : e.redHome),
        espnId: e.espnId,
      }
      continue
    }

    knockoutCandidates.push({ ...e, date: e.kickoff ? new Date(e.kickoff).getTime() : null })
  }

  // Knockout: globally assign ESPN events to seed slots by nearest kickoff (see helper).
  for (const [id, best] of matchKnockoutByKickoff(seed, knockoutCandidates)) {
    results[id] = {
      home: best.home,
      away: best.away,
      homeGoals: best.homeGoals,
      awayGoals: best.awayGoals,
      status: best.status,
      kickoff: best.kickoff,
      redHome: reds(best.redHome),
      redAway: reds(best.redAway),
      espnId: best.espnId,
    }
  }

  return results
}

const hasGoals = (r) => r && r.homeGoals != null && r.awayGoals != null

// Paused states where the clock isn't running: half-time and the break between extra-time
// halves. Some sources (FIFA's calendar) can't report these and emit a plain live half
// instead — `preserveBreak` stops such a source from erasing a break a better source detected.
const BREAK_STATUSES = new Set(['HT', 'BT'])

// Overlay `overlay` onto `base`, keeping whichever source is further along per match. Returns
// a new map; base entries not present in overlay are untouched. When overlay wins, only the
// score/status/kickoff fields overwrite — base-only keys (highlights, goals, pens, reds) are kept.
//
// `preserveBreak` (used when merging the FIFA layer, which can't express half-time): if the
// base already shows a break (HT/BT) and this overlay reports a plain live half, take the
// overlay's score but KEEP the break status and its paused, minute-less clock — otherwise the
// app would flip "Half-time" back to a running "LIVE" with no minute.
export function mergeResults(base, overlay, { preserveBreak = false } = {}) {
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
    else takeOverlay = hasGoals(ov) // NS/FT tie: a complete overlay wins (corrections + precedence)
    if (!takeOverlay) continue
    const keepBreak =
      preserveBreak && BREAK_STATUSES.has(cur.status) && !BREAK_STATUSES.has(ov.status)
    merged[id] = {
      ...cur,
      home: ov.home ?? cur.home,
      away: ov.away ?? cur.away,
      homeGoals: ov.homeGoals,
      awayGoals: ov.awayGoals,
      status: keepBreak ? cur.status : ov.status,
      kickoff: ov.kickoff ?? cur.kickoff,
      // Live minute only comes from FIFA; carry it when the overlay wins, drop it otherwise
      // (a finished/non-FIFA winner, or a preserved break, has no running minute to show).
      ...(!keepBreak && ov.minute != null ? { minute: ov.minute } : { minute: undefined }),
      ...(ov.homePens != null ? { homePens: ov.homePens } : {}),
      ...(ov.awayPens != null ? { awayPens: ov.awayPens } : {}),
      // Red cards only come from ESPN's live feed; carry them when this overlay has them, else
      // `...cur` keeps any the ESPN layer already added (e.g. when FIFA wins a later live tie).
      ...(ov.redHome != null ? { redHome: ov.redHome } : {}),
      ...(ov.redAway != null ? { redAway: ov.redAway } : {}),
      // ESPN event id: only the ESPN overlay carries it; `...cur` preserves it when a
      // later, id-less source (FIFA/football-data) wins a live tie.
      ...(ov.espnId != null ? { espnId: ov.espnId } : {}),
    }
  }
  return merged
}
