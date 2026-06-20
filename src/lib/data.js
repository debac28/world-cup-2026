// Loads the static seed (from the spreadsheet) and the live results (from the
// twice-daily update job) and merges them into a single in-memory model the views
// read from. Live data is layered on top of seed so the app is fully usable offline
// with just the schedule, and "fills in" once results arrive.

import { parse } from './time.js'
import { computeStandings, resolveKnockout } from './standings.js'
import { winProbability } from './predict.js'
import { fetchEspnOdds } from './odds.js'

const BASE = import.meta.env.BASE_URL

// Normalize per-region highlights into arrays of candidates so a geo-blocked clip has
// fallbacks. Accepts the new shape {US:[...], INTL:[...]}, the older single-object form
// {US:{...}}, and the legacy top-level `highlight`. Always returns {region:[...]} or null.
function normalizeHighlights(highlights, legacy) {
  const src = highlights || (legacy ? { US: legacy } : null)
  if (!src) return null
  const out = {}
  for (const [region, val] of Object.entries(src)) {
    const list = (Array.isArray(val) ? val : [val]).filter((v) => v && v.videoId)
    if (list.length) out[region] = list
  }
  return Object.keys(out).length ? out : null
}

// Live results come from the Cloudflare Worker (VITE_LIVE_URL) for near-real-time
// scores, with raw GitHub as a fallback if the Worker is unreachable. In dev we read
// the local file.
const RAW_LIVE =
  'https://raw.githubusercontent.com/debac28/world-cup-2026/main/public/data/live.json'
// In dev, if VITE_LIVE_URL is set (see .env.local) we read the live Worker so local
// shows exactly what production shows; otherwise we fall back to the local file.
const PRIMARY_LIVE = import.meta.env.DEV
  ? import.meta.env.VITE_LIVE_URL || `${BASE}data/live.json`
  : import.meta.env.VITE_LIVE_URL || RAW_LIVE
// Only worth a fallback when the primary isn't already raw/local.
const FALLBACK_LIVE = PRIMARY_LIVE === RAW_LIVE ? null : RAW_LIVE

let model = null
let seedCache = null
let liveCache = null
// Static list of official fan zones + bars, loaded once (like the seed) and carried across
// refreshes since it never changes per live update.
let watchCache = null
// DraftKings win % (via ESPN), keyed by seed match id and oriented to seed home/away. Fetched
// in the background and cached so the card's win % is a real market line, not the Elo guess;
// stays null until it resolves (then cards re-render). Refreshed at most every 10 min.
let oddsCache = null
let oddsAt = 0
const ODDS_TTL = 10 * 60 * 1000
// Set by main.js so a late-arriving odds fetch can swap the Elo numbers for the market line
// and re-render the current view.
let updateListener = null
export function onModelUpdate(fn) {
  updateListener = fn
}

async function loadJSON(path, fallback) {
  try {
    const res = await fetch(`${BASE}${path}`, { cache: 'no-cache' })
    if (!res.ok) throw new Error(res.status)
    return await res.json()
  } catch (e) {
    console.warn(`Could not load ${path}:`, e.message)
    return fallback
  }
}

// `no-store` so we always ask the network for the freshest results; the service
// worker's NetworkFirst rule still provides the last copy when offline. Tries the
// primary source (Worker), then the raw-GitHub fallback.
async function fetchLive() {
  for (const url of [PRIMARY_LIVE, FALLBACK_LIVE]) {
    if (!url) continue
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error(res.status)
      return await res.json()
    } catch (e) {
      console.warn(`Live fetch failed (${url}):`, e.message)
    }
  }
  return { updated: null, results: {}, scorers: [] }
}

// API-Football statuses -> our three buckets.
const LIVE = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT'])
const DONE = new Set(['FT', 'AET', 'PEN'])

function normStatus(s) {
  if (DONE.has(s)) return 'finished'
  if (LIVE.has(s)) return 'live'
  return 'scheduled'
}

function buildModel(seed, live) {
  const flagOf = new Map(seed.teams.map((t) => [t.name, t.flag]))
  const rankOf = new Map(seed.teams.map((t) => [t.name, t.rankPoints]))
  // True FIFA world ranking position stored per team in the seed (e.g. New Zealand 85),
  // shown as the #N badge on cards. This is the real global rank — NOT a seeding among
  // the 48 qualified teams — so people aren't confused by inflated positions.
  const rankPosOf = new Map(seed.teams.map((t) => [t.name, t.fifaRank || null]))
  const results = live.results || {}

  function withResult(fix, home, away) {
    const r = results[fix.id] || {}
    const status = normStatus(r.status)
    // For knockout matches the seed only knows slot labels ("1A", "W74"); once a
    // result exists it carries the actual qualified teams, so trust those names.
    if (fix.stage === 'knockout' && r.home && r.away) {
      home = r.home
      away = r.away
    }
    // Only treat goals as a real score once the match is under way. Scheduled fixtures
    // arrive from the live feeds carrying 0–0 placeholders; without this guard an
    // upcoming match would render "0 – 0" instead of its kickoff time.
    const hasScore =
      status !== 'scheduled' && r.homeGoals != null && r.awayGoals != null
    return {
      id: fix.id,
      stage: fix.stage,
      round: fix.round || null,
      roundName: fix.roundName || null,
      home,
      away,
      homeFlag: flagOf.get(home) || null,
      awayFlag: flagOf.get(away) || null,
      homeRank: rankPosOf.get(home) || null,
      awayRank: rankPosOf.get(away) || null,
      // Pre-match win split, only surfaced on upcoming Today-tab cards. Prefer the real
      // DraftKings market line (via ESPN) when we have it; fall back to the Elo split from
      // FIFA points (also covers knockout slots ESPN's pair-join doesn't reach). Null when a
      // team isn't known yet (unresolved knockout slot, no Elo rating).
      winProb: oddsCache?.get(fix.id) || winProbability(rankOf.get(home), rankOf.get(away)),
      kickoff: parse(fix.kickoff),
      venue: fix.venue || null,
      status,
      homeGoals: hasScore ? r.homeGoals : null,
      awayGoals: hasScore ? r.awayGoals : null,
      // Penalty-shootout score (knockout only); null unless a shootout happened.
      homePens: r.homePens ?? null,
      awayPens: r.awayPens ?? null,
      // Sending-offs from ESPN's live feed (oriented to home/away already), [{name, min}].
      // Shown as a red-card marker on the team so you can see a side is down a player.
      redHome: r.redHome || [],
      redAway: r.redAway || [],
      // Elapsed minute from FIFA, shown on the live badge ("● 87'"); null when not live.
      minute: status === 'live' ? r.minute || null : null,
      // Raw feed status code (e.g. '2H', 'HT', 'BT'), kept while live so the badge can show
      // "Half-time" during a paused-clock break instead of a minute-less "LIVE".
      statusCode: status === 'live' ? r.status || null : null,
      // Per-region highlight candidates {US:[...], INTL:[...]} — multiple so a geo-blocked
      // clip has fallbacks; legacy single forms are coerced to a 1-element array.
      highlights: normalizeHighlights(r.highlights, r.highlight),
      // Per-match goal scorers (parsed from Wikipedia), assigned to a side by team name so
      // orientation never matters. Empty until the match finishes and its article fills in.
      goals: (r.goals || []).map((g) => ({ ...g, home: g.team === home })),
      finished: status === 'finished',
      live: status === 'live',
    }
  }

  const groupMatches = seed.fixtures.map((f) => withResult(f, f.home, f.away))
  const standings = computeStandings(seed.groups, groupMatches, rankOf)
  const knockoutMatches = resolveKnockout(
    seed.knockout,
    standings,
    results,
    normStatus,
  ).map((ko) => withResult(ko, ko.home, ko.away))

  return {
    seed,
    updated: live.updated ? parse(live.updated) : null,
    teams: seed.teams,
    groups: seed.groups,
    flagOf,
    matches: [...groupMatches, ...knockoutMatches],
    groupMatches,
    knockoutMatches,
    standings,
    scorers: live.scorers || [],
    watchParties: watchCache || [],
  }
}

export async function load() {
  if (model) return model
  const [seed, live, watch] = await Promise.all([
    loadJSON('data/seed.json', null),
    fetchLive(),
    loadJSON('data/watch-parties.json', []),
  ])
  if (!seed) throw new Error('Missing seed.json — run `npm run seed`.')
  seedCache = seed
  liveCache = live
  watchCache = Array.isArray(watch) ? watch : []
  model = buildModel(seed, live)
  enrichOdds()
  return model
}

// Re-fetch live results and rebuild the model (seed is static, kept cached).
export async function refresh() {
  if (!seedCache) return load()
  const live = await fetchLive()
  liveCache = live
  model = buildModel(seedCache, live)
  enrichOdds()
  return model
}

// Best-effort background fetch of the DraftKings line. Refreshes the cache at most once per
// TTL, then rebuilds the model and asks main.js to re-render so the market numbers swap in
// for the Elo placeholders. Never throws and never blocks load/refresh.
async function enrichOdds() {
  if (!seedCache) return
  if (oddsCache && Date.now() - oddsAt < ODDS_TTL) return
  try {
    const odds = await fetchEspnOdds(seedCache)
    if (!odds.size) return
    oddsCache = odds
    oddsAt = Date.now()
    model = buildModel(seedCache, liveCache || { results: {}, scorers: [] })
    updateListener?.(model)
  } catch (e) {
    console.warn('Odds enrich failed:', e.message)
  }
}

export function matchesOn(model, dayKeyFn, key) {
  return model.matches
    .filter((m) => m.kickoff && dayKeyFn(m.kickoff) === key)
    .sort((a, b) => a.kickoff - b.kickoff)
}
