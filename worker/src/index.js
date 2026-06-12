// Cloudflare Worker: serves fresh live World Cup results at GET /live.
//
// Why this exists: GitHub Actions' scheduler is unreliable for ~5-minute live updates.
// This Worker fetches football-data.org on demand, maps it onto our fixtures (shared
// logic in scripts/lib/map.mjs), and merges in scorers + highlight links from the
// GitHub-built base (live.json). It caches the merged result ~60s via the Cache API,
// so football-data is hit at most ~once/minute no matter how many viewers there are.
//
// The app polls this endpoint (every 60s during live matches), so scores are never
// more than ~1 minute stale.

import seed from '../../public/data/seed.json'
import { buildResults } from '../../scripts/lib/map.mjs'

const FD_BASE = 'https://api.football-data.org/v4'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
const CACHE_SECONDS = 60

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS })
    }

    const cache = caches.default
    const cacheKey = new Request(new URL('/live', request.url).toString(), request)
    const cached = await cache.match(cacheKey)
    if (cached) return withCors(cached)

    const payload = await buildPayload(env)
    const res = new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
        ...CORS,
      },
    })
    ctx.waitUntil(cache.put(cacheKey, res.clone()))
    return res
  },
}

function withCors(res) {
  const r = new Response(res.body, res)
  for (const [k, v] of Object.entries(CORS)) r.headers.set(k, v)
  return r
}

async function buildPayload(env) {
  // Base: scorers + highlight links produced by the GitHub updater.
  const base = await fetchJSON(env.BASE_LIVE_URL).catch(() => null)

  const token = env.FOOTBALL_DATA_TOKEN
  let results = base?.results || {}
  if (token) {
    try {
      const comp = env.FOOTBALL_DATA_COMP || 'WC'
      const season = env.FOOTBALL_DATA_SEASON
      const q = season ? `?season=${season}` : ''
      const data = await fetchJSON(`${FD_BASE}/competitions/${comp}/matches${q}`, {
        headers: { 'X-Auth-Token': token },
      })
      const fresh = buildResults(seed, data.matches || [])
      if (Object.keys(fresh).length) results = fresh
    } catch (e) {
      // Network/API hiccup — fall back to the base results.
      console.log('football-data fetch failed:', e.message)
    }
  }

  // Carry forward per-region highlight links from the base onto the fresh results
  // (migrating the legacy single `highlight` into `highlights.US`).
  const baseResults = base?.results || {}
  for (const [id, r] of Object.entries(results)) {
    const b = baseResults[id]
    const bh = b?.highlights || (b?.highlight ? { US: b.highlight } : null)
    if (bh && !r.highlights) r.highlights = bh
  }

  return {
    updated: new Date().toISOString(),
    source: 'cloudflare-worker',
    results,
    scorers: base?.scorers || [],
  }
}

async function fetchJSON(url, init) {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  return res.json()
}
