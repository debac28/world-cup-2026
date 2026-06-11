// Group standings + knockout slot resolution.
//
// Standings are computed from finished group matches using FIFA's 2026 group-stage
// criteria order: (1) points, (2) overall goal difference, (3) overall goals scored,
// (4) head-to-head points among teams still tied, (5) FIFA ranking (the spreadsheet's
// final tiebreaker). Yellow/red-card fair-play and drawing of lots are not modelled.

function blankRow(team, rank) {
  return {
    team,
    rankPoints: rank ?? 0,
    played: 0, win: 0, draw: 0, loss: 0,
    gf: 0, ga: 0, gd: 0, points: 0,
  }
}

export function computeStandings(groups, groupMatches, rankOf) {
  const byTeam = new Map()
  const standings = {}

  for (const [g, teams] of Object.entries(groups)) {
    standings[g] = teams.map((t) => {
      const row = blankRow(t, rankOf.get(t))
      byTeam.set(t, row)
      return row
    })
  }

  const finished = groupMatches.filter(
    (m) => m.finished && m.homeGoals != null && m.awayGoals != null,
  )
  for (const m of finished) {
    const h = byTeam.get(m.home)
    const a = byTeam.get(m.away)
    if (!h || !a) continue
    h.played++; a.played++
    h.gf += m.homeGoals; h.ga += m.awayGoals
    a.gf += m.awayGoals; a.ga += m.homeGoals
    if (m.homeGoals > m.awayGoals) { h.win++; h.points += 3; a.loss++ }
    else if (m.homeGoals < m.awayGoals) { a.win++; a.points += 3; h.loss++ }
    else { h.draw++; a.draw++; h.points++; a.points++ }
  }

  for (const g of Object.keys(standings)) {
    for (const row of standings[g]) row.gd = row.gf - row.ga
    standings[g].sort(makeComparator(finished))
    standings[g].forEach((row, i) => { row.position = i + 1 })
    standings[g].allFinished = standings[g].every((r) => r.played === 3)
  }
  return standings
}

function makeComparator(finished) {
  return (a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.gd !== a.gd) return b.gd - a.gd
    if (b.gf !== a.gf) return b.gf - a.gf
    const h2h = headToHead(a, b, finished)
    if (h2h) return h2h
    return (b.rankPoints || 0) - (a.rankPoints || 0)
  }
}

// Points between exactly these two teams (their direct match, if played).
function headToHead(a, b, finished) {
  const m = finished.find(
    (x) =>
      (x.home === a.team && x.away === b.team) ||
      (x.home === b.team && x.away === a.team),
  )
  if (!m) return 0
  const aGoals = m.home === a.team ? m.homeGoals : m.awayGoals
  const bGoals = m.home === a.team ? m.awayGoals : m.homeGoals
  if (aGoals === bGoals) return 0
  return bGoals > aGoals ? 1 : -1 // higher scorer ranks first
}

// --- Knockout slot resolution ---------------------------------------------------
// Slots: "1A"/"2A" = group winner/runner-up; "3rd Group X/Y/.." = a best-third pool
// (left unresolved — exact allocation depends on which thirds qualify); "W74" =
// winner of match 74; "L101" = loser of match 101.

export function resolveKnockout(knockout, standings, results, normStatus) {
  const winners = new Map()
  const losers = new Map()
  for (const [id, r] of Object.entries(results)) {
    if (normStatus(r.status) !== 'finished') continue
    if (r.homeGoals == null || r.awayGoals == null || !r.home || !r.away) continue
    // Penalty shootout decides a draw if pen scores are present.
    let hw = r.homeGoals > r.awayGoals
    let aw = r.awayGoals > r.homeGoals
    if (!hw && !aw && r.homePens != null && r.awayPens != null) {
      hw = r.homePens > r.awayPens
      aw = r.awayPens > r.homePens
    }
    if (hw) { winners.set(+id, r.home); losers.set(+id, r.away) }
    else if (aw) { winners.set(+id, r.away); losers.set(+id, r.home) }
  }

  const resolve = (slot) => {
    if (!slot) return null
    const pos = slot.match(/^([12])([A-L])$/)
    if (pos) {
      const table = standings[pos[2]]
      if (table && table.allFinished) return table[+pos[1] - 1].team
      return null
    }
    const w = slot.match(/^W(\d+)$/)
    if (w) return winners.get(+w[1]) || null
    const l = slot.match(/^L(\d+)$/)
    if (l) return losers.get(+l[1]) || null
    return null // "3rd Group ..." pool — shown as the slot label
  }

  return knockout.map((ko) => ({
    ...ko,
    home: resolve(ko.homeSlot) || ko.homeSlot,
    away: resolve(ko.awaySlot) || ko.awaySlot,
    homeResolved: !!resolve(ko.homeSlot),
    awayResolved: !!resolve(ko.awaySlot),
  }))
}
