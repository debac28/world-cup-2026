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
    grid.appendChild(groupTable(g, model.standings[g], model.flagOf, model.thirdProbs?.get(g)))
  }
  wrap.appendChild(grid)
  return wrap
}

// Format a 0..1 qualification chance for the 3rd-placed badge. Cap at 99% / floor at 1%
// so it never reads a misleading "100%"/"0%" while still fitting in the narrow badge.
function fmtProb(p) {
  const pct = p * 100
  if (pct >= 99) return '99%'
  if (pct > 0 && pct < 1) return '1%'
  return `${Math.round(pct)}%`
}

// A few official names are too long for the narrow team column; show a short label.
const SHORT_NAME = { 'Bosnia and Herzegovina': 'Bosnia & Herz.' }

function groupTable(g, rows, flagOf, thirdProb) {
  const head = el('tr', {}, [
    th('#'), th('Team', 'left'), th('Pl'), th('W'), th('D'), th('L'),
    th('GF'), th('GA'), th('GD'), th('Pts'),
  ])

  const body = rows.map((r, i) => {
    const cls = i < 2 ? 'qual' : i === 2 ? 'playoff' : 'out'
    // The 3rd-placed team of a finished group shows its chance of being a best-third
    // qualifier — but only while undecided (once green/red it's resolved, so drop the %).
    const showProb = i === 2 && thirdProb != null && !r.clinched && !r.eliminated
    return el('tr', { class: `srow srow--${cls}` }, [
      td(String(i + 1)),
      el('td', { class: 'left team-cell' }, [
        flag(flagOf.get(r.team), r.team),
        el('span', { class: 'team-name' }, SHORT_NAME[r.team] || r.team),
        r.clinched
          ? el('span', { class: 'qual-check', title: 'Qualified for the knockout stage' }, '✓')
          : null,
        r.eliminated
          ? el('span', { class: 'elim-cross', title: 'Eliminated' }, '✗')
          : null,
        showProb
          ? el(
              'span',
              {
                class: 'third-prob',
                title:
                  'Estimated chance of qualifying as one of the 8 best 3rd-placed teams — ' +
                  '4,000 simulations of the remaining group matches (goals modelled from FIFA ratings).',
              },
              fmtProb(thirdProb),
            )
          : null,
      ]),
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
