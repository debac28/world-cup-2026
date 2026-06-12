// YouTube highlights search — shared by the Node updater and the Cloudflare Worker.
// Pure (uses global fetch, available in Node 18+ and Workers); no runtime-specific APIs.

// Channels we trust for official highlights.
export const YT_PREFERRED = /fox soccer|fox sports|fifa|one football|fox/i

// Find an official highlights video playable in `regionCode`. Returns null if no video
// whose title actually says "highlights" is found (avoids linking re-uploads/streams).
export async function youtubeHighlight(home, away, regionCode, key) {
  const q = encodeURIComponent(`${home} vs ${away} 2026 World Cup highlights`)
  const url =
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video` +
    `&maxResults=6&order=relevance&relevanceLanguage=en&regionCode=${regionCode}` +
    `&q=${q}&key=${key}`
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`YouTube ${res.status} ${body.slice(0, 160)}`)
  }
  const items = (await res.json()).items || []
  const isHi = (it) => /highlight/i.test(it.snippet?.title || '')
  const pref =
    items.find((it) => YT_PREFERRED.test(it.snippet?.channelTitle || '') && isHi(it)) ||
    items.find(isHi) ||
    null
  if (!pref?.id?.videoId) return null
  return {
    videoId: pref.id.videoId,
    title: pref.snippet.title,
    channel: pref.snippet.channelTitle,
    thumbnail: pref.snippet.thumbnails?.medium?.url || null,
  }
}

// Given a results map and the highlights already known (id -> {US:{...}}), return the
// list of [id, result] still needing a US highlight, most-recent first, within maxAgeMs.
export function matchesNeedingHighlights(results, known, maxAgeMs, now = Date.now()) {
  return Object.entries(results)
    .filter(([id, r]) => {
      if (r.status !== 'FT' || !r.kickoff || !r.home || !r.away) return false
      if (known[id]?.US) return false
      const age = now - new Date(r.kickoff).getTime()
      return age > 0 && age < maxAgeMs
    })
    .sort((a, b) => new Date(b[1].kickoff) - new Date(a[1].kickoff))
}
