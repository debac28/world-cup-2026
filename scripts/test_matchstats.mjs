// Self-check for src/lib/matchstats.js — the two risky bits: orienting ESPN's raw home/away
// onto our seed home, and scaling fraction stats (passPct 0.9) to a percent. No DOM used.
// Run: node scripts/test_matchstats.mjs
import assert from 'node:assert'
import { fetchMatchDetail } from '../src/lib/matchstats.js'

// ESPN lists Morocco first, France second; our seed home is France -> must flip.
const summary = {
  boxscore: {
    teams: [
      { team: { displayName: 'Morocco' }, statistics: [
        { name: 'possessionPct', displayValue: '52' },
        { name: 'passPct', displayValue: '0.9' },
        { name: 'foulsCommitted', displayValue: '13' },
      ] },
      { team: { displayName: 'France' }, statistics: [
        { name: 'possessionPct', displayValue: '48' },
        { name: 'passPct', displayValue: '0.9' },
        { name: 'foulsCommitted', displayValue: '10' },
      ] },
    ],
  },
  rosters: [
    { team: { displayName: 'Morocco' }, formation: '4-2-3-1', roster: [
      { jersey: '1', athlete: { displayName: 'Bounou' }, position: { abbreviation: 'G' }, starter: true },
    ] },
    { team: { displayName: 'France' }, formation: '4-3-3', roster: [
      { jersey: '16', athlete: { displayName: 'Maignan' }, starter: true },
      { jersey: '9', athlete: { displayName: 'SubGuy' }, starter: false, subbedIn: true },
      { jersey: '4', athlete: { displayName: 'Benched' }, starter: false }, // never came on
    ] },
  ],
}

globalThis.fetch = async () => ({ ok: true, json: async () => summary })

const d = await fetchMatchDetail('evt', 'France', {})

const poss = d.stats.find((s) => s.label === 'Possession')
assert.equal(poss.home, '48%', 'home possession oriented to seed home (France)')
assert.equal(poss.away, '52%', 'away possession is the other side (Morocco)')

const pass = d.stats.find((s) => s.label === 'Pass accuracy')
assert.equal(pass.home, '90%', 'fraction passPct 0.9 scaled to 90%')

assert.equal(d.lineups.home.team, 'France', 'home lineup oriented to seed home')
assert.equal(d.lineups.home.formation, '4-3-3')
assert.equal(d.lineups.home.starters.length, 1)
assert.equal(d.lineups.home.subs.length, 1, 'only the sub who came on, not the benched player')
assert.equal(d.lineups.away.team, 'Morocco')

console.log('matchstats: OK')
