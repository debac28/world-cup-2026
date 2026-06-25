// Self-check for the best-third-placed knockout allocation (src/lib/standings.js).
// Run: node scripts/test_thirdplace.mjs
import assert from 'node:assert'
import fs from 'node:fs'
import { resolveKnockout } from '../src/lib/standings.js'
import { THIRD_PLACE_TABLE, THIRD_SLOT_ORDER } from '../src/lib/third-place-table.js'

const seed = JSON.parse(fs.readFileSync(new URL('../public/data/seed.json', import.meta.url)))
const GROUPS = Object.keys(seed.groups) // A..L
const normStatus = () => 'other' // no knockout matches played in this fixture

// Build a finished-group standings table where the third-placed team of every group in
// `top8` outranks the thirds of the other four, so those eight are the best thirds.
function fakeStandings(top8) {
  const s = {}
  for (const g of GROUPS) {
    const third = top8.includes(g)
    const mk = (pos) => ({ team: `${pos}${g}`, points: 9, gd: 5, gf: 8, rankPoints: 1000 })
    const rows = [mk(1), mk(2), { team: `3${g}`, points: third ? 5 : 0, gd: 0, gf: 1, rankPoints: 0 }, mk(4)]
    rows.allFinished = true
    s[g] = rows
  }
  return s
}

function checkCombo(top8) {
  const key = [...top8].sort().join('')
  const assign = THIRD_PLACE_TABLE[key]
  assert(assign, `no table entry for ${key}`)
  // Expected: winner-slot 1X faces the third of group assign[i].
  const expected = new Map(THIRD_SLOT_ORDER.map((slot, i) => [slot, `3${assign[i]}`]))

  const ko = resolveKnockout(seed.knockout, fakeStandings(top8), {}, normStatus)
  let checked = 0
  for (const m of ko) {
    const winnerSlot = m.homeSlot // the eight third-place matches pair 1X (home) vs a 3rd pool
    if (!expected.has(winnerSlot) || !m.awaySlot.startsWith('3rd')) continue
    assert.strictEqual(m.away, expected.get(winnerSlot),
      `match #${m.id} (${winnerSlot}): expected ${expected.get(winnerSlot)}, got ${m.away}`)
    assert.strictEqual(m.awayResolved, true, `match #${m.id} should be resolved`)
    checked++
  }
  assert.strictEqual(checked, 8, `expected 8 third-place slots, checked ${checked} for ${key}`)
}

// Two distinct combinations, including one with groups A–D (a "still possible" row).
checkCombo(['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'])
checkCombo(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])

// Sanity: while any group is unfinished, third-place slots stay as labels.
const live = fakeStandings(['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'])
live.A.allFinished = false
const koLive = resolveKnockout(seed.knockout, live, {}, normStatus)
const thirdMatch = koLive.find((m) => m.awaySlot.startsWith('3rd'))
assert.strictEqual(thirdMatch.away, thirdMatch.awaySlot, 'third slot must stay a label until all groups finish')
assert.strictEqual(thirdMatch.awayResolved, false)

console.log('thirdplace allocation: all checks passed')
