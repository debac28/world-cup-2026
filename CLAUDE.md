# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An installable PWA for the FIFA World Cup 2026: today's matches in the user's local
timezone, live/final scores, group standings + progression, knockout bracket, and top
scorers. Vanilla JS + Vite, deployed as static files to GitHub Pages; live data comes
from a GitHub Actions cron that runs every hour (~48 API calls/day), not a server.

## Commands

```bash
npm run dev      # Vite dev server at http://localhost:5173 (base '/')
npm run build    # production build to dist/ (PWA service worker generated)
npm run preview  # serve the built dist/
npm run seed     # regenerate public/data/seed.json from fifa_2026.xlsx (needs python3 + openpyxl)
npm run update   # fetch live results into public/data/live.json (reads .env if present)
```

There is no test suite. To sanity-check the pure logic (`src/lib/standings.js`), run it
directly with Node and a fabricated results object (it's a plain ES module with no DOM
deps) — see how `data.js` calls `computeStandings` / `resolveKnockout`.

## Architecture — the big picture

Two data sources are merged **in the browser** at load time:

1. **Static skeleton — `public/data/seed.json`**, generated once by
   `scripts/extract_seed.py` from `fifa_2026.xlsx` (a blank schedule template — it has
   *no* scores or scorers). Contains teams (+ flagcdn codes + FIFA-rank tiebreakers), the
   12 groups, 72 group fixtures, and the 32-match knockout bracket expressed as **slot
   rules** (`"1E"`, `"2A"`, `"3rd Group A/B/C/D/F"`, `"W74"`, `"L101"`).
2. **Live layer — `public/data/live.json`**, produced by `scripts/update_results.mjs`
   from football-data.org (free tier, World Cup competition) and committed by the cron.
   Shape: `{ updated, results, scorers }` where `results` is keyed by match number 1–104.
   A finished result may also carry `highlight: { videoId, title, channel, thumbnail }`
   from the optional YouTube Data API enrichment (see below).

`src/lib/data.js` (`load()`) fetches both, normalizes API-Football statuses into
`scheduled | live | finished`, and produces one merged match list plus computed
standings and resolved knockout matches. **Standings and bracket progression are
computed client-side** (`src/lib/standings.js`), so `live.json` only needs raw results +
scorers — the app derives the rest.

Key invariants worth preserving:

- **Time:** every kickoff is stored as **UTC** (the extractor converts the spreadsheet's
  GMT+5:30 display times). `src/lib/time.js` renders everything in the browser's local
  timezone via `Intl`. Never hardcode an offset in the UI.
- **Match identity:** the match number (1–104) is the join key between seed and live.
  `update_results.mjs` maps football-data.org matches onto it — group matches by unordered
  team pair (orienting goals to seed home/away order), knockout matches by round + nearest
  kickoff. The script also normalizes football-data's status/stage strings into the
  `FT`/`2H`/`NS` and `R32`/`R16`/… codes the app expects.
- **Knockout orientation:** the seed only has slot labels, so for knockout matches the
  live result carries the actual team names; `data.js` trusts those over the slot order.

## UI layout

`src/main.js` is a hash-router over five tab views in `src/views/` (Today, Matches,
Groups, Bracket, Scorers). Shared rendering helpers live in `src/lib/components.js` and
`src/lib/dom.js` (a minimal `el()` factory — no framework). Styling is a single
`src/style.css` (mobile-first, fixed bottom tab bar). PWA manifest/service-worker config
is in `vite.config.js` via `vite-plugin-pwa`; `live.json` uses StaleWhileRevalidate so
the app shows cached results instantly then refreshes.

## Deployment specifics

- GitHub Pages **project** site → Vite `base` must be `/<repo>/`. `deploy.yml` sets it
  via `BASE_PATH`. Locally `base` is `/`. Always build fetch URLs from
  `import.meta.env.BASE_URL` (see `data.js`).
- Secret `FOOTBALL_DATA_TOKEN` (repo Actions secret) powers the cron. Without it the
  update script is a deliberate no-op that preserves existing data.
- Optional secret `YOUTUBE_API_KEY` enables highlight links. The updater carries forward
  already-found highlights and only searches finished matches that lack one, capped at
  `YOUTUBE_SEARCH_BUDGET` (default 4) searches/run to stay within YouTube's free quota.
  Highlights are cached in `live.json` so a match is never re-searched once found.
- `update-results.yml` commits `live.json`; `deploy.yml` rebuilds via a `workflow_run`
  trigger because a bot's commit won't fire `push`.

## Gotchas

- When football-data.org team names differ from the spreadsheet, add aliases to
  `TEAM_ALIASES` in `update_results.mjs` — otherwise group results silently fail to map.
- The best-third-placed bracket allocation is intentionally **not** auto-assigned (its
  mapping depends on which thirds qualify); those slots display their pool label.
- `seed.json` is committed. Only rerun `npm run seed` if the spreadsheet changes; the
  extractor hardcodes the bracket adjacency (`KNOCKOUT`) derived from the sheet layout.
