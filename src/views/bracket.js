import { el, flag } from '../lib/dom.js'
import { sectionTitle } from '../lib/components.js'
import { fmtDay, fmtTime } from '../lib/time.js'

const ROUND_LABEL = {
  R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarterfinals',
  SF: 'Semi-Finals', F: 'Final', '3P': 'Third-Place',
}
// Left half fans R32→SF rightward; right half mirrors it (SF nearest the centre, R32 outermost).
const LEFT_ROUNDS = ['R32', 'R16', 'QF', 'SF']
const RIGHT_ROUNDS = ['SF', 'QF', 'R16', 'R32']

// Walk the seed bracket (it keeps homeSlot/awaySlot like "W74"; the resolved matches drop them).
// Returns: which half each match belongs to, and a vertical `pos` for every match so columns can
// be ordered by tree position instead of kickoff — that's what makes a card line up between the
// two it feeds from. R32 leaves get sequential positions; each parent sits at its children's mean.
function bracketGeom(seedKo) {
  const byId = new Map(seedKo.map((m) => [m.id, m]))
  const feeders = (m) => [m.homeSlot, m.awaySlot]
    .map((s) => /^W(\d+)$/.exec(s || '')?.[1]).filter(Boolean).map(Number)
  const pos = new Map()
  let seq = 0
  const assign = (id) => {
    const m = byId.get(id)
    if (!m) return seq++
    const kids = feeders(m)
    const p = kids.length ? kids.map(assign).reduce((a, b) => a + b, 0) / kids.length : seq++
    pos.set(id, p)
    return p
  }
  const left = new Set(), right = new Set()
  const collect = (id, set) => {
    const m = byId.get(id)
    if (!m) return
    set.add(id)
    for (const f of feeders(m)) collect(f, set)
  }
  collect(101, left)
  collect(102, right)
  assign(101)
  assign(102)
  return { left, right, pos }
}

// Tournament over — every round is decided, so default to the full bracket (all rounds shown).
// The Compact toggle still hides not-yet-known rounds, but there are none left. Persists across
// re-renders.
let full = true

// `highlight` is an optional team name (from the global country dropdown): when set, that
// team's slots are emphasized and cards it isn't in are dimmed, so you can trace its path.
export function renderBracket(model, { highlight = '' } = {}) {
  const wrap = el('div', { class: 'stack' })

  const ko = model.knockoutMatches
  const hl = highlight && ko.some((m) => m.home === highlight || m.away === highlight) ? highlight : ''
  const { left, right, pos } = bracketGeom(model.seed.knockout)

  // Compact view shows a sliding 2-round window per side (≤4 columns total): the earliest
  // not-yet-complete round plus the next one. As a round finishes it's discarded and the
  // following round is revealed. The full view shows every round.
  const ROUND_SEQ = ['R32', 'R16', 'QF', 'SF', 'F']
  const complete = (round) => {
    const g = ko.filter((m) => m.round === round)
    return g.length > 0 && g.every((m) => m.finished)
  }
  let lead = ROUND_SEQ.findIndex((r) => !complete(r))
  if (lead === -1) lead = ROUND_SEQ.length - 1
  const win = new Set([ROUND_SEQ[lead], ROUND_SEQ[lead + 1]].filter(Boolean))
  const visible = (round) => full || win.has(round) || (round === '3P' && win.has('F'))

  wrap.appendChild(el('div', { class: 'bracket-head' }, [
    sectionTitle('Knockout bracket', 'Slots fill in as group & knockout results land'),
    el('button', {
      class: 'chip bracket-toggle',
      onclick: () => { full = !full; wrap.replaceWith(renderBracket(model, { highlight })) },
    }, full ? 'Compact view' : 'Show full bracket'),
  ]))

  const column = (round, ids) => {
    if (!visible(round)) return null
    const games = ko.filter((m) => m.round === round && ids.has(m.id))
      .sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0))
    if (!games.length) return null
    return el('div', { class: `bcol bcol--${round}` }, [
      el('h3', { class: 'bcol__head' }, ROUND_LABEL[round]),
      el('div', { class: 'bcol__games' }, games.map((m) => bracketCard(m, model, hl))),
    ])
  }

  // Centre holds the Final (+ 3rd-place); only render it — and the trophy — once those are in play.
  const centre = visible('F') ? el('div', { class: 'bcentre' }, [
    el('div', { class: 'bcentre__crown' }, '🏆'),
    ...ko.filter((m) => m.round === 'F').map((m) => bracketCard(m, model, hl)),
    ...ko.filter((m) => m.round === '3P').map((m) => bracketCard(m, model, hl)),
  ]) : null

  const bracket = el('div', { class: 'bracket' }, [
    el('div', { class: 'bside bside--left' }, LEFT_ROUNDS.map((r) => column(r, left))),
    centre,
    el('div', { class: 'bside bside--right' }, RIGHT_ROUNDS.map((r) => column(r, right))),
  ])
  wrap.appendChild(bracket)

  // Draw the connector elbows from measured card positions once the bracket is laid out, and
  // redraw on resize. Measuring beats hand-tuned CSS here: the vertical gap between two feeders
  // doubles each round and depends on the live column height, which static pseudo-elements can't track.
  new ResizeObserver(() => drawConnectors(bracket, model.seed.knockout)).observe(bracket)
  return wrap
}

function drawConnectors(bracket, seedKo) {
  bracket.querySelector('.bconns')?.remove()
  const base = bracket.getBoundingClientRect()
  const box = (id) => {
    const c = bracket.querySelector(`[data-mid="${id}"]`)
    if (!c) return null
    const r = c.getBoundingClientRect()
    const x = r.left - base.left + bracket.scrollLeft
    const y = r.top - base.top + bracket.scrollTop
    return { x, y, w: r.width, cy: y + r.height / 2, cx: x + r.width / 2 }
  }
  const SVG = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'bconns')
  svg.setAttribute('width', bracket.scrollWidth)
  svg.setAttribute('height', bracket.scrollHeight)
  for (const ko of seedKo) {
    // W = winner advances; L = loser drops into the third-place match (drawn dashed).
    const feeders = [ko.homeSlot, ko.awaySlot]
      .map((s) => /^([WL])(\d+)$/.exec(s || '')).filter(Boolean)
      .map((m) => ({ id: +m[2], loser: m[1] === 'L' }))
    if (feeders.length !== 2) continue
    const p = box(ko.id)
    if (!p) continue
    for (const { id, loser } of feeders) {
      const f = box(id)
      if (!f) continue
      // Feeder sits left of its parent → exit its right edge into the gap; else mirror it.
      const left = f.cx < p.cx
      const fx = left ? f.x + f.w : f.x
      const px = left ? p.x : p.x + p.w
      const mx = (fx + px) / 2
      const path = document.createElementNS(SVG, 'path')
      path.setAttribute('d', `M ${fx} ${f.cy} H ${mx} V ${p.cy} H ${px}`)
      path.setAttribute('class', loser ? 'bconn bconn--loser' : 'bconn')
      svg.appendChild(path)
    }
  }
  bracket.insertBefore(svg, bracket.firstChild)
}

function bracketCard(m, model, highlight) {
  const dim = highlight && m.home !== highlight && m.away !== highlight
  return el('div', { class: `bcard ${dim ? 'bcard--dim' : ''}`, 'data-mid': m.id }, [
    el('div', { class: 'bcard__top' }, [
      el('span', { class: 'bcard__num' }, `Match ${m.id}`),
      el('span', { class: 'bcard__date' }, m.kickoff ? `${fmtDay(m.kickoff)} · ${fmtTime(m.kickoff)}` : 'TBD'),
    ]),
    slot(m.home, m.homeFlag, model, m, 'home', highlight),
    slot(m.away, m.awayFlag, model, m, 'away', highlight),
    m.venue ? el('div', { class: 'bcard__venue' }, m.venue.city) : null,
  ])
}

function slot(team, code, model, m, which, highlight) {
  const resolved = model.flagOf.has(team)
  const goals = which === 'home' ? m.homeGoals : m.awayGoals
  const other = which === 'home' ? m.awayGoals : m.homeGoals
  const win = m.finished && goals != null && goals > other
  const hl = highlight && team === highlight
  return el('div', { class: `bslot ${resolved ? '' : 'bslot--tbd'} ${win ? 'bslot--win' : ''} ${hl ? 'bslot--hl' : ''}` }, [
    flag(code, team),
    el('span', { class: 'bslot__name' }, team),
    goals != null ? el('span', { class: 'bslot__score' }, String(goals)) : null,
  ])
}
