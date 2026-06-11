import { el, flag } from '../lib/dom.js'
import { sectionTitle } from '../lib/components.js'

// Top 2 of each group qualify directly; the 8 best 3rd-placed teams also advance.
export function renderGroups(model) {
  const wrap = el('div', { class: 'stack' })
  wrap.appendChild(
    sectionTitle(
      'Group standings',
      'Top 2 advance · 8 best 3rd-placed teams also qualify',
    ),
  )

  const grid = el('div', { class: 'groupgrid' })
  for (const g of Object.keys(model.groups).sort()) {
    grid.appendChild(groupTable(g, model.standings[g], model.flagOf))
  }
  wrap.appendChild(grid)
  return wrap
}

function groupTable(g, rows, flagOf) {
  const head = el('tr', {}, [
    th('#'), th('Team', 'left'), th('Pl'), th('W'), th('D'), th('L'),
    th('GF'), th('GA'), th('GD'), th('Pts'),
  ])

  const body = rows.map((r, i) => {
    const cls = i < 2 ? 'qual' : i === 2 ? 'playoff' : 'out'
    return el('tr', { class: `srow srow--${cls}` }, [
      td(String(i + 1)),
      el('td', { class: 'left team-cell' }, [flag(flagOf.get(r.team), r.team), r.team]),
      td(String(r.played)), td(String(r.win)), td(String(r.draw)), td(String(r.loss)),
      td(String(r.gf)), td(String(r.ga)), td(fmtGD(r.gd)), el('td', { class: 'pts' }, String(r.points)),
    ])
  })

  return el('div', { class: 'card group' }, [
    el('div', { class: 'group__head' }, `Group ${g}`),
    el('table', { class: 'standings' }, [
      el('thead', {}, head),
      el('tbody', {}, body),
    ]),
  ])
}

const fmtGD = (n) => (n > 0 ? `+${n}` : String(n))
const th = (t, align) => el('th', { class: align || '' }, t)
const td = (t) => el('td', {}, t)
