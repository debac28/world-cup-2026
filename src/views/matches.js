import { el, empty } from '../lib/dom.js'
import { matchRow, calendarPlusIcon } from '../lib/components.js'
import { addToCalendar } from '../lib/calendar.js'
import { renderGroups } from './groups.js'
import { fmtFullDay, localDayKey, todayKey } from '../lib/time.js'

// Three sub-tabs:
//   fixtures — upcoming matches, soonest first
//   results  — finished + live matches, newest first (latest score on top)
//   groups   — the group standings table (moved here from the bottom bar now that the
//              knockout bracket took its top-level slot)
const MODES = [
  { id: 'fixtures', label: 'Fixtures' },
  { id: 'results', label: 'Results' },
  { id: 'groups', label: 'Groups' },
]

let mode = null // chosen on first render based on what data exists
let country = '' // '' = all countries

// Let the router preselect a sub-tab (used to redirect legacy #bracket links here).
export function setMatchesMode(m) {
  if (MODES.some((mo) => mo.id === m)) mode = m
}

export function renderMatches(model) {
  if (mode === null) mode = 'fixtures'

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
      mode === 'groups' ? null : countryDropdown(model, wrap),
    ]),
  )

  // Groups sub-tab: render the group standings tables instead of the day-grouped match list.
  if (mode === 'groups') {
    wrap.appendChild(renderGroups(model))
    return wrap
  }

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

  // When viewing a single country's upcoming fixtures, offer to add them all to the calendar
  // in one tap — the headline "follow my team, remind me" flow. One .ics, every match + alarm.
  if (mode === 'fixtures' && country && list.length) {
    const slug = country.replace(/\s+/g, '-').toLowerCase()
    wrap.appendChild(
      el('div', { class: 'cal-allbar' }, [
        el(
          'button',
          {
            type: 'button',
            class: 'cal-all',
            onclick: () => addToCalendar(list, `wc2026-${slug}.ics`),
          },
          [calendarPlusIcon(), `Add ${country}'s matches`],
        ),
      ]),
    )
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
