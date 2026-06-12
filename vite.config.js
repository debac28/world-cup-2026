import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// On GitHub Pages a *project* site is served from /<repo>/, so the build needs a
// matching base path. Override with BASE_PATH (the deploy workflow sets it from the
// repo name). Dev server always uses '/'.
const base = process.env.BASE_PATH || '/worldcup26/'

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : base,
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
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
        // Never precache live results — it must always come from the network
        // (NetworkFirst rule below), or a stale copy gets baked into the app shell.
        // seed.json is still precached for offline use.
        globIgnores: ['**/data/live.json'],
        // Live results JSON: serve fast from cache, refresh in the background.
        runtimeCaching: [
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
