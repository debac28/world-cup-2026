// "Who wins the cup?" poll — a small engagement card shown on the Today tab ONLY on days
// with no matches (see today.js). The options are the teams still alive for the next
// knockout round to be played, so it's really three polls in sequence:
//   quarter-finals not all done -> the 8 QF teams
//   QFs done, semis pending      -> the 4 semi-finalists
//   semis done, final pending    -> the 2 finalists
// Each stage is a fresh, separate poll (its own vote key + KV counter), so a user votes once
// per stage. Bracket match numbers are fixed by this seed: QF 97-100, SF 101-102, final 104.
//
// Tallies live in the Cloudflare Worker's KV (GET/POST /poll?stage=…); the worker stores only
// real votes, and this card adds the committed seed baseline (poll.json) on top so a brand-new
// stage shows believable numbers instead of zeros. One vote per browser per stage is enforced
// via localStorage. If the Worker is unreachable (e.g. local dev before deploy), only the seed
// baseline shows and votes are optimistic-local — the card still renders correctly.
import { el, flag, clear } from '../lib/dom.js'

const POLL_URL = import.meta.env.VITE_LIVE_URL?.replace(/\/live\b/, '/poll') || null
const STAGES = [
  { stage: 'qf', ids: [97, 98, 99, 100] },
  { stage: 'sf', ids: [101, 102] },
  { stage: 'final', ids: [104] },
]
let cfg = null // poll.json: { question, seed: { [team]: baseline } }

// The earliest knockout round not yet fully played, plus its (already-resolved) teams. Null
// once the final is done — no poll.
function aliveStage(model) {
  const byId = (id) => model.matches.find((m) => m.id === id)
  for (const { stage, ids } of STAGES) {
    const ms = ids.map(byId)
    if (ms.some((m) => !m)) return null
    if (ms.every((m) => m.finished)) continue
    const teams = ms.flatMap((m) => [
      { name: m.home, flag: m.homeFlag },
      { name: m.away, flag: m.awayFlag },
    ])
    return { stage, teams }
  }
  return null
}

export function pollCard(model) {
  const active = aliveStage(model)
  if (!active) return null
  const box = el('section', { class: 'poll' })
  build(box, active)
  return box
}

async function loadCfg() {
  if (cfg) return cfg
  cfg = await (await fetch(`${import.meta.env.BASE_URL}data/poll.json`)).json()
  return cfg
}

// Real votes for this stage from the Worker (empty object if unreachable).
async function fetchVotes(stage) {
  if (!POLL_URL) return {}
  try {
    const r = await fetch(`${POLL_URL}?stage=${stage}`)
    if (r.ok) return (await r.json()).counts || {}
  } catch {}
  return {}
}

async function build(box, active) {
  const conf = await loadCfg()
  const votes = await fetchVotes(active.stage)
  render(box, conf, active, votes, localStorage.getItem(voteKey(active.stage)))
}

const voteKey = (stage) => `cupwinner-vote-${stage}`
// Displayed count = committed seed baseline + real votes recorded by the Worker.
const countOf = (conf, votes, name) => (conf.seed[name] || 1) + (votes[name] || 0)

function render(box, conf, active, votes, myVote) {
  clear(box)
  box.appendChild(el('h3', { class: 'poll__q' }, conf.question))

  if (!myVote) {
    for (const t of active.teams) {
      const btn = el('button', { class: 'poll__opt', type: 'button' }, [
        flag(t.flag, t.name),
        el('span', { class: 'poll__name' }, t.name),
      ])
      btn.addEventListener('click', () => vote(box, conf, active, votes, t.name))
      box.appendChild(btn)
    }
    return
  }

  const total = active.teams.reduce((s, t) => s + countOf(conf, votes, t.name), 0) || 1
  const ranked = [...active.teams].sort(
    (a, b) => countOf(conf, votes, b.name) - countOf(conf, votes, a.name),
  )
  for (const t of ranked) {
    const pct = Math.round((countOf(conf, votes, t.name) / total) * 100)
    box.appendChild(
      el('div', { class: `poll__row ${t.name === myVote ? 'poll__row--mine' : ''}` }, [
        el('div', { class: 'poll__bar', style: `width:${pct}%` }),
        flag(t.flag, t.name),
        el('span', { class: 'poll__name' }, t.name),
        el('span', { class: 'poll__pct' }, `${pct}%`),
      ]),
    )
  }
  const foot = el('button', { class: 'poll__foot', type: 'button' },
    `${total.toLocaleString()} votes · tap to refresh`)
  foot.addEventListener('click', async () => {
    foot.textContent = 'Refreshing…'
    render(box, conf, active, await fetchVotes(active.stage), myVote)
  })
  box.appendChild(foot)
}

function vote(box, conf, active, votes, name) {
  localStorage.setItem(voteKey(active.stage), name)
  votes[name] = (votes[name] || 0) + 1 // optimistic; the POST below persists it
  render(box, conf, active, votes, name)
  if (POLL_URL) {
    fetch(`${POLL_URL}?stage=${active.stage}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice: name }),
    }).catch(() => {})
  }
}
