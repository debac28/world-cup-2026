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
