// All kickoff times are stored as UTC ISO strings. Everything the user sees is
// rendered in their *browser's* local timezone via the Intl API — that's what makes
// "what games are on today" correct no matter where they are in the world.

export const LOCAL_TZ =
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'

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
