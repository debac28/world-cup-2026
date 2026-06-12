import { el, empty } from '../lib/dom.js'
import { matchRow } from '../lib/components.js'
import { fmtFullDay, localDayKey, todayKey } from '../lib/time.js'

// Two modes:
//   results  — finished + live matches, newest first (latest score on top)
//   fixtures — upcoming matches, soonest first
const MODES = [
  { id: 'results', label: 'Results' },
  { id: 'fixtures', label: 'Fixtures' },
]

let mode = null // chosen on first render based on what data exists
let country = '' // '' = all countries

export function renderMatches(model) {
  const hasResults = model.matches.some((m) => m.finished || m.live)
  if (mode === null) mode = hasResults ? 'results' : 'fixtures'

  const wrap = el('div', { class: 'stack' })

  wrap.appendChild(
    el('div', { class: 'filterbar' }, [
      ...MODES.map((mo) =>
        el(
          'button',
          {
            class: `chip ${mode === mo.id ? 'chip--on' : ''}`,
            onclick: () => {
              mode = mo.id
              wrap.replaceWith(renderMatches(model))
            },
          },
          mo.label,
        ),
      ),
      countryDropdown(model, wrap),
    ]),
  )

  const isResult = (m) => m.finished || m.live
  const list = model.matches
    .filter((m) => m.kickoff && (mode === 'results' ? isResult(m) : !isResult(m)))
    .filter((m) => !country || m.home === country || m.away === country)
    .sort((a, b) => (mode === 'results' ? b.kickoff - a.kickoff : a.kickoff - b.kickoff))

  if (!list.length) {
    const what = mode === 'results' ? 'results' : 'upcoming matches'
    wrap.appendChild(empty(country ? `No ${what} for ${country}.` : `No ${what}.`))
    return wrap
  }

  const today = todayKey()
  let lastDay = null
  for (const m of list) {
    const dk = localDayKey(m.kickoff)
    if (dk !== lastDay) {
      lastDay = dk
      wrap.appendChild(
        el('h3', { class: `dayhead ${dk === today ? 'dayhead--today' : ''}` }, [
          fmtFullDay(m.kickoff),
          dk === today ? el('span', { class: 'pill' }, 'Today') : null,
        ]),
      )
    }
    wrap.appendChild(matchRow(m, { showRound: m.stage === 'knockout' }))
  }
  return wrap
}

function countryDropdown(model, wrap) {
  const teams = model.teams.map((t) => t.name).sort()
  const sel = el('select', {
    class: 'country-select',
    onchange: (e) => {
      country = e.target.value
      wrap.replaceWith(renderMatches(model))
    },
  })
  sel.appendChild(el('option', { value: '' }, 'All countries'))
  for (const name of teams) {
    const opt = el('option', { value: name }, name)
    if (name === country) opt.selected = true
    sel.appendChild(opt)
  }
  return sel
}
