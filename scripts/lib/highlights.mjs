// YouTube highlights search — shared by the Node updater and the Cloudflare Worker.
// Pure (uses global fetch, available in Node 18+ and Workers); no runtime-specific APIs.

// Channels we trust for official highlights.
export const YT_PREFERRED = /fox soccer|fox sports|fifa|one football|fox/i

function toVideo(it) {
  return {
    videoId: it.id.videoId,
    title: it.snippet.title,
    channel: it.snippet.channelTitle,
    thumbnail: it.snippet.thumbnails?.medium?.url || null,
  }
}

// Find up to `max` official highlight videos for the match, trusted channels first, deduped
// by videoId. Only videos whose title actually says "highlights" are kept (avoids linking
// re-uploads/streams). `regionCode` biases availability/ranking; pass a falsy value for a
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
  const isHi = (it) => /highlight/i.test(it.snippet?.title || '')
  const preferred = items.filter((it) => isHi(it) && YT_PREFERRED.test(it.snippet?.channelTitle || ''))
  const other = items.filter((it) => isHi(it) && !preferred.includes(it))
  const out = []
  const seen = new Set()
  for (const it of [...preferred, ...other]) {
    if (seen.has(it.id.videoId)) continue
    seen.add(it.id.videoId)
    out.push(toVideo(it))
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
// A match is "done" only once its US entry is a populated array — so legacy single-object
// entries ({US:{...}}) are re-processed and upgraded to the multi-candidate array shape.
export function matchesNeedingHighlights(results, known, maxAgeMs, now = Date.now()) {
  return Object.entries(results)
    .filter(([id, r]) => {
      if (r.status !== 'FT' || !r.kickoff || !r.home || !r.away) return false
      const us = known[id]?.US
      if (Array.isArray(us) && us.length) return false
      const age = now - new Date(r.kickoff).getTime()
      return age > 0 && age < maxAgeMs
    })
    .sort((a, b) => new Date(b[1].kickoff) - new Date(a[1].kickoff))
}
