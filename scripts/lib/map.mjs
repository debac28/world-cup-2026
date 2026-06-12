// Pure mapping from football-data.org match objects onto our seed match numbers.
// Shared by the GitHub updater (scripts/update_results.mjs) and the Cloudflare Worker
// (worker/src/index.js) so the mapping logic lives in exactly one place. No Node or
// Workers-specific APIs in here — keep it pure so both runtimes can import it.

// football-data.org team name -> our seed name. Extend as names surface.
export const TEAM_ALIASES = {
  'South Korea': 'Korea Republic',
  'IR Iran': 'Iran',
  USA: 'United States',
  'Türkiye': 'Turkey',
  Turkiye: 'Turkey',
  Czechia: 'Czech Republic',
  'Côte d’Ivoire': 'Ivory Coast',
  "Côte d'Ivoire": 'Ivory Coast',
  'Cape Verde Islands': 'Cape Verde',
  'Cabo Verde': 'Cape Verde',
  'Congo DR': 'DR Congo',
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
  'Curaçao': 'Curaçao',
}

// football-data.org stage -> our round code.
export const STAGE_TO_ROUND = {
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

// football-data.org status -> the short codes the app understands.
export function statusShort(s) {
  if (s === 'FINISHED' || s === 'AWARDED') return 'FT'
  if (s === 'IN_PLAY') return '2H'
  if (s === 'PAUSED') return 'HT'
  return 'NS'
}

export function norm(name) {
  if (!name) return name
  return TEAM_ALIASES[name] || name
}

export function pairKey(a, b) {
  return [norm(a), norm(b)].sort().join(' vs ')
}

// Build the `results` object (keyed by seed match number 1-104) from a list of
// football-data.org match objects. Group matches map by unordered team pair (goals
// oriented to seed home/away); knockout matches map by round + nearest kickoff.
export function buildResults(seed, matches) {
  const results = {}

  const seedGroupByPair = new Map()
  for (const f of seed.fixtures) seedGroupByPair.set(pairKey(f.home, f.away), f)

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
        home,
        away,
        homeGoals: ft.home ?? null,
        awayGoals: ft.away ?? null,
        homePens: pens.home ?? null,
        awayPens: pens.away ?? null,
        status,
        kickoff,
      })
    }
  }

  // Knockout: zip each round's API matches to seed slots by nearest kickoff.
  for (const ko of seed.knockout) {
    const pool = apiKnockoutByRound[ko.round]
    if (!pool || !pool.length || !ko.kickoff) continue
    const target = new Date(ko.kickoff).getTime()
    let best = null
    let bestDiff = Infinity
    for (const cand of pool) {
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
        homePens: best.homePens,
        awayPens: best.awayPens,
        status: best.status,
        kickoff: best.kickoff,
      }
    }
  }

  return results
}
