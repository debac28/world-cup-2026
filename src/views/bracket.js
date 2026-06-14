import { el, flag } from '../lib/dom.js'
import { sectionTitle } from '../lib/components.js'
import { fmtDay, fmtTime } from '../lib/time.js'

const ROUND_ORDER = ['R32', 'R16', 'QF', 'SF', 'F', '3P']
const ROUND_LABEL = {
  R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarterfinals',
  SF: 'Semi-Finals', F: 'Final', '3P': 'Third-Place Play-Off',
}

// `highlight` is an optional team name (from the global country dropdown): when set, that
// team's slots are emphasized and cards it isn't in are dimmed, so you can trace its path.
export function renderBracket(model, { highlight = '' } = {}) {
  const wrap = el('div', { class: 'stack' })
  wrap.appendChild(
    sectionTitle('Knockout bracket', 'Slots fill in as group & knockout results land'),
  )

  const ko = model.knockoutMatches
  // Only highlight if the team has actually reached the bracket — otherwise (e.g. during
  // the group stage, when every slot is still a label) dimming would fade the whole tree.
  const hl = highlight && ko.some((m) => m.home === highlight || m.away === highlight) ? highlight : ''
  const cols = el('div', { class: 'bracket' })
  for (const r of ROUND_ORDER) {
    const games = ko.filter((m) => m.round === r).sort((a, b) => a.kickoff - b.kickoff)
    if (!games.length) continue
    cols.appendChild(
      el('div', { class: `bcol bcol--${r}` }, [
        el('h3', { class: 'bcol__head' }, ROUND_LABEL[r]),
        ...games.map((m) => bracketCard(m, model, hl)),
      ]),
    )
  }
  wrap.appendChild(cols)
  return wrap
}

function bracketCard(m, model, highlight) {
  const dim = highlight && m.home !== highlight && m.away !== highlight
  return el('div', { class: `bcard ${dim ? 'bcard--dim' : ''}` }, [
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
