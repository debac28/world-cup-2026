import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'

// On GitHub Pages a *project* site is served from /<repo>/, so the build needs a
// matching base path. Override with BASE_PATH (the deploy workflow sets it from the
// repo name). Dev server always uses '/'.
const base = process.env.BASE_PATH || '/worldcup26/'

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : base,
  // Allow phone testing through a cloudflared quick tunnel (dev only).
  server: { allowedHosts: ['.trycloudflare.com'] },
  plugins: [
    // Optional dev-only self-signed HTTPS (set HTTPS=1). Off by default because iOS Safari
    // rejects self-signed certs; for phone testing we use a cloudflared tunnel instead.
    // Never added to the production build.
    ...(command === 'serve' && process.env.HTTPS ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      // We register the service worker ourselves in main.js so we can force frequent
      // update checks (interval + on refocus) — otherwise installed PWAs run stale code
      // for days. Disable the auto-injected registration to avoid registering twice.
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'World Cup 2026',
        short_name: 'WC2026',
        description: 'FIFA World Cup 2026 — fixtures in your timezone, live scores, standings & top scorers',
        theme_color: '#0b3d2e',
        background_color: '#0b3d2e',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
        // Never precache the data JSON — precached files are served cache-first and only
        // refresh when the whole service worker updates, which baked stale schedule/score
        // data into installed PWAs for days. Both are served network-first below instead,
        // so edits (e.g. kickoff fixes in seed.json) reach users on the next online load.
        //
        // ALSO never precache index.html. Precaching it registers a Workbox precache route
        // whose default directoryIndex:'index.html' matches navigations to '/', and that
        // route — registered before our runtimeCaching — wins, serving the home page (and
        // therefore the content-hashed JS it references) CACHE-FIRST. That shadowed the
        // NetworkFirst navigation route below entirely, so installed PWAs stayed pinned to
        // the precached old bundle until the whole SW happened to reinstall AND reload — the
        // exact stale-shell trap we meant to avoid (users had to delete + re-add the app to
        // get new features). With index.html out of the precache, '/' falls through to the
        // NetworkFirst navigate route, so every online launch pulls the latest index.html
        // (hence the latest JS). Code freshness no longer depends on the SW update cycle.
        globIgnores: ['**/data/live.json', '**/data/seed.json', '**/index.html'],
        // The entry index.html hard-references content-hashed JS/CSS. Workbox's default
        // navigation route serves the *precached* index.html cache-first, so an installed app
        // keeps booting the OLD bundle until the whole service worker happens to self-update
        // and reload — which can lag for days on home-screen PWAs (a "tap to refresh" only
        // refetches the data JSON, never the shell). So we disable that cache-first fallback
        // and serve navigations NETWORK-FIRST below: every online open pulls the latest
        // index.html (hence the latest JS), with the last good copy used only when offline.
        // Code freshness no longer depends on the SW update/reload cycle.
        navigateFallback: null,
        runtimeCaching: [
          {
            // App shell: newest code when online, last cached HTML as the offline fallback.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-shell',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // Schedule skeleton: fresh when online (so kickoff/data fixes propagate),
            // falls back to the last cached copy offline.
            urlPattern: ({ url }) => url.pathname.endsWith('/data/seed.json'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'seed-data',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // Network-first so a refresh fetches the latest results when online,
            // falling back to the last cached copy when offline.
            urlPattern: ({ url }) => url.pathname.endsWith('/data/live.json'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'live-data',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 * 24 * 3 },
            },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'flagcdn.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'flags',
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
}))
