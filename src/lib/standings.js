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

  // Green ✓ = qualified, red ✗ = eliminated — both only when mathematically decided.
  // In a finished group the top 2 are through and the 4th is out; the 3rd's fate hangs on
  // the best-third race, which is settled only once EVERY group is finished. At that point
  // the 8 best thirds turn green and the other 4 red — so the greens total exactly 32
  // (12×2 + 8) and the reds 16.
  const allGroupsDone = Object.values(standings).every((s) => s.allFinished)
  const qualThirds = allGroupsDone ? bestThirdGroups(standings) : null
  for (const g of Object.keys(standings)) {
    standings[g].forEach((row, i) => {
      row.eliminated = false
      if (!standings[g].allFinished) return
      if (i === 3) row.eliminated = true
      else if (i === 2 && qualThirds) {
        if (qualThirds.has(g)) row.clinched = true
        else row.eliminated = true
      }
    })
  }
  return standings
}

// The set of (up to) 8 group keys whose 3rd-placed team ranks among the best thirds,
// by FIFA's order: points → goal difference → goals scored → FIFA rating.
function bestThirdGroups(standings) {
  const thirds = Object.keys(standings)
    .map((g) => ({ g, row: standings[g][2] }))
    .filter((x) => x.row)
  thirds.sort(
    (a, b) =>
      b.row.points - a.row.points ||
      b.row.gd - a.row.gd ||
      b.row.gf - a.row.gf ||
      (b.row.rankPoints || 0) - (a.row.rankPoints || 0),
  )
  return new Set(thirds.slice(0, 8).map((x) => x.g))
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
  if (groups.some((g) => !standings[g][2])) return null
  // FIFA criteria for ranking third-placed teams: points, goal difference, goals scored,
  // then FIFA ranking (rankPoints) as a deterministic final tiebreak (disciplinary points /
  // drawing of lots aren't available client-side).
  // ponytail: an exact tie at the 8th/9th boundary is vanishingly rare; wire in fair-play
  // points only if FIFA exposes them.
  const top8 = bestThirdGroups(standings)
  if (top8.size < 8) return null
  const assignment = THIRD_PLACE_TABLE[[...top8].sort().join('')]
  if (!assignment) return null // 495 keys cover every combo; guard anyway
  const bySlot = new Map()
  THIRD_SLOT_ORDER.forEach((slot, i) => bySlot.set(slot, standings[assignment[i]][2].team))
  return bySlot
}

// --- Best-third qualification probability ----------------------------------------
// For each group that has FINISHED, estimate the chance its 3rd-placed team ends up
// among the 8 best thirds (and so qualifies). Method is a Monte Carlo we can explain to
// a user on demand:
//   1. The 3rd-placed teams of finished groups are fixed (their pts/GD/GF won't change).
//   2. For every group still being played, simulate each remaining match: goals are drawn
//      from independent Poissons whose means come from the two teams' FIFA rating gap
//      (`simScore`), then that group's 3rd place is read off the simulated final table.
//   3. All twelve 3rd-placed teams are ranked (pts → GD → GF → FIFA rating, FIFA's order);
//      the top 8 qualify. We repeat `sims` times and report, per finished group, the
//      fraction of runs in which its 3rd team made the top 8.
// The RNG is seeded so the same data always yields the same number (reproducible/shareable).
// ponytail: simple neutral-venue Poisson model and no in-sim head-to-head tiebreak — swap
// in a fitted xG model only if back-tested accuracy ever matters.
export function thirdPlaceProbabilities(standings, groups, groupMatches, rankOf, sims = 4000) {
  const groupKeys = Object.keys(standings)
  const completed = groupKeys.filter((g) => standings[g].allFinished)
  if (!completed.length) return new Map()
  const incomplete = groupKeys.filter((g) => !standings[g].allFinished)

  const teamGroup = {}
  for (const [g, teams] of Object.entries(groups)) for (const t of teams) teamGroup[t] = g

  // Points/goals each team has already banked, plus the unplayed matches per live group.
  const base = {}
  for (const g of groupKeys) for (const t of groups[g]) base[t] = { pts: 0, gf: 0, ga: 0 }
  const remainingByGroup = Object.fromEntries(incomplete.map((g) => [g, []]))
  for (const m of groupMatches) {
    const g = teamGroup[m.home]
    if (!g || teamGroup[m.away] !== g) continue
    if (m.finished && m.homeGoals != null && m.awayGoals != null) {
      applyResult(base[m.home], base[m.away], m.homeGoals, m.awayGoals)
    } else if (incomplete.includes(g)) {
      remainingByGroup[g].push(m)
    }
  }

  const fixedThirds = completed.map((g) => {
    const r = standings[g][2]
    return { g, pts: r.points, gd: r.gd, gf: r.gf, rank: rankOf.get(r.team) || 0 }
  })

  const rng = mulberry32(0x9e3779b9)
  const cmp = (a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || b.rank - a.rank
  const counts = Object.fromEntries(completed.map((g) => [g, 0]))
  for (let s = 0; s < sims; s++) {
    const thirds = fixedThirds.slice()
    for (const g of incomplete) {
      const stat = {}
      for (const t of groups[g]) { const b = base[t]; stat[t] = { pts: b.pts, gf: b.gf, ga: b.ga } }
      for (const m of remainingByGroup[g]) {
        const [hg, ag] = simScore(rankOf.get(m.home) || 0, rankOf.get(m.away) || 0, rng)
        applyResult(stat[m.home], stat[m.away], hg, ag)
      }
      const rows = groups[g].map((t) => ({
        pts: stat[t].pts, gd: stat[t].gf - stat[t].ga, gf: stat[t].gf, rank: rankOf.get(t) || 0,
      }))
      rows.sort(cmp)
      thirds.push({ g, ...rows[2] })
    }
    thirds.sort(cmp)
    for (const x of thirds.slice(0, 8)) if (x.g in counts) counts[x.g]++
  }
  const out = new Map()
  for (const g of completed) out.set(g, counts[g] / sims)
  return out
}

function applyResult(h, a, hg, ag) {
  h.gf += hg; h.ga += ag; a.gf += ag; a.ga += hg
  if (hg > ag) h.pts += 3
  else if (ag > hg) a.pts += 3
  else { h.pts++; a.pts++ }
}

// Independent Poissons for each side; the rating gap (FIFA points) tilts the expected
// goals around a ~1.35-goal base. Neutral venue, so no home advantage.
function simScore(rankH, rankA, rng) {
  const sup = Math.max(-2.2, Math.min(2.2, (rankH - rankA) / 200))
  return [poisson(Math.max(0.15, 1.35 + sup / 2), rng), poisson(Math.max(0.15, 1.35 - sup / 2), rng)]
}

function poisson(lambda, rng) {
  const L = Math.exp(-lambda)
  let k = 0, p = 1
  do { k++; p *= rng() } while (p > L)
  return k - 1
}

// Small deterministic PRNG so probabilities are stable/reproducible for a given dataset.
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
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
