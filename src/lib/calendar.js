// "Add to calendar" — generates an iCalendar (.ics) file for upcoming matches and hands it to
// the user's calendar app. Reminders then come from their own Apple/Google Calendar, so we
// need no notification backend or per-user state. One file can hold many events (the country
// "add all" flow), and each event carries a 1-hour reminder (VALARM).

import { appUrl } from './share.js'

const MATCH_MINUTES = 120 // ~2h incl. half-time — gives the calendar block a sensible length.

const pad = (n) => String(n).padStart(2, '0')

// Date -> iCal UTC timestamp "YYYYMMDDTHHMMSSZ". Kickoffs are stored in UTC, so the event
// lands at the right wall-clock time in whatever timezone the user's calendar renders.
function icsUTC(d) {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  )
}

// Escape a TEXT value per RFC 5545 (backslash, comma, semicolon, newline).
function esc(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

// Fold a content line to <=75 octets with CRLF + leading-space continuations (RFC 5545), so
// long SUMMARY/LOCATION lines stay spec-compliant and don't break strict parsers.
function fold(line) {
  if (line.length <= 75) return line
  const out = [line.slice(0, 75)]
  let rest = line.slice(75)
  while (rest.length) {
    out.push(' ' + rest.slice(0, 74))
    rest = rest.slice(74)
  }
  return out.join('\r\n')
}

function vevent(m, stamp) {
  const start = m.kickoff
  const end = new Date(start.getTime() + MATCH_MINUTES * 60000)
  const title = `${m.home} vs ${m.away}`
  const stage = m.roundName || 'Group stage'
  const loc = m.venue ? `${m.venue.stadium}, ${m.venue.city}` : ''
  const desc = [`${stage} · FIFA World Cup 2026`, `Follow live: ${appUrl('')}`]
    .map(esc)
    .join('\\n')
  return [
    'BEGIN:VEVENT',
    `UID:wc2026-m${m.id}@fifa2026.scoreit.fyi`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${icsUTC(start)}`,
    `DTEND:${icsUTC(end)}`,
    `SUMMARY:${esc(`${title} — World Cup 2026`)}`,
    loc ? `LOCATION:${esc(loc)}` : null,
    `DESCRIPTION:${desc}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(`${title} kicks off in 1 hour`)}`,
    'TRIGGER:-PT1H',
    'END:VALARM',
    'END:VEVENT',
  ]
    .filter(Boolean)
    .map(fold)
    .join('\r\n')
}

// Build the full .ics document for a list of matches.
export function buildICS(matches) {
  const stamp = icsUTC(new Date())
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//World Cup 2026//scoreit//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...matches.map((m) => vevent(m, stamp)),
    'END:VCALENDAR',
  ].join('\r\n')
}

// Generate the .ics and hand it off, from inside a click handler. We trigger a download of the
// text/calendar file via a temporary <a download>: on the desktop this saves the file (open it
// to import), and on iOS Safari tapping it opens the file straight into the Calendar app's "Add
// All to Calendar" sheet. (An earlier window.open() variant made iOS show a generic "open with"
// picker instead — the download-link click is what lands directly in Calendar.)
export function addToCalendar(matches, filename = 'world-cup-2026.ics') {
  if (!matches?.length) return
  const blob = new Blob([buildICS(matches)], { type: 'text/calendar' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 8000)
}
