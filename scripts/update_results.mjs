#!/usr/bin/env node
/**
 * Fetch live World Cup results + top scorers from football-data.org (v4) and write
 * public/data/live.json. Run by the GitHub Actions cron every hour.
 *
 * Requires env FOOTBALL_DATA_TOKEN (a free token from
 * https://www.football-data.org/client/register). The free tier includes the World Cup
 * competition (code "WC").
 *
 * It maps the API's matches onto the seed's match numbers (1-104) so the app can merge
 * results onto its static schedule:
 *   - Group-stage matches are matched by the unordered team pair, with goals oriented to
 *     the seed's home/away order.
 *   - Knockout matches are matched by round + nearest kickoff (the seed only has slot
 *     labels like "1A"/"W74" there, so the live result carries the real team names).
 *
 * If the token is missing, or the API returns nothing useful (e.g. before the draw is
 * loaded), it preserves any existing results rather than wiping them.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildResults, norm } from './lib/map.mjs'
import { buildEspnResults, mergeResults, ESPN_SCOREBOARD_URL } from './lib/espn.mjs'
import { buildFifaResults, fetchFifaMatchGoals, FIFA_MATCHES_URL, FIFA_HEADERS } from './lib/fifa.mjs'
import { youtubeHighlight } from './lib/highlights.mjs'
import { fetchMatchGoals } from './lib/scorers.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SEED_PATH = join(ROOT, 'public', 'data', 'seed.json')
const OUT_PATH = join(ROOT, 'public', 'data', 'live.json')

const API_BASE = 'https://api.football-data.org/v4'
const COMP = process.env.FOOTBALL_DATA_COMP || 'WC' // World Cup
const SEASON = process.env.FOOTBALL_DATA_SEASON || '' // e.g. "2026"; empty = current
const TOKEN = process.env.FOOTBALL_DATA_TOKEN

// --- YouTube highlights (optional) --------------------------------------------
// If YOUTUBE_API_KEY is set, the script finds an official highlights video for each
// finished match and caches it. Quota-safe: a YouTube search costs 100 units and the
// free daily quota is 10,000, so we cap searches per run (default 4 => max ~96/day)
// and never re-search a match that already has a highlight.
const YT_KEY = process.env.YOUTUBE_API_KEY
const YT_BUDGET = Number(process.env.YOUTUBE_SEARCH_BUDGET || 4)
const YT_MAX_AGE_MS =
  Number(process.env.YOUTUBE_MAX_AGE_DAYS || 5) * 24 * 60 * 60 * 1000

async function api(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'X-Auth-Token': TOKEN },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`API ${path} -> ${res.status} ${body.slice(0, 200)}`)
  }
  return res.json()
}

async function loadExisting() {
  try {
    return JSON.parse(await readFile(OUT_PATH, 'utf8'))
  } catch {
    return { updated: null, results: {}, scorers: [] }
  }
}

// We only pin an exact video for the US, where official FOX/FIFA highlights are
// reliably on YouTube. India has no official WC highlights on YouTube (rights sit with
// Sony/JioHotstar), so India viewers get a YouTube *search* link in the app instead —
// no API search needed, and no risk of linking spam re-uploads.
const HIGHLIGHT_REGIONS = ['US']

// Attach per-region highlight links to finished matches: carry forward what we already
// found, then search (per region) for recent finished matches still missing one.
async function enrichHighlights(results, existing) {
  if (!YT_KEY) {
    console.log('YOUTUBE_API_KEY not set — skipping highlights.')
    return
  }
  // Carry forward already-found highlights, migrating the old single `highlight`
  // (US-only) into the new per-region `highlights` shape.
  const prev = existing.results || {}
  for (const [id, r] of Object.entries(results)) {
    const prevH =
      prev[id]?.highlights || (prev[id]?.highlight ? { US: prev[id].highlight } : null)
    if (prevH) r.highlights = { ...prevH, ...(r.highlights || {}) }
  }

  const now = Date.now()
  const todo = Object.entries(results)
    .filter(([, r]) => {
      if (r.status !== 'FT' || !r.kickoff || !r.home || !r.away) return false
      const missing = HIGHLIGHT_REGIONS.some((rg) => !r.highlights?.[rg])
      const age = now - new Date(r.kickoff).getTime()
      return missing && age > 0 && age < YT_MAX_AGE_MS
    })
    .sort((a, b) => new Date(b[1].kickoff) - new Date(a[1].kickoff))

  let budget = YT_BUDGET // counts individual searches (region × match)
  outer: for (const [id, r] of todo) {
    for (const region of HIGHLIGHT_REGIONS) {
      if (budget <= 0) break outer
      if (r.highlights?.[region]) continue // already have this region
      budget--
      try {
        const h = await youtubeHighlight(r.home, r.away, region, YT_KEY)
        if (h) {
          r.highlights = { ...(r.highlights || {}), [region]: h }
          console.log(`  highlight #${id} [${region}] ${r.home} v ${r.away} -> ${h.videoId} (${h.channel})`)
        } else {
          console.log(`  no [${region}] highlight yet #${id} ${r.home} v ${r.away}`)
        }
      } catch (e) {
        console.warn('  YouTube search failed:', e.message)
        break outer // likely quota/key issue — stop hitting the API this run
      }
    }
  }
}

// Carry forward already-known goals (a finished match never changes), then fetch goals for
// any finished match still missing them. FIFA's structured goal events are the primary
// source; Wikipedia (scorers.mjs) is the fallback. Both validate count vs scoreline.
async function attachMatchGoals(seed, results, existing) {
  const prev = existing.results || {}
  const existingGoals = {}
  for (const [id, r] of Object.entries(results)) {
    if (prev[id]?.goals?.length) {
      r.goals = prev[id].goals
      existingGoals[id] = prev[id].goals
    }
  }

  const collected = {}
  // Primary: FIFA structured goal events.
  try {
    Object.assign(collected, await fetchFifaMatchGoals(seed, results, { existingGoals }))
  } catch (e) {
    console.warn('FIFA scorers fetch failed:', e.message)
  }
  // Fallback: Wikipedia for finished matches FIFA didn't cover.
  try {
    const seen = { ...existingGoals, ...collected }
    Object.assign(collected, await fetchMatchGoals(seed, results, { existingGoals: seen }))
  } catch (e) {
    console.warn('Wikipedia scorers fetch failed:', e.message)
  }

  let count = 0
  for (const [id, goals] of Object.entries(collected)) {
    if (results[id] && goals.length) {
      results[id].goals = goals
      count += goals.length
    }
  }
  console.log(`Attached ${count} goal events across ${Object.keys(collected).length} matches.`)
}

async function main() {
  const seed = JSON.parse(await readFile(SEED_PATH, 'utf8'))

  if (!TOKEN) {
    console.error('FOOTBALL_DATA_TOKEN not set — leaving existing live.json untouched.')
    return
  }

  const q = SEASON ? `?season=${SEASON}` : ''
  const matchesResp = await api(`/competitions/${COMP}/matches${q}`)
  const matches = matchesResp.matches || []
  console.log(`Fetched ${matches.length} matches from football-data.org.`)

  let results = buildResults(seed, matches)

  // Overlay ESPN's fresher live data (football-data's free tier lags). Additive: on any
  // failure the football-data results stand untouched.
  try {
    const espnResp = await fetch(ESPN_SCOREBOARD_URL)
    if (espnResp.ok) {
      const espn = await espnResp.json()
      results = mergeResults(results, buildEspnResults(seed, espn.events || []))
      console.log(`Merged ESPN scoreboard (${(espn.events || []).length} events).`)
    } else {
      console.warn(`ESPN fetch -> ${espnResp.status}; skipping ESPN merge.`)
    }
  } catch (e) {
    console.warn('ESPN merge failed:', e.message)
  }

  // Overlay FIFA's canonical feed last — highest precedence (FIFA > ESPN > football-data),
  // so it wins live ties. Additive: on any failure the prior results stand untouched.
  try {
    const fifaResp = await fetch(FIFA_MATCHES_URL, { headers: FIFA_HEADERS })
    if (fifaResp.ok) {
      const fifa = await fifaResp.json()
      results = mergeResults(results, buildFifaResults(seed, fifa.Results || []))
      console.log(`Merged FIFA calendar (${(fifa.Results || []).length} matches).`)
    } else {
      console.warn(`FIFA fetch -> ${fifaResp.status}; skipping FIFA merge.`)
    }
  } catch (e) {
    console.warn('FIFA merge failed:', e.message)
  }

  // --- Top scorers ---
  let scorers = []
  try {
    const ts = await api(`/competitions/${COMP}/scorers${SEASON ? `?season=${SEASON}&limit=100` : '?limit=100'}`)
    scorers = (ts.scorers || []).map((s) => ({
      player: s.player?.name,
      team: norm(s.team?.name),
      goals: s.goals ?? 0,
      assists: s.assists ?? 0,
    })).filter((s) => s.player && s.goals > 0)
  } catch (e) {
    console.warn('Top scorers fetch failed:', e.message)
  }

  // Don't clobber good data with an empty pull (e.g. provider not yet populated).
  const existing = await loadExisting()
  const haveResults = Object.keys(results).length
  const finalResults = haveResults ? results : existing.results || {}
  const finalScorers = scorers.length ? scorers : existing.scorers || []

  // Per-match goal scorers from Wikipedia (football-data has no goal events). Finished
  // matches only, validated against the scoreline, cached forever (carried forward).
  await attachMatchGoals(seed, finalResults, existing)

  // Attach YouTube highlight links to finished matches (no-op without a key).
  await enrichHighlights(finalResults, existing)

  const out = {
    updated: new Date().toISOString(),
    season: SEASON || matchesResp.filters?.season || null,
    results: finalResults,
    scorers: finalScorers,
  }
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n')
  console.log(
    `Wrote ${OUT_PATH}: ${Object.keys(finalResults).length} results, ${finalScorers.length} scorers.`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
