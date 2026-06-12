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
// Channels we trust for official highlights, in preference order.
const YT_PREFERRED = /fox soccer|fox sports|fifa|one football|fox/i

// football-data.org team name -> our seed name. Extend as needed once names are known.
const TEAM_ALIASES = {
  'South Korea': 'Korea Republic',
  'IR Iran': 'Iran',
  'USA': 'United States',
  'Türkiye': 'Turkey',
  'Turkiye': 'Turkey',
  'Czechia': 'Czech Republic',
  'Côte d’Ivoire': 'Ivory Coast',
  "Côte d'Ivoire": 'Ivory Coast',
  'Cape Verde Islands': 'Cape Verde',
  'Cabo Verde': 'Cape Verde',
  'Congo DR': 'DR Congo',
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
  'Curaçao': 'Curaçao',
}

// football-data.org stage -> our round code.
const STAGE_TO_ROUND = {
  ROUND_OF_32: 'R32',
  LAST_32: 'R32',
  ROUND_OF_16: 'R16',
  LAST_16: 'R16',
  QUARTER_FINALS: 'QF',
  QUARTER_FINAL: 'QF',
  SEMI_FINALS: 'SF',
  SEMI_FINAL: 'SF',
  THIRD_PLACE: '3P',
  FINAL: 'F',
}

// football-data.org status -> API-Football-style short code our app already understands.
function statusShort(s) {
  if (s === 'FINISHED' || s === 'AWARDED') return 'FT'
  if (s === 'IN_PLAY') return '2H'
  if (s === 'PAUSED') return 'HT'
  return 'NS'
}

function norm(name) {
  if (!name) return name
  return TEAM_ALIASES[name] || name
}
function pairKey(a, b) {
  return [norm(a), norm(b)].sort().join(' vs ')
}

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

// Find an official highlights video for one match via the YouTube Data API.
async function youtubeHighlight(home, away) {
  const q = encodeURIComponent(`${home} vs ${away} 2026 World Cup highlights`)
  const url =
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video` +
    `&maxResults=6&order=relevance&relevanceLanguage=en&q=${q}&key=${YT_KEY}`
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`YouTube ${res.status} ${body.slice(0, 160)}`)
  }
  const items = (await res.json()).items || []
  const isHi = (it) => /highlight/i.test(it.snippet?.title || '')
  const pref =
    items.find((it) => YT_PREFERRED.test(it.snippet?.channelTitle || '') && isHi(it)) ||
    items.find(isHi) ||
    items[0]
  if (!pref?.id?.videoId) return null
  return {
    videoId: pref.id.videoId,
    title: pref.snippet.title,
    channel: pref.snippet.channelTitle,
    thumbnail: pref.snippet.thumbnails?.medium?.url || null,
  }
}

// Attach highlight links to finished matches: carry forward what we already found,
// then search for the most-recent finished matches still missing one (within budget).
async function enrichHighlights(results, existing) {
  if (!YT_KEY) {
    console.log('YOUTUBE_API_KEY not set — skipping highlights.')
    return
  }
  const prev = existing.results || {}
  for (const [id, r] of Object.entries(results)) {
    if (!r.highlight && prev[id]?.highlight) r.highlight = prev[id].highlight
  }
  const now = Date.now()
  const todo = Object.entries(results)
    .filter(([, r]) => {
      if (r.status !== 'FT' || r.highlight || !r.kickoff || !r.home || !r.away) return false
      const age = now - new Date(r.kickoff).getTime()
      return age > 0 && age < YT_MAX_AGE_MS
    })
    .sort((a, b) => new Date(b[1].kickoff) - new Date(a[1].kickoff))

  let budget = YT_BUDGET
  for (const [id, r] of todo) {
    if (budget <= 0) break
    budget--
    try {
      const h = await youtubeHighlight(r.home, r.away)
      if (h) {
        r.highlight = h
        console.log(`  highlight #${id} ${r.home} v ${r.away} -> ${h.videoId} (${h.channel})`)
      } else {
        console.log(`  no highlight yet #${id} ${r.home} v ${r.away}`)
      }
    } catch (e) {
      console.warn('  YouTube search failed:', e.message)
      break // likely quota/key issue — stop hitting the API this run
    }
  }
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

  const results = {}

  // --- Group fixtures: match by unordered team pair ---
  const seedGroupByPair = new Map()
  for (const f of seed.fixtures) seedGroupByPair.set(pairKey(f.home, f.away), f)

  // --- Knockout: bucket API matches by round for nearest-time matching ---
  const apiKnockoutByRound = {}

  for (const m of matches) {
    const home = norm(m.homeTeam?.name)
    const away = norm(m.awayTeam?.name)
    if (!home || !away) continue // unresolved knockout slot in the API
    const ft = m.score?.fullTime || {}
    const pens = m.score?.penalties || {}
    const status = statusShort(m.status)
    const kickoff = m.utcDate

    const seedFx = seedGroupByPair.get(pairKey(home, away))
    if (seedFx && (m.stage === 'GROUP_STAGE' || m.group)) {
      const sameOrder = norm(seedFx.home) === home
      results[seedFx.id] = {
        home: seedFx.home,
        away: seedFx.away,
        homeGoals: sameOrder ? ft.home : ft.away,
        awayGoals: sameOrder ? ft.away : ft.home,
        status,
        kickoff,
      }
      continue
    }

    const rnd = STAGE_TO_ROUND[m.stage]
    if (rnd) {
      ;(apiKnockoutByRound[rnd] ||= []).push({
        date: kickoff ? new Date(kickoff).getTime() : null,
        home, away,
        homeGoals: ft.home ?? null,
        awayGoals: ft.away ?? null,
        homePens: pens.home ?? null,
        awayPens: pens.away ?? null,
        status, kickoff,
      })
    }
  }

  // Match knockout API matches to seed knockout slots by round + nearest kickoff.
  for (const ko of seed.knockout) {
    const pool = apiKnockoutByRound[ko.round]
    if (!pool || !pool.length || !ko.kickoff) continue
    const target = new Date(ko.kickoff).getTime()
    let best = null
    let bestDiff = Infinity
    for (const cand of pool) {
      if (cand.used || cand.date == null) continue
      const diff = Math.abs(cand.date - target)
      if (diff < bestDiff) { bestDiff = diff; best = cand }
    }
    if (best) {
      best.used = true
      results[ko.id] = {
        home: best.home,
        away: best.away,
        homeGoals: best.homeGoals,
        awayGoals: best.awayGoals,
        homePens: best.homePens,
        awayPens: best.awayPens,
        status: best.status,
        kickoff: best.kickoff,
      }
    }
  }

  // --- Top scorers ---
  let scorers = []
  try {
    const ts = await api(`/competitions/${COMP}/scorers${SEASON ? `?season=${SEASON}&limit=30` : '?limit=30'}`)
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
