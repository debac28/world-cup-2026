// Shared renderers used across views.
import { el, flag } from './dom.js'
import { fmtTime, relativeHint, REGION } from './time.js'

// One match row: flags + names on each side, score or kickoff time in the middle.
export function matchRow(m, { showRound = false } = {}) {
  const score = scoreCell(m)
  const homeWin = m.finished && m.homeGoals > m.awayGoals
  const awayWin = m.finished && m.awayGoals > m.homeGoals

  return el('article', { class: `match ${m.live ? 'match--live' : ''}` }, [
    el('div', { class: 'match__top' }, [
      el('span', { class: 'match__num' }, `Match ${m.id}`),
      showRound && m.roundName
        ? el('span', { class: 'match__round' }, m.roundName)
        : null,
    ]),
    el('div', { class: 'match__body' }, [
      side(m.home, m.homeFlag, homeWin, 'home', m.homeRank),
      score,
      side(m.away, m.awayFlag, awayWin, 'away', m.awayRank),
    ]),
    el('div', { class: 'match__meta' }, [
      metaText(m),
      m.venue
        ? el('span', { class: 'venue' }, `${m.venue.stadium} · ${m.venue.city}`)
        : null,
    ]),
    highlightLink(m),
  ])
}

// Highlights link for finished matches:
//  - Outside the US: a YouTube *search* link (the US clip is geo-blocked, so the
//    viewer's own YouTube app surfaces a region-playable highlight).
//  - In the US: the exact official video found by the updater.
function highlightLink(m) {
  if (!m.finished) return null

  if (REGION !== 'US') {
    const q = encodeURIComponent(`${m.home} vs ${m.away} 2026 World Cup highlights`)
    return el(
      'a',
      {
        class: 'highlight',
        href: `https://www.youtube.com/results?search_query=${q}`,
        target: '_blank',
        rel: 'noopener',
      },
      [el('span', { class: 'highlight__label' }, '▶ Find highlights on YouTube')],
    )
  }

  const h = m.highlights?.US
  if (!h) return null
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

function side(name, code, winner, which, rank) {
  return el('div', { class: `team team--${which} ${winner ? 'team--win' : ''}` }, [
    flag(code, name),
    el('div', { class: 'team__id' }, [
      el('span', { class: 'team__name' }, name),
      rank ? el('span', { class: 'team__rank', title: 'FIFA ranking' }, `#${rank}`) : null,
    ]),
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
