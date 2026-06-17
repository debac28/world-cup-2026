// Shared renderers used across views.
import { el, flag } from './dom.js'
import { fmtTime, relativeHint, REGION } from './time.js'
import { shareAnchor } from './share.js'
import { officialBrand, validCandidate } from '../../scripts/lib/highlights.mjs'

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
      // Finished cards show the score in the middle (not the kickoff time), so surface
      // the local kickoff time here too — otherwise you can't tell when it started.
      m.finished
        ? el('span', { class: 'kickoff-note' }, `Kicked off ${fmtTime(m.kickoff)}`)
        : null,
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

// All captured official clips for a match — the US- and INTL-region searches combined and
// de-duped by video id. The data layer keeps only the four official channels, so the same set
// is safe to show every region: US viewers play them directly; international viewers get them
// too, plus a YouTube search-link fallback for clips that are geo-blocked where they are.
function officialClips(m) {
  const seen = new Set()
  return [...(m.highlights?.US || []), ...(m.highlights?.INTL || [])].filter(
    (c) => validCandidate(c, m.home, m.away) && !seen.has(c.videoId) && seen.add(c.videoId),
  )
}

// Highlight URL for sharing, mirroring what the sharer sees on the card: the top official
// video when known (and the viewer is in the US), else a region-safe YouTube search that
// resolves a playable clip anywhere.
function highlightUrl(m) {
  const top = officialClips(m)[0]
  if (REGION === 'US' && top) return ytWatchUrl(top)
  return ytSearchUrl(m)
}

function ytWatchUrl(c) {
  return `https://www.youtube.com/watch?v=${c.videoId}`
}
function ytSearchUrl(m) {
  const q = encodeURIComponent(`${m.home} vs ${m.away} 2026 World Cup highlights`)
  return `https://www.youtube.com/results?search_query=${q}`
}

// Short source label for a fallback chip. Official rights-holders get their broadcaster brand
// (matched on the exact channel name, so a bait channel can't pose as one); anyone else shows
// their real, truncated channel name — never anything derived from the video title.
function highlightSource(c) {
  const brand = officialBrand(c.channel)
  if (brand) return brand
  const first = (c.channel || 'Watch').split(/\s+/)[0]
  return first.length > 11 ? first.slice(0, 11) : first
}

// Exact Wikipedia article URL from a verified title (spaces -> underscores).
export function playerWikiUrl(wiki) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(wiki.replace(/ /g, '_'))}`
}

// A player name. Linked to Wikipedia ONLY when the data pipeline verified a real article
// (`wiki` = the canonical title); otherwise rendered as plain text, so we never send anyone
// to a dead search page for a player who has no article.
export function playerLink(name, wiki, cls = 'player-link') {
  if (!wiki) return el('span', { class: 'player-name' }, name)
  return el(
    'a',
    { class: cls, href: playerWikiUrl(wiki), target: '_blank', rel: 'noopener' },
    name,
  )
}

// Goal scorers grouped by side: home goals left, away goals right ("Player min'").
// Only rendered once a match has goal data; absent for scheduled/in-progress matches.
function scorerList(m) {
  if (!m.goals?.length) return null
  const fmt = (g) =>
    el('li', {}, [
      playerLink(g.player, g.wiki),
      `${g.og ? ' (OG)' : ''}${g.pen ? ' (P)' : ''} ${g.minute}'`,
    ])
  const home = m.goals.filter((g) => g.home).map(fmt)
  const away = m.goals.filter((g) => !g.home).map(fmt)
  return el('div', { class: 'scorers-line' }, [
    el('ul', { class: 'scorers-line__side scorers-line__home' }, home),
    el('span', { class: 'scorers-line__ball' }, '⚽'),
    el('ul', { class: 'scorers-line__side scorers-line__away' }, away),
  ])
}

// A single alternate-source chip linking to one official YouTube clip.
function altChip(c) {
  return el(
    'a',
    {
      class: 'chip',
      href: ytWatchUrl(c),
      target: '_blank',
      rel: 'noopener',
      title: c.title || c.channel || 'Highlights',
    },
    `▸ ${highlightSource(c)}`,
  )
}

// Fallback chip linking to a YouTube *search* — shown to international viewers so they can find
// a clip playable in their country when the official ones are geo-blocked.
function searchChip(m) {
  return el(
    'a',
    { class: 'chip', href: ytSearchUrl(m), target: '_blank', rel: 'noopener', title: 'Search YouTube' },
    '▸ Search YouTube',
  )
}

// Highlights for finished matches — official clips only (FOX / FIFA / ESPN / Telemundo; the
// data layer has dropped everything else). The first clip is the primary CTA, the rest are
// fallback chips for a geo-blocked clip. US viewers can watch their broadcaster's clip for
// free, so they get no search link; international viewers also get a YouTube *search* link,
// since the official clips may be geo-blocked where they are.
function highlightLink(m) {
  if (!m.finished) return null
  const cands = officialClips(m)
  const intl = REGION !== 'US'

  if (!cands.length) {
    // No official clip captured: international viewers still get the search link; US gets nothing.
    if (!intl) return null
    return el('div', { class: 'highlights' }, [
      el(
        'a',
        { class: 'highlight', href: ytSearchUrl(m), target: '_blank', rel: 'noopener' },
        [el('span', { class: 'highlight__label' }, '▶ Find highlights on YouTube')],
      ),
    ])
  }

  const [primary, ...alts] = cands
  const extras = alts.map(altChip)
  if (intl) extras.push(searchChip(m))

  return el('div', { class: 'highlights' }, [
    el(
      'a',
      { class: 'highlight', href: ytWatchUrl(primary), target: '_blank', rel: 'noopener' },
      [
        primary.thumbnail
          ? el('img', { class: 'highlight__thumb', src: primary.thumbnail, alt: '', loading: 'lazy' })
          : null,
        el('span', { class: 'highlight__label' }, '▶ Watch highlights'),
      ],
    ),
    extras.length
      ? el('div', { class: 'highlight-alts' }, [
          el('span', { class: 'highlight-alts__label' }, "Won't play?"),
          ...extras,
        ])
      : null,
  ])
}

function side(name, code, winner, which, rank, prob) {
  const meta = []
  if (rank) meta.push(el('span', { class: 'team__rank', title: 'FIFA World Ranking' }, `#${rank}`))
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
    const pens = m.homePens != null && m.awayPens != null
    return el('div', { class: 'score' }, [
      el('span', { class: 'score__n' }, String(m.homeGoals)),
      el('span', { class: 'score__sep' }, '–'),
      el('span', { class: 'score__n' }, String(m.awayGoals)),
      // Shootout result on knockout matches that went to penalties.
      pens ? el('span', { class: 'score__pens' }, `(${m.homePens}–${m.awayPens} pens)`) : null,
    ])
  }
  return el('div', { class: 'score score--time' }, fmtTime(m.kickoff))
}

function metaText(m) {
  // Live badge shows the elapsed minute from FIFA when we have it ("● 87'"), else "● LIVE".
  if (m.live) {
    return el('span', { class: 'badge badge--live' }, m.minute ? `● ${m.minute}'` : '● LIVE')
  }
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
