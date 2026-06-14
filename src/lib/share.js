// Sharing helpers for "Start a party" (match cards) and watch-party cards.
//
// Two problems this solves:
//  1) Share links must point at the PUBLIC site, not whatever origin the app happens to be
//     served from. On a dev server that origin is a LAN IP (http://192.168.x.x:5173) which
//     is a dead link for anyone not on the same Wi-Fi. In production the app's own origin is
//     correct, so we only override when running on a local/LAN host.
//  2) `wa.me/?text=` is unreliable about prefilled text on some phones (the descriptive line
//     gets dropped, leaving just the URL). The Web Share API hands a proper {text, url} to
//     the OS share sheet, so WhatsApp receives both. We fall back to wa.me where Web Share
//     isn't available (desktop / insecure context).

// Known production URL (GitHub Pages project site). Override at build time with
// VITE_PUBLIC_URL if the app is served elsewhere (custom domain, different repo).
const PROD_URL = 'https://debac28.github.io/world-cup-2026/'

function isLocalHost(host) {
  return (
    /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    host === '[::1]' ||
    host.endsWith('.local')
  )
}

// Canonical public base URL of the app, always ending in a single "/".
const PUBLIC_BASE = (
  import.meta.env.VITE_PUBLIC_URL ||
  (isLocalHost(location.host)
    ? PROD_URL
    : `${location.origin}${import.meta.env.BASE_URL}`)
).replace(/\/+$/, '') + '/'

// Full public URL for a given in-app hash, e.g. appUrl('#watch').
export function appUrl(hash = '') {
  return `${PUBLIC_BASE}${hash}`
}

// The generic "Let's watch together" card, fetched once and kept as a File so shares can
// attach it as a real image (photo + caption) instead of a link — that's how we show the
// card WITHOUT a URL in the message body. Warmed at module load so it's ready at click time
// (native share must fire synchronously inside the user gesture).
let _ogFile = null // File once loaded, false if it failed, null while pending
;(function warmOgFile() {
  fetch(`${import.meta.env.BASE_URL}og.png`)
    .then((r) => (r.ok ? r.blob() : Promise.reject()))
    .then((b) => {
      _ogFile = new File([b], 'worldcup2026.png', { type: 'image/png' })
    })
    .catch(() => {
      _ogFile = false
    })
})()

// Share the card image + `text` via the native share sheet (photo + caption, no URL),
// falling back to a text-only WhatsApp deep link on desktop / insecure contexts. Call this
// directly from a click handler when the text is computed at click time (e.g. a venue card
// whose match is chosen from a dropdown).
export function shareInvite(text) {
  if (!navigator.share) {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
    return
  }
  const payload = { text }
  // Attach the image as a file when the platform supports it → photo + caption, no URL.
  if (_ogFile && navigator.canShare && navigator.canShare({ files: [_ogFile] })) {
    payload.files = [_ogFile]
  }
  navigator.share(payload).catch(() => {})
}

// Anchor-props variant for static text (e.g. a match card). Spread onto an el('a', ...);
// the href is a no-JS WhatsApp fallback, the onclick uses the native sheet when available.
export function shareAnchor(text) {
  return {
    href: `https://wa.me/?text=${encodeURIComponent(text)}`,
    target: '_blank',
    rel: 'noopener',
    onclick: (e) => {
      if (!navigator.share) return // let the href handle it
      e.preventDefault()
      shareInvite(text)
    },
  }
}
