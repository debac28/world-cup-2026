import { el, empty, clear } from '../lib/dom.js'
import { sectionTitle } from '../lib/components.js'
import { localDayKey, fmtDay, fmtTime } from '../lib/time.js'
import { geocodeZip, geocodeAddress, haversineMiles } from '../lib/geo.js'
import { shareInvite } from '../lib/share.js'

const NEAR_MILES = 50

export function renderWatch(model) {
  const parties = model.watchParties || []
  // Matches still to come (live + scheduled), earliest first — for the top-level "which game?"
  // picker. The chosen match drives both the venue date filter and the share text.
  const upcoming = (model.matches || [])
    .filter((m) => m.kickoff && !m.finished)
    .sort((a, b) => a.kickoff - b.kickoff)

  const wrap = el('div', { class: 'stack' })
  wrap.appendChild(
    sectionTitle('Watch Together', 'Pick a match, then host at your place or find a fan zone'),
  )

  if (!parties.length) {
    wrap.appendChild(empty('Watch-party listings are on the way — check back soon.'))
    return wrap
  }

  const matchSelect = upcoming.length ? buildMatchSelect(upcoming) : null
  if (matchSelect) matchSelect.addEventListener('change', renderList)

  function selectedMatch() {
    if (!matchSelect) return null
    return upcoming.find((m) => String(m.id) === matchSelect.value) || upcoming[0]
  }

  // === "Your place" mode: type any address (worldwide), validate it, share the invite. ===
  const addrInput = el('input', {
    class: 'wp-input',
    type: 'text',
    placeholder: 'Your address',
    'aria-label': 'Your address',
    autocomplete: 'street-address',
  })
  const addrStatus = el('p', { class: 'wp-status' })
  const addrBtn = el('button', { class: 'wp-btn', type: 'button', onclick: shareOwnPlace }, '👋 Share invite')

  async function shareOwnPlace() {
    const q = addrInput.value.trim()
    if (!q) return
    addrStatus.textContent = 'Checking address…'
    let loc
    try {
      loc = await geocodeAddress(q)
    } catch (e) {
      addrStatus.textContent = e.message || "Couldn't find that address"
      return
    }
    addrStatus.textContent = `📍 ${loc.label}`
    const match = selectedMatch()
    const maps = `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`
    const text = match
      ? `⚽ Let's watch ${match.home} vs ${match.away} at my place!\n` +
        `${fmtDay(match.kickoff)}, ${fmtTime(match.kickoff)}\n${loc.label}\n${maps}`
      : `⚽ Let's watch the World Cup at my place!\n${loc.label}\n${maps}`
    shareInvite(text)
  }
  addrInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') shareOwnPlace()
  })

  const ownPanel = el('div', { class: 'wp-mode' }, [
    el('div', { class: 'wp-search__row' }, [addrInput, addrBtn]),
    addrStatus,
    el('p', { class: 'wp-note' }, 'Enter any address worldwide — your guests get the spot and a map link.'),
  ])

  // === "Public viewing area" mode: zip → fan zones & bars, nearest first. ===
  let origin = null // { lat, lng, label } once a zip is resolved
  const zipInput = el('input', {
    class: 'wp-input',
    type: 'text',
    inputmode: 'numeric',
    placeholder: 'Zip code',
    maxlength: '5',
    'aria-label': 'Zip code',
  })
  const searchBtn = el('button', { class: 'wp-btn', type: 'button', onclick: useZip }, '🔍 Search')
  const statusLine = el('p', { class: 'wp-status' })
  const results = el('div', { class: 'wp-results' })

  async function useZip() {
    const z = zipInput.value.trim()
    if (!z) return
    statusLine.textContent = 'Finding…'
    try {
      origin = await geocodeZip(z)
    } catch (e) {
      origin = null
      statusLine.textContent = e.message || "Couldn't find that zip"
      return
    }
    renderList()
  }
  zipInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') useZip()
  })

  const publicPanel = el('div', { class: 'wp-mode' }, [
    el('div', { class: 'wp-search__row' }, [zipInput, searchBtn]),
    statusLine,
  ])

  // === Mode toggle. Default to the public viewing-area finder. ===
  const segOwn = el('button', { class: 'wp-seg', type: 'button', onclick: () => setMode('own') }, '🏠 Your place')
  const segPublic = el('button', { class: 'wp-seg', type: 'button', onclick: () => setMode('public') }, '📍 Public viewing area')
  function setMode(mode) {
    const own = mode === 'own'
    segOwn.classList.toggle('wp-seg--on', own)
    segPublic.classList.toggle('wp-seg--on', !own)
    ownPanel.style.display = own ? '' : 'none'
    publicPanel.style.display = own ? 'none' : ''
    results.style.display = own ? 'none' : ''
  }

  wrap.appendChild(
    el('div', { class: 'card wp-search' }, [
      matchSelect
        ? el('label', { class: 'wp-search__match' }, [
            el('span', { class: 'wp-watch__label' }, '📺 Watch'),
            matchSelect,
          ])
        : null,
      el('div', { class: 'wp-seg-wrap' }, [segOwn, segPublic]),
      ownPanel,
      publicPanel,
    ]),
  )
  wrap.appendChild(results)

  function openOnDate(v, dayKey) {
    if (!v.startDate || !v.endDate || !dayKey) return true
    return dayKey >= v.startDate && dayKey <= v.endDate
  }

  function renderList() {
    clear(results)
    const match = selectedMatch()
    const dayKey = match ? localDayKey(match.kickoff) : null

    if (!origin) {
      statusLine.textContent = ''
      results.appendChild(empty('Enter your zip and search to find fan zones and bars near you.'))
      return
    }

    const open = parties.filter((v) => openOnDate(v, dayKey))
    if (!open.length) {
      statusLine.textContent = ''
      results.appendChild(empty("No watch parties listed for that match's date."))
      return
    }

    const ranked = open
      .map((v) => ({ v, mi: haversineMiles(origin, { lat: v.lat, lng: v.lng }) }))
      .sort((a, b) => a.mi - b.mi)
    const near = ranked.filter((r) => r.mi <= NEAR_MILES)

    if (near.length) {
      statusLine.textContent = `${near.length} within ${NEAR_MILES} mi of ${origin.label} · ${ranked.length} total`
      results.appendChild(el('h3', { class: 'wp-group' }, 'Near you'))
      for (const r of near) results.appendChild(venueCard(r.v, r.mi, match))
    } else {
      const nearest = ranked[0]
      statusLine.textContent = `Nothing within ${NEAR_MILES} mi of ${origin.label}.`
      results.appendChild(
        el(
          'p',
          { class: 'wp-note' },
          `No watch party within ${NEAR_MILES} miles — the nearest is ${fmtMiles(nearest.mi)} mi away. Here are all venues, closest first:`,
        ),
      )
      for (const r of ranked) results.appendChild(venueCard(r.v, r.mi, match))
    }
  }

  renderList()
  setMode('public')
  return wrap
}

// Match dropdown grouped by local day, soonest first; default selection is the first option.
function buildMatchSelect(upcoming) {
  const byDay = new Map()
  for (const m of upcoming) {
    const k = localDayKey(m.kickoff)
    if (!byDay.has(k)) byDay.set(k, [])
    byDay.get(k).push(m)
  }
  const groups = [...byDay.values()].map((ms) =>
    el(
      'optgroup',
      { label: fmtDay(ms[0].kickoff) },
      ms.map((m) =>
        el('option', { value: String(m.id) }, `${m.home} vs ${m.away} · ${fmtTime(m.kickoff)}`),
      ),
    ),
  )
  return el('select', { class: 'wp-match', 'aria-label': 'Match to watch' }, groups)
}

function fmtMiles(mi) {
  return mi < 10 ? mi.toFixed(1) : String(Math.round(mi))
}

function venueCard(v, mi, match) {
  const mapsQ = `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}`

  function shareText() {
    if (match) {
      return (
        `⚽ Let's watch ${match.home} vs ${match.away} at ${v.name}, ${v.city}!\n` +
        `${fmtDay(match.kickoff)}, ${fmtTime(match.kickoff)}\n` +
        `${v.address}`
      )
    }
    return `⚽ Let's watch the World Cup at ${v.name}, ${v.city}!${
      v.dateText ? ' ' + v.dateText + '.' : ''
    }\n${v.address}`
  }

  return el('article', { class: 'card wp-card' }, [
    el('div', { class: 'wp-card__top' }, [
      el('h4', { class: 'wp-card__name' }, v.name),
      mi != null ? el('span', { class: 'wp-mi' }, `${fmtMiles(mi)} mi`) : null,
    ]),
    el('div', { class: 'wp-card__sub' }, [
      el(
        'span',
        { class: `wp-tag ${v.official ? 'wp-tag--official' : 'wp-tag--bar'}` },
        v.official ? 'Official fan zone' : 'Bar / watch party',
      ),
      el('span', { class: 'wp-city' }, `${v.city}, ${v.region}`),
    ]),
    v.desc ? el('p', { class: 'wp-desc' }, v.desc) : null,
    el('p', { class: 'wp-addr' }, v.address),
    v.registration
      ? el(
          'a',
          { class: 'wp-reg', href: v.registration, target: '_blank', rel: 'noopener' },
          '⚠ Registration required',
        )
      : null,
    el('div', { class: 'wp-actions' }, [
      el(
        'button',
        { class: 'wp-action wp-action--share', type: 'button', onclick: () => shareInvite(shareText()) },
        '👋 Meet here',
      ),
      el(
        'a',
        { class: 'wp-action wp-action--dir', href: mapsQ, target: '_blank', rel: 'noopener' },
        '📍 Directions',
      ),
    ]),
  ])
}
