// Shared renderers used across views.
import { el, flag } from './dom.js'
import { fmtTime, relativeHint } from './time.js'

// One match row: flags + names on each side, score or kickoff time in the middle.
export function matchRow(m, { showRound = false } = {}) {
  const score = scoreCell(m)
  const homeWin = m.finished && m.homeGoals > m.awayGoals
  const awayWin = m.finished && m.awayGoals > m.homeGoals

  return el('article', { class: `match ${m.live ? 'match--live' : ''}` }, [
    showRound && m.roundName
      ? el('div', { class: 'match__round' }, m.roundName)
      : null,
    el('div', { class: 'match__body' }, [
      side(m.home, m.homeFlag, homeWin, 'home'),
      score,
      side(m.away, m.awayFlag, awayWin, 'away'),
    ]),
    el('div', { class: 'match__meta' }, [
      metaText(m),
      m.venue
        ? el('span', { class: 'venue' }, `${m.venue.stadium} · ${m.venue.city}`)
        : null,
    ]),
    m.highlight ? highlightLink(m.highlight) : null,
  ])
}

function highlightLink(h) {
  return el(
    'a',
    {
      class: 'highlight',
      href: `https://www.youtube.com/watch?v=${h.videoId}`,
      target: '_blank',
      rel: 'noopener',
    },
    [
      h.thumbnail
        ? el('img', { class: 'highlight__thumb', src: h.thumbnail, alt: '', loading: 'lazy' })
        : null,
      el('span', { class: 'highlight__label' }, '▶ Watch highlights'),
    ],
  )
}

function side(name, code, winner, which) {
  return el('div', { class: `team team--${which} ${winner ? 'team--win' : ''}` }, [
    flag(code, name),
    el('span', { class: 'team__name' }, name),
  ])
}

function scoreCell(m) {
  if (m.homeGoals != null && m.awayGoals != null) {
    return el('div', { class: 'score' }, [
      el('span', { class: 'score__n' }, String(m.homeGoals)),
      el('span', { class: 'score__sep' }, '–'),
      el('span', { class: 'score__n' }, String(m.awayGoals)),
    ])
  }
  return el('div', { class: 'score score--time' }, fmtTime(m.kickoff))
}

function metaText(m) {
  if (m.live) return el('span', { class: 'badge badge--live' }, '● LIVE')
  if (m.finished) return el('span', { class: 'badge badge--ft' }, 'Full time')
  const hint = relativeHint(m.kickoff)
  return el('span', { class: 'badge' }, hint || fmtTime(m.kickoff))
}

export function sectionTitle(text, sub) {
  return el('div', { class: 'section-title' }, [
    el('h2', {}, text),
    sub ? el('p', {}, sub) : null,
  ])
}
