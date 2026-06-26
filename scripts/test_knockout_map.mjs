// Self-check for matchKnockoutByKickoff: the global nearest-kickoff assignment must bind
// exact-time matches first, so an early seed slot can't steal a candidate that belongs to a
// later slot. Run: node scripts/test_knockout_map.mjs
import assert from 'node:assert'
import { matchKnockoutByKickoff } from './lib/map.mjs'

// Two seed R32 slots whose kickoffs collide in greedy order: 74 (later) and 76 (earlier).
const seed = {
  knockout: [
    { id: 74, round: 'R32', kickoff: '2026-06-29T20:30:00Z' }, // Gillette, Boston
    { id: 76, round: 'R32', kickoff: '2026-06-29T17:00:00Z' }, // NRG, Houston
    { id: 81, round: 'R32', kickoff: '2026-07-02T00:00:00Z' }, // Levi's, SF Bay
  ],
}
const ms = (s) => new Date(s).getTime()
// Brazil-Japan kicks off 17:00 (exactly slot 76); USA-Bosnia 2 days later (exactly slot 81).
const candidates = [
  { home: 'Brazil', away: 'Japan', date: ms('2026-06-29T17:00:00Z') },
  { home: 'United States', away: 'Bosnia and Herzegovina', date: ms('2026-07-02T00:00:00Z') },
]

const out = matchKnockoutByKickoff(seed, candidates)
assert.equal(out.get(76)?.home, 'Brazil', 'Brazil-Japan must land on slot 76, not 74')
assert.equal(out.get(81)?.home, 'United States', 'USA-Bosnia must land on slot 81')
assert.equal(out.has(74), false, 'slot 74 has no resolved candidate yet — must stay empty')

console.log('ok — knockout slots assigned by exact kickoff, no greedy theft')
