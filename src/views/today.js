import { el, empty } from '../lib/dom.js'
import { matchRow, sectionTitle } from '../lib/components.js'
import { LOCAL_TZ, fmtFullDay, todayKey, localDayKey } from '../lib/time.js'

export function renderToday(model) {
  const now = new Date()
  const key = todayKey(now)
  // Live matches first (so an in-progress game is always at the top, even if it kicked
  // off late in the day); within each group, order by kickoff. That kickoff order is also
  // the tiebreaker when two matches are live in parallel — both stay pinned to the top.
  const today = model.matches
    .filter((m) => m.kickoff && localDayKey(m.kickoff) === key)
    .sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0) || a.kickoff - b.kickoff)

  const frag = el('div', { class: 'stack' })
  frag.appendChild(
    sectionTitle(fmtFullDay(now), `Times shown in your timezone · ${LOCAL_TZ}`),
  )

  if (today.length) {
    for (const m of today) frag.appendChild(matchRow(m, { showRound: true, showPrediction: true }))
  } else {
    frag.appendChild(empty('No matches today.'))
    const next = nextMatchDay(model, key)
    if (next) {
      frag.appendChild(sectionTitle('Next match day', fmtFullDay(next.date)))
      for (const m of next.matches) frag.appendChild(matchRow(m, { showRound: true }))
    }
  }
  return frag
}

function nextMatchDay(model, afterKey) {
  const upcoming = model.matches
    .filter((m) => m.kickoff && localDayKey(m.kickoff) > afterKey)
    .sort((a, b) => a.kickoff - b.kickoff)
  if (!upcoming.length) return null
  const dayKey = localDayKey(upcoming[0].kickoff)
  return {
    date: upcoming[0].kickoff,
    matches: upcoming.filter((m) => localDayKey(m.kickoff) === dayKey),
  }
}
