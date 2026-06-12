# World Cup 2026 PWA

An installable progressive web app for the FIFA World Cup 2026. It shows **today's
matches in your own timezone**, **live & final scores**, **group standings with who's
progressing**, the **knockout bracket**, the **top goal scorers**, match **venues**, and
**YouTube highlight links** for completed matches.

The static schedule (fixtures, groups, bracket) is extracted once from `fifa_2026.xlsx`.
Live scores and scorers are pulled from [football-data.org](https://www.football-data.org)
(free tier, World Cup competition) by a GitHub Actions cron job every hour and committed
as a small JSON file, so the deployed site is just static files — no server.

## How it fits together

```
fifa_2026.xlsx ──(scripts/extract_seed.py)──► public/data/seed.json   (static skeleton)
API-Football  ──(scripts/update_results.mjs)─► public/data/live.json  (scores + scorers, 2×/day)
                                                       │
                              src/  (Vite + vanilla JS PWA)  merges seed + live in the browser
```

- **`seed.json`** — 48 teams (+ flag codes & FIFA-rank tiebreakers), 12 groups, 72
  group fixtures with UTC kickoffs, and the full knockout bracket as slot rules.
- **`live.json`** — `{ updated, results, scorers }`; `results` is keyed by match number
  (1–104). Standings and bracket slot resolution are computed in the browser from these.
- All kickoff times are stored in **UTC** and rendered in the visitor's local timezone.

## Local development

```bash
npm install
npm run dev          # http://localhost:5173
```

The app loads `public/data/seed.json` + `public/data/live.json`. `seed.json` is
committed; regenerate it from the spreadsheet with:

```bash
npm run seed         # needs python3 + openpyxl (pip install openpyxl)
```

## Pulling live results locally

1. Get a free token from <https://www.football-data.org/client/register>.
2. `cp .env.example .env` and put your token in `FOOTBALL_DATA_TOKEN`.
3. `npm run update` — fetches results + scorers into `public/data/live.json`.

Without a token the script is a no-op and leaves existing data untouched.

### Optional: YouTube highlights

To attach an official highlights video to each finished match, set `YOUTUBE_API_KEY`:

1. In the [Google Cloud Console](https://console.cloud.google.com), create a project and
   enable **YouTube Data API v3**, then create an **API key**.
2. Add it to `.env` (`YOUTUBE_API_KEY=...`) and as a repo secret of the same name.

The updater searches YouTube for each finished match, prefers official channels
(FOX Soccer / FIFA), and caches the result so it never re-searches. It's quota-safe: a
search costs 100 units against the free 10,000/day quota, and it caps searches per run
(`YOUTUBE_SEARCH_BUDGET`, default 4). Without the key, highlights are simply skipped.

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Settings → Secrets and variables → Actions → New repository secret:**
   `FOOTBALL_DATA_TOKEN` = your token.
   (Optional repo *variables* `FOOTBALL_DATA_COMP` / `FOOTBALL_DATA_SEASON` to override
   the defaults `WC` / current season.)
4. Push to `main` → `deploy.yml` builds and publishes to
   `https://<user>.github.io/<repo>/`.

Two workflows run the show:

- **`update-results.yml`** — cron every hour (and manual): fetches results and
  commits `live.json`. ~48 API calls/day, within API-Football's free 100/day tier.
- **`deploy.yml`** — builds & deploys on push to `main`, on manual dispatch, and after
  each successful results update.

You can trigger either manually from the repo's **Actions** tab.

## Installing on a phone

Open the deployed URL in mobile Chrome/Safari → **Add to Home Screen**. It runs
full-screen, works offline (cached schedule + last-fetched results), and updates in the
background.

## Notes & limitations

- Group tiebreakers use FIFA's 2026 order (points → goal difference → goals scored →
  head-to-head → FIFA ranking). Fair-play points and drawing of lots are not modelled.
- Knockout slots resolve automatically for group winners/runners-up and match
  winners/losers. The **best-third-placed** allocation (`3rd Group A/B/C/D/F`) is shown
  as its pool label rather than auto-assigned, since that mapping depends on which thirds
  qualify.
- If football-data.org's team names differ from the spreadsheet's, add an alias in
  `TEAM_ALIASES` inside `scripts/update_results.mjs`.
