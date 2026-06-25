import { THIRD_PLACE_TABLE, THIRD_SLOT_ORDER } from './third-place-table.js'

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

  // Group every fixture by its group so the clinch check below can see the unplayed ones.
  const teamGroup = {}
  for (const [g, teams] of Object.entries(groups)) for (const t of teams) teamGroup[t] = g
  const matchesByGroup = Object.fromEntries(Object.keys(groups).map((g) => [g, []]))
  for (const m of groupMatches) {
    const g = teamGroup[m.home]
    if (g && teamGroup[m.away] === g) matchesByGroup[g].push(m)
  }

  for (const g of Object.keys(standings)) {
    for (const row of standings[g]) row.gd = row.gf - row.ga
    standings[g].sort(makeComparator(finished))
    standings[g].forEach((row, i) => { row.position = i + 1 })
    standings[g].allFinished = standings[g].every((r) => r.played === 3)
    // Once the group is fully played, the top 2 by final standings have qualified —
    // the points-only clinch heuristic misses a runner-up tied on points (decided on GD).
    const clinched = clinchedTop2(groups[g], matchesByGroup[g])
    for (const row of standings[g])
      row.clinched = standings[g].allFinished ? row.position <= 2 : clinched.has(row.team)
  }
  return standings
}

// Teams that have mathematically secured a top-2 (direct qualification) spot: in EVERY
// possible win/draw/loss combination of their group's remaining matches, at most one other
// team can match or exceed their points. Points-only by design — goal margins are unbounded,
// so any team that can merely draw level on points is treated as a possible rival (a team
// safe only on current goal difference is NOT certain). Best-third-place qualification is
// never certain at this stage, so this flags guaranteed top-2 only. A group has at most a
// handful of unplayed matches, so the 3^n enumeration stays tiny.
function clinchedTop2(teams, matches) {
  const base = Object.fromEntries(teams.map((t) => [t, 0]))
  const remaining = []
  for (const m of matches) {
    if (m.finished && m.homeGoals != null && m.awayGoals != null) {
      if (m.homeGoals > m.awayGoals) base[m.home] += 3
      else if (m.awayGoals > m.homeGoals) base[m.away] += 3
      else { base[m.home] += 1; base[m.away] += 1 }
    } else {
      remaining.push(m)
    }
  }
  const safe = new Set(teams)
  const outcomes = [[3, 0], [1, 1], [0, 3]] // home win / draw / away win
  const total = 3 ** remaining.length
  for (let mask = 0; mask < total; mask++) {
    const pts = { ...base }
    let n = mask
    for (const m of remaining) {
      const [hp, ap] = outcomes[n % 3]
      n = (n / 3) | 0
      pts[m.home] += hp
      pts[m.away] += ap
    }
    for (const t of [...safe]) {
      let geq = 0
      for (const u of teams) if (u !== t && pts[u] >= pts[t]) geq++
      if (geq > 1) safe.delete(t)
    }
  }
  return safe
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

// Map each third-place winner-slot ("1A", "1B", …) to the actual team that fills it,
// per FIFA's allocation table — but only once ALL twelve groups are fully played, since
// the eight best thirds can't be known until then. Returns null while any group is live.
function rankThirdPlace(standings) {
  const groups = Object.keys(standings)
  if (groups.length < 12 || !groups.every((g) => standings[g].allFinished)) return null
  const thirds = groups.map((g) => ({ g, row: standings[g][2] })).filter((x) => x.row)
  if (thirds.length < 12) return null
  // FIFA criteria for ranking third-placed teams: points, goal difference, goals scored.
  // Disciplinary points / drawing of lots aren't available client-side, so fall back to
  // FIFA ranking (rankPoints) as a deterministic final tiebreak.
  // ponytail: an exact tie at the 8th/9th boundary is vanishingly rare; wire in fair-play
  // points only if FIFA exposes them.
  thirds.sort(
    (a, b) =>
      b.row.points - a.row.points ||
      b.row.gd - a.row.gd ||
      b.row.gf - a.row.gf ||
      (b.row.rankPoints || 0) - (a.row.rankPoints || 0),
  )
  const top8 = thirds.slice(0, 8).map((x) => x.g)
  const assignment = THIRD_PLACE_TABLE[[...top8].sort().join('')]
  if (!assignment) return null // 495 keys cover every combo; guard anyway
  const bySlot = new Map()
  THIRD_SLOT_ORDER.forEach((slot, i) => bySlot.set(slot, standings[assignment[i]][2].team))
  return bySlot
}

export function resolveKnockout(knockout, standings, results, normStatus) {
  const thirdBySlot = rankThirdPlace(standings)
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

  // `sibling` is the other slot in the same match — a "3rd Group ..." pool is allocated
  // by which group winner (1A/1B/…) it faces, so we resolve it via that sibling slot.
  const resolve = (slot, sibling) => {
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
    if (slot.startsWith('3rd') && thirdBySlot) return thirdBySlot.get(sibling) || null
    return null // best-third pool, not yet allocated — shown as the slot label
  }

  return knockout.map((ko) => ({
    ...ko,
    home: resolve(ko.homeSlot, ko.awaySlot) || ko.homeSlot,
    away: resolve(ko.awaySlot, ko.homeSlot) || ko.awaySlot,
    homeResolved: !!resolve(ko.homeSlot, ko.awaySlot),
    awayResolved: !!resolve(ko.awaySlot, ko.homeSlot),
  }))
}
