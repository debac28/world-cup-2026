// Pure mapping from FIFA's own (free, keyless) data API onto our seed match numbers.
// Shared by the Cloudflare Worker (worker/src/index.js) and the Node updater
// (scripts/update_results.mjs), so the logic lives in one place. No Node- or
// Workers-specific APIs — keep it pure.
//
// Why: FIFA is the tournament organiser, so its feed is the canonical source — we give it
// the highest precedence (merged LAST, since mergeResults lets the last overlay win live
// ties): FIFA > ESPN > football-data. It is purely additive — if it fails, ESPN +
// football-data stand untouched.
//
// Endpoint (one call returns all 104 matches): /api/v3/calendar/matches?idCompetition=17&
// idSeason=285023. Each match carries Home/Away (with TeamName + IdCountry), HomeTeamScore/
// AwayTeamScore, Home/AwayTeamPenaltyScore, a numeric MatchStatus (1=not started, 3=live,
// 0=finished), MatchTime ("54'"), Date (UTC kickoff), and MatchNumber.
//
// NOTE on the join: FIFA exposes a MatchNumber, but it does NOT line up with this seed for
// every match (e.g. seed #31/#32 — US v Australia / Turkey v Paraguay — are swapped vs
// FIFA's official numbering). So we deliberately join the SAME way as espn.mjs: group
// matches by unordered team pair, knockout by nearest kickoff. All of FIFA's team-name
// spellings (Türkiye, Czechia, Côte d'Ivoire, Cabo Verde, IR Iran, Congo DR, USA) are
// already covered by TEAM_ALIASES in map.mjs, so norm() resolves them to seed names.

import { norm, pairKey } from './map.mjs'

export const FIFA_COMPETITION = '17' // FIFA World Cup
export const FIFA_SEASON = '285023' // 2026
export const FIFA_MATCHES_URL =
  `https://api.fifa.com/api/v3/calendar/matches?idCompetition=${FIFA_COMPETITION}` +
  `&idSeason=${FIFA_SEASON}&language=en&count=104`

// A descriptive User-Agent so FIFA's Akamai front-end treats us as a known client rather
// than an anonymous bot — the most likely way our (otherwise tiny) request volume could get
// a 403. Attach to EVERY FIFA fetch (the calendar overlay in the Worker/updater too).
export const FIFA_HEADERS = {
  'User-Agent': 'worldcup26-pwa/1.0 (+https://fifa2026.scoreit.fyi)',
  Accept: 'application/json',
}

// FIFA numeric MatchStatus -> our short codes (same vocabulary as map.mjs statusShort).
// We can't reliably detect half-time from the calendar feed, so live splits into 1H/2H by
// the elapsed minute (both rank as "live" in mergeResults, so the exact half only affects
// display).
export function fifaStatusShort(m) {
  if (m.MatchStatus === 0) return 'FT'
  if (m.MatchStatus === 3) {
    const min = parseInt(String(m.MatchTime || '').replace(/\D/g, ''), 10)
    return min && min <= 45 ? '1H' : '2H'
  }
  return 'NS' // 1 (not started) or anything unexpected
}

function teamName(t) {
  if (!t) return null
  return norm(t.TeamName?.[0]?.Description)
}

// Pull the two teams + goals out of a FIFA calendar match, oriented home/away. Returns null
// for an unresolved knockout slot (FIFA exposes PlaceHolderA/B and no Home/Away there).
// Carries IdMatch/IdStage so the per-match goals endpoint can be addressed later.
function readMatch(m) {
  const home = teamName(m.Home)
  const away = teamName(m.Away)
  if (!home || !away) return null
  return {
    home,
    away,
    homeGoals: m.HomeTeamScore ?? null,
    awayGoals: m.AwayTeamScore ?? null,
    homePens: m.HomeTeamPenaltyScore ?? null,
    awayPens: m.AwayTeamPenaltyScore ?? null,
    status: fifaStatusShort(m),
    // Elapsed minute, only while live ("87'" -> "87", "45'+2'" -> "45+2"). FIFA carries it
    // in the calendar feed, so the live match minute costs us no extra request.
    minute: m.MatchStatus === 3 ? cleanMinute(m.MatchTime) || null : null,
    kickoff: m.Date || null,
    idMatch: m.IdMatch,
    idStage: m.IdStage,
  }
}

// Join FIFA matches onto seed match numbers, returning the full readMatch payload (incl.
// idMatch/idStage and, for group matches, the matched seed fixture) per seed id. Group
// matches map by unordered team pair; any other resolved match is treated as knockout and
// zipped to seed knockout slots by nearest kickoff. Shared by buildFifaResults (scores) and
// fetchFifaMatchGoals (per-match goal events).
function joinToSeed(seed, matches) {
  const bySeedId = {}

  const seedGroupByPair = new Map()
  for (const f of seed.fixtures) seedGroupByPair.set(pairKey(f.home, f.away), f)

  const knockoutCandidates = []

  for (const m of matches || []) {
    const e = readMatch(m)
    if (!e) continue
    const seedFx = seedGroupByPair.get(pairKey(e.home, e.away))
    if (seedFx) {
      bySeedId[seedFx.id] = { ...e, seedFx }
      continue
    }
    knockoutCandidates.push({ ...e, date: e.kickoff ? new Date(e.kickoff).getTime() : null })
  }

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
      bySeedId[ko.id] = best
    }
  }

  return bySeedId
}

// Build a results map (keyed by seed match number) from FIFA's calendar matches. Group
// matches orient goals to the seed's home/away order; knockout matches carry FIFA's real
// team names. Output shape matches buildEspnResults so it feeds mergeResults unchanged.
export function buildFifaResults(seed, matches) {
  const results = {}
  for (const [id, e] of Object.entries(joinToSeed(seed, matches))) {
    if (e.seedFx) {
      const sameOrder = norm(e.seedFx.home) === e.home
      results[id] = {
        home: e.seedFx.home,
        away: e.seedFx.away,
        homeGoals: sameOrder ? e.homeGoals : e.awayGoals,
        awayGoals: sameOrder ? e.awayGoals : e.homeGoals,
        status: e.status,
        kickoff: e.kickoff,
        ...(e.minute ? { minute: e.minute } : {}),
      }
    } else {
      results[id] = {
        home: e.home,
        away: e.away,
        homeGoals: e.homeGoals,
        awayGoals: e.awayGoals,
        status: e.status,
        kickoff: e.kickoff,
        ...(e.minute ? { minute: e.minute } : {}),
        ...(e.homePens != null ? { homePens: e.homePens } : {}),
        ...(e.awayPens != null ? { awayPens: e.awayPens } : {}),
      }
    }
  }
  return results
}

// --- per-match goal scorers --------------------------------------------------
// FIFA's per-match document carries structured goal events (HomeTeam.Goals / AwayTeam.Goals),
// so we can replace the Wikipedia scrape (scorers.mjs) with a firsthand, live source.

const FIFA_LIVE_URL = (idStage, idMatch) =>
  `https://api.fifa.com/api/v3/live/football/${FIFA_COMPETITION}/${FIFA_SEASON}/${idStage}/${idMatch}?language=en`

// Goal Type enum (confirmed against the timeline text): 1 = penalty, 3 = own goal, else
// a normal goal. An own goal sits in the BENEFITING side's Goals array, and its IdPlayer is
// a player on the OTHER side — so player names are resolved across both squads.
function goalTypeFlags(type) {
  return { pen: type === 1, og: type === 3 }
}

// "90'+4'" -> "90+4", "17'" -> "17" (match the stoppage-time string shape scorers.mjs emits).
function cleanMinute(min) {
  return String(min || '').replace(/['’\s]/g, '')
}

function playerNames(doc) {
  const names = {}
  for (const side of ['HomeTeam', 'AwayTeam']) {
    for (const p of doc?.[side]?.Players || []) {
      const nm = p.PlayerName?.[0]?.Description
      if (nm) names[p.IdPlayer] = nm
    }
  }
  return names
}

// Extract [{player, team, minute, pen, og}] from a FIFA per-match document. `team` is the
// seed name of the side credited with the goal (so own goals are credited correctly).
function goalsFromMatchDoc(doc) {
  const names = playerNames(doc)
  const out = []
  for (const side of ['HomeTeam', 'AwayTeam']) {
    const team = norm(doc?.[side]?.TeamName?.[0]?.Description)
    for (const g of doc?.[side]?.Goals || []) {
      out.push({
        player: names[g.IdPlayer] || 'Unknown',
        team,
        minute: cleanMinute(g.Minute),
        ...goalTypeFlags(g.Type),
      })
    }
  }
  return out
}

// Returns { [seedMatchId]: [{player, team, minute, pen, og}] } from FIFA's per-match
// endpoint, one HTTP call per match. Pass `calendar` (the calendar/matches Results array) to
// avoid an extra fetch; `limit` caps per-match calls per run.
//
// Two modes, by options:
//  - FINISHED (default: statuses=['FT'], requireComplete=true) — mirrors fetchMatchGoals
//    (Wikipedia): only finished matches missing goals are fetched, and a match is accepted
//    only if its goal count equals the scoreline, so a partial feed is never stored. Callers
//    cache the result permanently.
//  - LIVE (e.g. statuses=['1H','2H','HT'], requireComplete=false) — fetch in-progress
//    matches and accept whatever goals FIFA has entered so far (the scoreline guard would
//    reject a still-changing match). Callers must NOT cache this permanently.
export async function fetchFifaMatchGoals(seed, results, opts = {}) {
  const {
    fetchImpl = fetch,
    existingGoals = {},
    calendar = null,
    limit = Infinity,
    statuses = ['FT'],
    requireComplete = true,
  } = opts
  const wanted = new Set(statuses)

  let matches = calendar
  if (!matches) {
    try {
      const res = await fetchImpl(FIFA_MATCHES_URL, { headers: FIFA_HEADERS })
      matches = res.ok ? (await res.json()).Results || [] : []
    } catch {
      return {}
    }
  }
  const joined = joinToSeed(seed, matches)

  const out = {}
  let budget = limit
  for (const [id, r] of Object.entries(results)) {
    if (budget <= 0) break
    if (!wanted.has(r.status) || !r.home || !r.away) continue
    if (existingGoals[id]?.length) continue
    const j = joined[id]
    if (!j?.idMatch || !j?.idStage) continue
    budget--
    let doc
    try {
      const res = await fetchImpl(FIFA_LIVE_URL(j.idStage, j.idMatch), { headers: FIFA_HEADERS })
      if (!res.ok) continue
      doc = await res.json()
    } catch {
      continue
    }
    const goals = goalsFromMatchDoc(doc)
    // Integrity guard (finished only): accept a match only when fully entered. Live matches
    // are intentionally exempt — their goal count legitimately trails the live scoreline.
    if (requireComplete && goals.length !== (r.homeGoals ?? 0) + (r.awayGoals ?? 0)) continue
    out[id] = goals
  }
  return out
}
