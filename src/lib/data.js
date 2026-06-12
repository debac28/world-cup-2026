// Loads the static seed (from the spreadsheet) and the live results (from the
// twice-daily update job) and merges them into a single in-memory model the views
// read from. Live data is layered on top of seed so the app is fully usable offline
// with just the schedule, and "fills in" once results arrive.

import { parse } from './time.js'
import { computeStandings, resolveKnockout } from './standings.js'

const BASE = import.meta.env.BASE_URL

let model = null
let seedCache = null

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

const fetchLive = () =>
  loadJSON('data/live.json', { updated: null, results: {}, scorers: [] })

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
    const hasScore = r.homeGoals != null && r.awayGoals != null
    return {
      id: fix.id,
      stage: fix.stage,
      round: fix.round || null,
      roundName: fix.roundName || null,
      home,
      away,
      homeFlag: flagOf.get(home) || null,
      awayFlag: flagOf.get(away) || null,
      kickoff: parse(fix.kickoff),
      venue: fix.venue || null,
      status,
      homeGoals: hasScore ? r.homeGoals : null,
      awayGoals: hasScore ? r.awayGoals : null,
      highlight: r.highlight || null,
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
  }
}

export async function load() {
  if (model) return model
  const [seed, live] = await Promise.all([loadJSON('data/seed.json', null), fetchLive()])
  if (!seed) throw new Error('Missing seed.json — run `npm run seed`.')
  seedCache = seed
  model = buildModel(seed, live)
  return model
}

// Re-fetch live results and rebuild the model (seed is static, kept cached).
export async function refresh() {
  if (!seedCache) return load()
  const live = await fetchLive()
  model = buildModel(seedCache, live)
  return model
}

export function matchesOn(model, dayKeyFn, key) {
  return model.matches
    .filter((m) => m.kickoff && dayKeyFn(m.kickoff) === key)
    .sort((a, b) => a.kickoff - b.kickoff)
}
