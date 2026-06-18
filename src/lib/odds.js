// Fetches DraftKings pre-match win odds from ESPN (free, keyless, CORS-open) and turns them
// into the two-way win split shown on the Today cards — a real market price replacing the
// Elo estimate. Two cheap requests per match window: ESPN's small scoreboard for the event
// ids + team pairs, then a ~14KB per-event odds endpoint. Everything is best-effort: any
// failure leaves the Map without that match and the caller falls back to the Elo number.
//
// We join ESPN events onto the seed by unordered team pair using the SAME `norm`/`pairKey`
// helpers the Worker uses for ESPN scores, so aliasing + home/away orientation stay consistent.

import { ESPN_SCOREBOARD_URL } from '../../scripts/lib/espn.mjs'
import { norm, pairKey } from '../../scripts/lib/map.mjs'
import { oddsWinProbability } from './predict.js'

const oddsEndpoint = (eventId) =>
  `https://sports.core.api.espn.com/v2/sports/soccer/leagues/fifa.world/events/${eventId}/competitions/${eventId}/odds`

async function fetchJSON(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(res.status)
  return res.json()
}

// Pull the pre-match DraftKings line for one event id and convert to { home, away } in ESPN's
// own orientation. Skips the separate "DraftKings - Live Odds" provider (we only want the
// opening line here) and any incomplete line.
async function fetchEventSplit(eventId) {
  const items = (await fetchJSON(oddsEndpoint(eventId))).items || []
  const dk = items.find((o) => o.provider?.name === 'DraftKings')
  if (!dk) return null
  return oddsWinProbability(
    dk.homeTeamOdds?.moneyLine,
    dk.drawOdds?.moneyLine,
    dk.awayTeamOdds?.moneyLine,
  )
}

// Returns Map<seedMatchId, { home, away }> for the matches currently in ESPN's scoreboard
// window, oriented to the seed's home/away order. Possibly empty; never throws.
export async function fetchEspnOdds(seed) {
  const out = new Map()
  if (!seed?.fixtures) return out

  let events
  try {
    events = (await fetchJSON(ESPN_SCOREBOARD_URL)).events || []
  } catch {
    return out
  }

  const seedByPair = new Map()
  for (const f of seed.fixtures) seedByPair.set(pairKey(f.home, f.away), f)

  await Promise.all(
    events.map(async (ev) => {
      const comp = ev?.competitions?.[0]
      const cs = comp?.competitors || []
      const espnHome = norm(cs.find((c) => c.homeAway === 'home')?.team?.displayName)
      const espnAway = norm(cs.find((c) => c.homeAway === 'away')?.team?.displayName)
      if (!espnHome || !espnAway || !ev.id) return
      // Only group fixtures join by pair; knockout slots fall back to the Elo number.
      const seedFx = seedByPair.get(pairKey(espnHome, espnAway))
      if (!seedFx) return
      let split
      try {
        split = await fetchEventSplit(ev.id)
      } catch {
        return
      }
      if (!split) return
      const sameOrder = norm(seedFx.home) === espnHome
      out.set(seedFx.id, sameOrder ? split : { home: split.away, away: split.home })
    }),
  )

  return out
}
