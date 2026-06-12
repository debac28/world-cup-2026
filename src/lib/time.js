// All kickoff times are stored as UTC ISO strings. Everything the user sees is
// rendered in their *browser's* local timezone via the Intl API — that's what makes
// "what games are on today" correct no matter where they are in the world.

export const LOCAL_TZ =
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'

// Highlights are split US vs non-US: the exact FOX/official video plays in the US, but
// is geo-blocked elsewhere, so everyone outside the US gets a YouTube search link their
// own app resolves to a region-playable clip. Override for testing with ?region=US.
const US_TZ =
  /^America\/(New_York|Detroit|Chicago|Denver|Boise|Phoenix|Los_Angeles|Anchorage|Juneau|Sitka|Metlakatla|Yakutat|Nome|Adak|Menominee|Indiana\/|Kentucky\/|North_Dakota\/)|^Pacific\/(Honolulu|Pago_Pago)|^America\/Puerto_Rico/

function isUS() {
  if (US_TZ.test(LOCAL_TZ)) return true
  try {
    return new Intl.Locale(navigator.language).region === 'US'
  } catch {
    return false
  }
}

function detectRegion() {
  try {
    const o = new URLSearchParams(location.search).get('region')
    if (o) return o.toUpperCase() === 'US' ? 'US' : 'INTL'
  } catch {}
  return isUS() ? 'US' : 'INTL'
}
// 'US' (exact video) or 'INTL' (YouTube search link).
export const REGION = detectRegion()

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
})
const dayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})
const fullFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

export function parse(iso) {
  return iso ? new Date(iso) : null
}

export function fmtTime(date) {
  return date ? timeFmt.format(date) : '--:--'
}

export function fmtDay(date) {
  return date ? dayFmt.format(date) : 'TBD'
}

export function fmtFullDay(date) {
  return date ? fullFmt.format(date) : 'Date TBD'
}

// A stable per-local-day key (YYYY-MM-DD in local time) used for grouping/“today”.
export function localDayKey(date) {
  if (!date) return 'tbd'
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayKey(now = new Date()) {
  return localDayKey(now)
}

export function isSameLocalDay(date, now = new Date()) {
  return !!date && localDayKey(date) === localDayKey(now)
}

// "in 2h 10m", "live", "FT", or a short relative hint for upcoming matches.
export function relativeHint(date, now = new Date()) {
  if (!date) return ''
  const diffMs = date - now
  if (diffMs <= 0) return ''
  const mins = Math.round(diffMs / 60000)
  if (mins < 60) return `in ${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `in ${hrs}h ${mins % 60}m`
  const days = Math.round(hrs / 24)
  return `in ${days}d`
}
