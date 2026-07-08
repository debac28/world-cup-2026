import { el, empty } from '../lib/dom.js'
import { matchRow, sectionTitle } from '../lib/components.js'
import { pollCard } from './poll.js'
import { LOCAL_TZ, fmtFullDay, todayKey, localDayKey } from '../lib/time.js'

export function renderToday(model) {
  const now = new Date()
  const key = todayKey(now)
  // Three tiers, top to bottom: live, then upcoming, then finished — so an in-progress game
  // is always at the top, the next kickoff sits just below it (or at the very top once nothing
  // is live), and already-played matches drop to the bottom. Within each tier, order by
  // kickoff (also the tiebreaker when two games are live in parallel — both stay pinned up top).
  const tier = (m) => (m.live ? 0 : m.finished ? 2 : 1)
  const today = model.matches
    .filter((m) => m.kickoff && localDayKey(m.kickoff) === key)
    .sort((a, b) => tier(a) - tier(b) || a.kickoff - b.kickoff)

  const frag = el('div', { class: 'stack' })
  frag.appendChild(
    sectionTitle(fmtFullDay(now), `Times shown in your timezone · ${LOCAL_TZ}`),
  )

  if (today.length) {
    for (const m of today) frag.appendChild(matchRow(m, { showRound: true, showPrediction: true, showCommentary: true }))
  } else {
    frag.appendChild(empty('No matches today.'))
    const next = nextMatchDay(model, key)
    if (next) {
      frag.appendChild(sectionTitle('Next match day', fmtFullDay(next.date)))
      for (const m of next.matches) frag.appendChild(matchRow(m, { showRound: true }))
    }
    // Only on no-match days: a "who wins the cup?" poll over the teams still alive.
    const poll = pollCard(model)
    if (poll) frag.appendChild(poll)
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
