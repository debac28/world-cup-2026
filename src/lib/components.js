// Shared renderers used across views.
import { el, flag } from './dom.js'
import { fmtTime, relativeHint, REGION } from './time.js'
import { shareAnchor } from './share.js'

// One match row: flags + names on each side, score or kickoff time in the middle.
export function matchRow(m, { showRound = false, showPrediction = false } = {}) {
  const score = scoreCell(m)
  const homeWin = m.finished && m.homeGoals > m.awayGoals
  const awayWin = m.finished && m.awayGoals > m.homeGoals
  // Elo win % sits next to each team's rank, only on upcoming matches where opted in.
  const prob = showPrediction && !m.finished && !m.live ? m.winProb : null

  return el('article', { class: `match ${m.live ? 'match--live' : ''}` }, [
    el('div', { class: 'match__top' }, [
      el('span', { class: 'match__num' }, `Match ${m.id}`),
      showRound && m.roundName
        ? el('span', { class: 'match__round' }, m.roundName)
        : null,
    ]),
    el('div', { class: 'match__body' }, [
      side(m.home, m.homeFlag, homeWin, 'home', m.homeRank, prob?.home),
      score,
      side(m.away, m.awayFlag, awayWin, 'away', m.awayRank, prob?.away),
    ]),
    scorerList(m),
    el('div', { class: 'match__meta' }, [
      metaText(m),
      m.venue
        ? el('span', { class: 'venue' }, `${m.venue.stadium} · ${m.venue.city}`)
        : null,
    ]),
    shareScoreLink(m),
    highlightLink(m),
  ])
}

// Score share for FINISHED matches: send a friend the final result plus a highlights
// link. Upcoming matches have no location to coordinate around — that "watch together"
// job now lives entirely in the Watch tab — so they carry no share button. Plain text +
// link (no og card): the highlight URL is the point of the message.
function shareScoreLink(m) {
  if (!m.finished) return null
  const stage = m.roundName || 'Group stage'
  const text =
    `⚽ ${m.home} ${m.homeGoals}–${m.awayGoals} ${m.away}\n` +
    `${stage} · Full time\n` +
    `▶ Highlights: ${highlightUrl(m)}`
  return el(
    'a',
    { class: 'match__share', ...shareAnchor(text, { image: false }) },
    '↗ Share result',
  )
}

// Highlight URL for sharing, mirroring what the sharer sees on the card: the exact US
// video when known (and the viewer is in the US), else a region-safe YouTube search that
// resolves a playable clip anywhere.
function highlightUrl(m) {
  const h = m.highlights?.US
  if (REGION === 'US' && h) return `https://www.youtube.com/watch?v=${h.videoId}`
  const q = encodeURIComponent(`${m.home} vs ${m.away} 2026 World Cup highlights`)
  return `https://www.youtube.com/results?search_query=${q}`
}

// Goal scorers grouped by side: home goals left, away goals right ("Player min'").
// Only rendered once a match has goal data; absent for scheduled/in-progress matches.
function scorerList(m) {
  if (!m.goals?.length) return null
  const fmt = (g) =>
    el('li', {}, `${g.player}${g.og ? ' (OG)' : ''}${g.pen ? ' (P)' : ''} ${g.minute}'`.trim())
  const home = m.goals.filter((g) => g.home).map(fmt)
  const away = m.goals.filter((g) => !g.home).map(fmt)
  return el('div', { class: 'scorers-line' }, [
    el('ul', { class: 'scorers-line__side scorers-line__home' }, home),
    el('span', { class: 'scorers-line__ball' }, '⚽'),
    el('ul', { class: 'scorers-line__side scorers-line__away' }, away),
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

function side(name, code, winner, which, rank, prob) {
  const meta = []
  if (rank) meta.push(el('span', { class: 'team__rank', title: 'FIFA ranking' }, `#${rank}`))
  if (prob != null)
    meta.push(el('span', { class: 'team__prob', title: 'Win chance (Elo, from FIFA points)' }, `${prob}%`))
  return el('div', { class: `team team--${which} ${winner ? 'team--win' : ''}` }, [
    flag(code, name),
    el('div', { class: 'team__id' }, [
      el('span', { class: 'team__name' }, name),
      meta.length ? el('div', { class: 'team__meta' }, meta) : null,
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
