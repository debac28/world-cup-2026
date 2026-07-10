// Shared renderers used across views.
import { el, flag } from './dom.js'
import { fmtTime, relativeHint, REGION } from './time.js'
import { shareAnchor } from './share.js'
import { officialBrand, validCandidate, isGlobalChannel } from '../../scripts/lib/highlights.mjs'
import { commentaryBand } from './commentary.js'
import { fetchMatchDetail } from './matchstats.js'

// Minimal calendar-with-plus glyph (currentColor stroke), used by the country "add all to
// calendar" button in the Fixtures tab.
const CALENDAR_PLUS_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4M16 2v4M3 10h18"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M12 14.5v4M10 16.5h4"/></svg>'

export function calendarPlusIcon() {
  return el('span', { class: 'cal-ico', html: CALENDAR_PLUS_SVG })
}

// One match row: flags + names on each side, score or kickoff time in the middle.
export function matchRow(m, { showRound = false, showPrediction = false, showCommentary = false } = {}) {
  const score = scoreCell(m)
  const homeWin = m.finished && m.homeGoals > m.awayGoals
  const awayWin = m.finished && m.awayGoals > m.homeGoals
  // Win % sits next to each team's rank, only on upcoming matches where opted in. Sourced from
  // the DraftKings line (via ESPN) when available, falling back to an Elo estimate.
  const prob = showPrediction && !m.finished && !m.live ? m.winProb : null

  const state = m.live ? 'match--live' : m.finished ? 'match--done' : ''
  return el('article', { class: `match ${state}` }, [
    el('div', { class: 'match__top' }, [
      el('span', { class: 'match__num' }, `Match ${m.id}`),
      showRound && m.roundName
        ? el('span', { class: 'match__round' }, m.roundName)
        : null,
    ]),
    el('div', { class: 'match__body' }, [
      side(m.home, m.homeFlag, homeWin, 'home', m.homeRank, prob?.home, m.redHome),
      score,
      side(m.away, m.awayFlag, awayWin, 'away', m.awayRank, prob?.away, m.redAway),
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
    showCommentary && m.live ? commentaryBand(m) : null,
    // Lineups + team stats (possession, passes, fouls…), lazy-loaded from ESPN on expand.
    // Finished matches only — during play the live commentary carries the card; adding the
    // full stats+lineups panel too is too much data on a phone. The ESPN event id is resolved
    // on expand (from m.espnId when present, else by match date), so it works for every match.
    m.finished ? matchDetails(m) : null,
  ])
}

// Collapsible per-match detail. The heavy data (lineups + full team stats) is fetched from
// ESPN's per-match summary only on first expand — kept out of live.json to keep the feed lean.
function matchDetails(m) {
  const panel = el('div', { class: 'mdet__panel' })
  let loaded = false
  const btn = el(
    'button',
    { class: 'mdet__toggle', type: 'button' },
    'Match details ▾',
  )
  btn.addEventListener('click', async () => {
    const open = panel.classList.toggle('mdet__panel--open')
    btn.textContent = open ? 'Hide match details ▴' : 'Match details ▾'
    if (!open || loaded) return
    loaded = true
    panel.replaceChildren(el('div', { class: 'mdet__msg' }, 'Loading…'))
    try {
      const d = await fetchMatchDetail(m)
      const nodes = detailNodes(d)
      panel.replaceChildren(...(nodes.length ? nodes : [el('div', { class: 'mdet__msg' }, 'No details yet.')]))
    } catch {
      loaded = false // let a retry re-fetch
      panel.replaceChildren(el('div', { class: 'mdet__msg' }, 'Stats unavailable right now.'))
    }
  })
  return el('div', { class: 'mdet' }, [btn, panel])
}

function detailNodes(d) {
  const nodes = []
  if (d.stats.length) nodes.push(el('div', { class: 'stats' }, d.stats.map(statBar)))
  const { home, away } = d.lineups
  if (home.starters.length || away.starters.length) {
    nodes.push(
      el('div', { class: 'lineups' }, [lineupCol(home, 'home'), lineupCol(away, 'away')]),
    )
  }
  return nodes
}

// One stat as a two-sided comparison bar: home value | label | away value, with a bar split
// proportionally between the two (50/50 when both are zero so it never collapses).
function statBar(row) {
  const total = row.hn + row.an
  const hp = total ? Math.round((row.hn / total) * 100) : 50
  return el('div', { class: 'stat' }, [
    el('div', { class: 'stat__row' }, [
      el('span', { class: 'stat__v' }, row.home),
      el('span', { class: 'stat__label' }, row.label),
      el('span', { class: 'stat__v' }, row.away),
    ]),
    el('div', { class: 'stat__bar' }, [
      el('span', { class: 'stat__fill stat__fill--home', style: `width:${hp}%` }),
      el('span', { class: 'stat__fill stat__fill--away', style: `width:${100 - hp}%` }),
    ]),
  ])
}

function lineupCol(lu, which) {
  const player = (p) =>
    el('li', { class: `lp ${p.subbedOut ? 'lp--off' : ''}` }, [
      el('span', { class: 'lp__num' }, String(p.num)),
      el('span', { class: 'lp__name' }, p.name),
      p.pos ? el('span', { class: 'lp__pos' }, p.pos) : null,
    ])
  return el('div', { class: `lineup lineup--${which}` }, [
    el('div', { class: 'lineup__head' }, [
      el('span', { class: 'lineup__team' }, lu.team),
      lu.formation ? el('span', { class: 'lineup__form' }, lu.formation) : null,
    ]),
    el('ul', { class: 'lineup__xi' }, lu.starters.map(player)),
    lu.subs.length
      ? el('div', { class: 'lineup__subs' }, [
          el('div', { class: 'lineup__subs-h' }, 'Subs used'),
          el('ul', { class: 'lineup__xi' }, lu.subs.map(player)),
        ])
      : null,
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
  const clips = [...(m.highlights?.US || []), ...(m.highlights?.INTL || [])].filter(
    (c) => validCandidate(c, m.home, m.away) && !seen.has(c.videoId) && seen.add(c.videoId),
  )
  // International viewers can't play the US broadcasters (FOX/ESPN/Telemundo geo-lock), so put
  // a globally-playable clip (FIFA) first — it becomes their primary "Watch highlights" CTA.
  // US viewers keep FOX first (their broadcaster, free to them).
  if (REGION !== 'US') {
    clips.sort((a, b) => Number(isGlobalChannel(b.channel)) - Number(isGlobalChannel(a.channel)))
  }
  return clips
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

function side(name, code, winner, which, rank, prob, reds) {
  const meta = []
  if (rank) meta.push(el('span', { class: 'team__rank', title: 'FIFA World Ranking' }, `#${rank}`))
  if (prob != null)
    meta.push(el('span', { class: 'team__prob', title: 'Win chance (DraftKings line via ESPN)' }, `${prob}%`))
  // Red-card marker (one red square per sending-off; a count when a side has more than one).
  // Player + minute go in the tooltip. Lives on the meta line so it inherits home/away alignment.
  if (reds?.length) {
    const tip = reds
      .map((r) => `Red card${r.name ? ` — ${r.name}` : ''}${r.min ? ` (${r.min})` : ''}`)
      .join('\n')
    meta.push(
      el('span', { class: 'team__red', title: tip }, reds.length > 1 ? String(reds.length) : ''),
    )
  }
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
  // During a paused-clock break the minute drops out, so name the break ("⏸ Half-time")
  // instead — otherwise users see a stalled "LIVE" with no minute and assume it's broken.
  if (m.live) {
    const BREAKS = { HT: 'Half-time', BT: 'Break' }
    const brk = BREAKS[m.statusCode]
    if (brk) return el('span', { class: 'badge badge--break' }, `⏸ ${brk}`)
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
