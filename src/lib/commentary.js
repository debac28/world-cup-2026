// Live text play-by-play for an in-progress match, fetched straight from ESPN's free,
// keyless, CORS-open soccer feed (same source as scores) — no backend involved. A small
// "Live Commentary" band on the Today tab expands into a rolling, newest-first feed and
// polls every 30s while open (so it's never more than ~30s behind), stopping when collapsed.
import { el } from './dom.js'
import { norm } from '../../scripts/lib/map.mjs'

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard'
const summaryUrl = (id) =>
  `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${id}`

const POLL_MS = 30_000

// Resolve the ESPN event id for a match by its two (normalized) team names. Done once per
// open; after that we poll only the lighter summary endpoint.
async function findEventId(home, away) {
  const res = await fetch(SCOREBOARD)
  if (!res.ok) return null
  const { events = [] } = await res.json()
  const want = new Set([norm(home), norm(away)])
  for (const e of events) {
    const comps = e.competitions?.[0]?.competitors || []
    const names = comps.map((c) => norm(c.team?.displayName || c.team?.name))
    if (names.length === 2 && names.every((n) => want.has(n))) return e.id
  }
  return null
}

// Newest-first [{ minute, text }]; ESPN returns it chronological, so reverse.
async function fetchCommentary(eventId) {
  const res = await fetch(summaryUrl(eventId))
  if (!res.ok) return null
  const { commentary } = await res.json()
  if (!commentary?.length) return null
  return commentary
    .map((c) => ({ minute: c.time?.displayValue || '', text: (c.text || '').trim() }))
    .filter((c) => c.text)
    .reverse()
}

// A collapsible "Live Commentary" band for a live match card. Self-contained: owns its own
// fetch + polling lifecycle, started on expand and cleared on collapse.
export function commentaryBand(m) {
  const list = el('div', { class: 'cmty__list' })
  const chev = el('span', { class: 'cmty__chev' }, '▾')
  const refreshBtn = el(
    'button',
    { class: 'cmty__refresh', type: 'button', onclick: () => poll() },
    '↻ Refresh',
  )
  const panel = el('div', { class: 'cmty__panel', hidden: 'hidden' }, [
    el('div', { class: 'cmty__bar' }, [refreshBtn]),
    list,
  ])

  let eventId = null
  let timer = null
  let open = false

  function setNote(text) {
    list.replaceChildren(el('div', { class: 'cmty__note' }, text))
  }

  // ESPN starts a goal line with "Goal!"; make it pop with emoji + a gold-highlighted row.
  function row(c) {
    const goal = /^goal!?/i.test(c.text)
    const text = goal ? c.text.replace(/^goal!?/i, '⚽ GOAL! 🎉') : c.text
    return el('div', { class: `cmty__row${goal ? ' cmty__row--goal' : ''}` }, [
      el('span', { class: 'cmty__min' }, c.minute || '·'),
      el('span', { class: 'cmty__text' }, text),
    ])
  }

  async function refresh() {
    // The top-right global refresh re-renders the view, detaching this band but leaving the
    // poll interval running against orphaned nodes — stop it once we're off the page.
    if (!list.isConnected) return stop()
    try {
      if (!eventId) eventId = await findEventId(m.home, m.away)
      if (!eventId) return setNote('Commentary not available for this match yet.')
      const items = await fetchCommentary(eventId)
      if (!items) return setNote('Waiting for the first commentary updates…')
      list.replaceChildren(...items.map(row))
    } catch {
      setNote('Could not load commentary — will retry.')
    }
  }

  // Manual refresh, also resetting the auto-poll clock so the next tick is a full interval away.
  function poll() {
    refresh()
    if (open) {
      clearInterval(timer)
      timer = setInterval(refresh, POLL_MS)
    }
  }

  function stop() {
    clearInterval(timer)
    timer = null
  }

  const band = el(
    'button',
    {
      class: 'cmty__toggle',
      type: 'button',
      onclick: () => {
        open = !open
        panel.hidden = !open
        band.classList.toggle('is-open', open)
        chev.textContent = open ? '▴' : '▾'
        if (open) {
          setNote('Loading commentary…')
          poll()
        } else {
          stop()
        }
      },
    },
    [el('span', { class: 'cmty__dot' }), el('span', {}, 'Live Commentary'), chev],
  )

  return el('div', { class: 'cmty' }, [band, panel])
}
