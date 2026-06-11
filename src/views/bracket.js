import { el, flag } from '../lib/dom.js'
import { sectionTitle } from '../lib/components.js'
import { fmtDay, fmtTime } from '../lib/time.js'

const ROUND_ORDER = ['R32', 'R16', 'QF', 'SF', 'F', '3P']
const ROUND_LABEL = {
  R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarterfinals',
  SF: 'Semi-Finals', F: 'Final', '3P': 'Third-Place Play-Off',
}

export function renderBracket(model) {
  const wrap = el('div', { class: 'stack' })
  wrap.appendChild(
    sectionTitle('Knockout bracket', 'Slots fill in as group & knockout results land'),
  )

  const ko = model.knockoutMatches
  const cols = el('div', { class: 'bracket' })
  for (const r of ROUND_ORDER) {
    const games = ko.filter((m) => m.round === r).sort((a, b) => a.kickoff - b.kickoff)
    if (!games.length) continue
    cols.appendChild(
      el('div', { class: `bcol bcol--${r}` }, [
        el('h3', { class: 'bcol__head' }, ROUND_LABEL[r]),
        ...games.map((m) => bracketCard(m, model)),
      ]),
    )
  }
  wrap.appendChild(cols)
  return wrap
}

function bracketCard(m, model) {
  return el('div', { class: 'bcard' }, [
    el('div', { class: 'bcard__date' }, m.kickoff ? `${fmtDay(m.kickoff)} · ${fmtTime(m.kickoff)}` : 'TBD'),
    slot(m.home, m.homeFlag, model, m, 'home'),
    slot(m.away, m.awayFlag, model, m, 'away'),
    m.venue ? el('div', { class: 'bcard__venue' }, m.venue.city) : null,
  ])
}

function slot(team, code, model, m, which) {
  const resolved = model.flagOf.has(team)
  const goals = which === 'home' ? m.homeGoals : m.awayGoals
  const other = which === 'home' ? m.awayGoals : m.homeGoals
  const win = m.finished && goals != null && goals > other
  return el('div', { class: `bslot ${resolved ? '' : 'bslot--tbd'} ${win ? 'bslot--win' : ''}` }, [
    flag(code, team),
    el('span', { class: 'bslot__name' }, team),
    goals != null ? el('span', { class: 'bslot__score' }, String(goals)) : null,
  ])
}
