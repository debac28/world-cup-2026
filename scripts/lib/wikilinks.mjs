// Resolves a player name to a VERIFIED English Wikipedia article title, or null when no
// real article exists. We attach a `wiki` link to a scorer only when one is genuine — no
// guessy "search page" fallback — so the UI can render players without an article as plain
// text. Pure: global `fetch` only (no Node/Workers APIs); shared by the Node updater
// (scripts/update_results.mjs) and the Cloudflare Worker (worker/src/index.js).

const WIKI_API = 'https://en.wikipedia.org/w/api.php'
const UA = 'worldcup26-pwa/1.0 (https://debac28.github.io/world-cup-2026/)'

// A page is the player only if Wikipedia's own one-line short description says so. This is the
// precision guard: it rejects disambiguation pages, surname set-index pages (e.g. "Quiñónez"
// → "Surname"), and any unrelated same-named article — all of which would be a wrong link.
const FOOTBALLER = /football|soccer/i

// Look up one name. Returns the canonical (post-redirect) article title ONLY when the page is
// a footballer's article (per its short description); else null, so the UI renders plain text
// rather than a wrong or useless link. High precision by design — a bare surname or a missing
// short description yields null.
export async function resolveWiki(name, fetchImpl = fetch) {
  if (!name) return null
  const url =
    `${WIKI_API}?action=query&format=json&formatversion=2&redirects=1` +
    `&prop=pageprops&ppprop=disambiguation|wikibase-shortdesc&titles=${encodeURIComponent(name)}`
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } })
    if (!res.ok) return null
    const data = await res.json()
    const page = data?.query?.pages?.[0]
    if (!page || page.missing) return null
    const props = page.pageprops || {}
    if ('disambiguation' in props) return null
    if (!FOOTBALLER.test(props['wikibase-shortdesc'] || '')) return null
    return page.title || null
  } catch {
    return null
  }
}

// Attach a verified `wiki` title to each item that has a `player` and no `wiki` yet, using
// (and updating) a persistent name->title `cache`. The cache stores "" for a verified
// no-article name so it's never re-queried. `limit` caps the number of *new* network lookups
// this call performs (callers share a per-run budget). Mutates `items` and `cache` in place;
// returns the number of lookups performed.
export async function attachWikiLinks(items, cache = {}, opts = {}) {
  const { fetchImpl = fetch, limit = Infinity } = opts
  let used = 0
  for (const it of items) {
    if (!it || !it.player || it.wiki) continue
    const name = it.player
    if (!(name in cache)) {
      if (used >= limit) continue
      cache[name] = (await resolveWiki(name, fetchImpl)) || ''
      used++
    }
    if (cache[name]) it.wiki = cache[name]
  }
  return used
}
