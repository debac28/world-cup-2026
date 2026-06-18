// Cloudflare Web Analytics: privacy-friendly page views, no cookies.
// The beacon never loads in dev, so localhost development doesn't pollute the stats. The
// site token is public by design (it ships in every page's HTML), so it's committed here
// as the default; override per-environment with VITE_CF_BEACON_TOKEN if needed.
const DEFAULT_TOKEN = '98582189d62545ada89a5acb3ebc02e9'
export function initAnalytics() {
  const token = import.meta.env.VITE_CF_BEACON_TOKEN || DEFAULT_TOKEN
  if (!token || import.meta.env.DEV) return
  const s = document.createElement('script')
  s.defer = true
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js'
  s.setAttribute('data-cf-beacon', JSON.stringify({ token }))
  document.head.appendChild(s)
}

// GoatCounter: also cookieless, but unlike Cloudflare's beacon it reports daily UNIQUE
// visitors (CF can't, by design) — that's the one number we added it for. Runs alongside CF.
// count.js counts a single pageview on load and does NOT auto-count hash-route changes, so our
// in-app tab switching (#today/#matches/…) doesn't inflate the figures. The /count endpoint is
// public (it ships in the page), so it's committed as the default like the CF token; override
// with VITE_GOATCOUNTER_URL if needed. Never loads in dev so localhost doesn't pollute stats.
const DEFAULT_GC_URL = 'https://fifa2026.goatcounter.com/count'
export function initGoatCounter() {
  const url = import.meta.env.VITE_GOATCOUNTER_URL || DEFAULT_GC_URL
  if (!url || import.meta.env.DEV) return
  const s = document.createElement('script')
  s.async = true
  s.src = 'https://gc.zgo.at/count.js'
  s.setAttribute('data-goatcounter', url)
  document.head.appendChild(s)
}
