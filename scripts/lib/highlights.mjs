// YouTube highlights search — shared by the Node updater and the Cloudflare Worker.
// Pure (uses global fetch, available in Node 18+ and Workers); no runtime-specific APIs.

// The ONLY channels we will ever link to — the four official rights-holders we agreed on,
// matched as the WHOLE channel name (never a substring, and NEVER the video title, where spam
// farms bury bait keywords like "FIFA World Cup"). So look-alike upload channels ("FIFA
// Highlights HD", "RedaNova", "Match Highlights", "Goal Journey") never pass. A clip from
// anything not in this map is dropped — we'd rather show only the official clip(s), or just a
// YouTube search link, than pad the list with random reuploads. Same set for every region:
// FIFA/ESPN are global, FOX/Telemundo are the US broadcasters; non-US viewers get whichever of
// these are playable plus the search-link fallback. Maps channel name -> the chip brand.
const OFFICIAL = new Map([
  ['fox soccer', 'FOX'],
  ['fox sports', 'FOX'],
  ['fifa', 'FIFA'],
  ['espn', 'ESPN'],
  ['espn fc', 'ESPN'],
  ['telemundo deportes', 'Telemundo'],
])

// The broadcaster brand for a channel, or null if it isn't one of the four official
// rights-holders. Always keyed off the structured channel name from the API — never the title.
export function officialBrand(channel) {
  return OFFICIAL.get((channel || '').trim().toLowerCase()) || null
}

// Fold a string for loose comparison: drop diacritics, lowercase, collapse punctuation to
// spaces ("Côte d'Ivoire" -> "cote d ivoire", "Türkiye" -> "turkiye").
function fold(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Seed team name (folded) -> the substrings a YouTube title might actually use. Keeps the
// shortest unambiguous token so e.g. "South Korea", "Korea Republic" and "Korea" all match,
// and Spanish/Portuguese feeds ("Jordania", "Czechia") still resolve.
const TITLE_ALIASES = {
  'korea republic': ['korea'],
  'czech republic': ['czech'],
  'bosnia and herzegovina': ['bosnia'],
  'ivory coast': ['ivory coast', 'cote d ivoire'],
  'cape verde': ['cape verde', 'cabo verde'],
  'dr congo': ['congo'],
  'united states': ['united states', 'usa'],
  'turkey': ['turkey', 'turkiye'],
  'saudi arabia': ['saudi'],
  jordan: ['jordan'], // matches "Jordan" and "Jordania"
}

function teamVariants(team) {
  const f = fold(team)
  return TITLE_ALIASES[f] || [f]
}

// True only if the title names BOTH teams — the guard against YouTube's relevance search
// returning a different match's clip (e.g. an Argentina–Algeria video for an Austria–Jordan
// query). Both team names must appear, so a single shared word can't cross-match.
export function titleMatchesTeams(title, home, away) {
  const t = fold(title)
  const has = (team) => teamVariants(team).some((v) => t.includes(v))
  return has(home) && has(away)
}

// A clean channel name is a short, single-line broadcaster/creator name. The fingerprint of the
// old scrape path is a byline blob like "FIFA • 1.1M views • 3 hours ago\n\n\n…", which both
// pollutes the source chip and lets junk pose as an official channel — reject it.
function cleanChannel(channel) {
  return (
    typeof channel === 'string' &&
    channel.length > 0 &&
    channel.length <= 60 &&
    !/[\n•]|\bviews\b|\bago\b/i.test(channel)
  )
}

// A stored/looked-up highlight candidate is trustworthy for this match only if it has a video
// id, comes from one of the four official channels (exact name, never the title), and has a
// title that actually names both teams. cleanChannel is a redundant-but-cheap guard against
// scraped byline blobs ("FIFA • 1.1M views • …") that could never be an exact channel anyway.
export function validCandidate(c, home, away) {
  return !!(
    c &&
    c.videoId &&
    cleanChannel(c.channel) &&
    officialBrand(c.channel) &&
    titleMatchesTeams(c.title, home, away)
  )
}

// Drop every untrustworthy candidate from a stored {US:[...], INTL:[...]} entry (also accepts
// the legacy single-object {US:{...}} shape). Returns a cleaned entry, or null if nothing
// survives. Used both to serve-filter KV and to self-heal it.
export function sanitizeHighlights(entry, home, away) {
  if (!entry) return null
  const out = {}
  for (const [region, val] of Object.entries(entry)) {
    const list = (Array.isArray(val) ? val : [val]).filter((c) => validCandidate(c, home, away))
    if (list.length) out[region] = list
  }
  return Object.keys(out).length ? out : null
}

function toVideo(it) {
  return {
    videoId: it.id.videoId,
    title: it.snippet.title,
    channel: it.snippet.channelTitle,
    thumbnail: it.snippet.thumbnails?.medium?.url || null,
  }
}

// Find up to `max` highlight videos for the match, official rights-holders first, deduped by
// videoId. A video is kept only if its title says "highlights" AND names both teams (so a
// different match's clip can never sneak in), with official-channel clips ranked ahead of
// other creators. `regionCode` biases availability/ranking; pass a falsy value for a
// region-neutral search. A single search costs 100 quota units regardless of `maxResults`,
// so we ask for more and keep the best — this is what gives geo-blocked clips a fallback.
export async function youtubeHighlights(home, away, regionCode, key, max = 3) {
  const q = encodeURIComponent(`${home} vs ${away} 2026 World Cup highlights`)
  const region = regionCode ? `&regionCode=${regionCode}` : ''
  const url =
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video` +
    `&maxResults=10&order=relevance&relevanceLanguage=en${region}` +
    `&q=${q}&key=${key}`
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`YouTube ${res.status} ${body.slice(0, 160)}`)
  }
  const items = ((await res.json()).items || []).filter((it) => it.id?.videoId)
  const keep = items
    .map(toVideo)
    .filter((v) => /highlight/i.test(v.title || '') && validCandidate(v, home, away))
  const preferred = keep.filter((v) => officialBrand(v.channel))
  const other = keep.filter((v) => !officialBrand(v.channel))
  const out = []
  const seen = new Set()
  for (const v of [...preferred, ...other]) {
    if (seen.has(v.videoId)) continue
    seen.add(v.videoId)
    out.push(v)
    if (out.length >= max) break
  }
  return out
}

// Back-compat single-video helper (used by the GitHub-Actions fallback updater): the top
// official highlight playable in `regionCode`, or null if none qualify.
export async function youtubeHighlight(home, away, regionCode, key) {
  const [top] = await youtubeHighlights(home, away, regionCode, key, 1)
  return top || null
}

// Given a results map and the highlights already known (id -> {US:[...]}), return the list
// of [id, result] still needing US highlight candidates, most-recent first, within maxAgeMs.
// A match is "done" only once its US entry holds at least one VALID candidate — so legacy
// single-object entries ({US:{...}}) and entries whose stored clips fail validation (wrong-
// match titles, scraped junk channels) are re-processed and replaced.
export function matchesNeedingHighlights(results, known, maxAgeMs, now = Date.now()) {
  return Object.entries(results)
    .filter(([id, r]) => {
      if (r.status !== 'FT' || !r.kickoff || !r.home || !r.away) return false
      const us = known[id]?.US
      const ok = Array.isArray(us) && us.some((c) => validCandidate(c, r.home, r.away))
      if (ok) return false
      const age = now - new Date(r.kickoff).getTime()
      return age > 0 && age < maxAgeMs
    })
    .sort((a, b) => new Date(b[1].kickoff) - new Date(a[1].kickoff))
}
