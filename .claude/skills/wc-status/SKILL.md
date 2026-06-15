---
name: wc-status
description: Report the operational status of the World Cup 2026 live-data backends — the Cloudflare Worker (primary /live, its hourly cron, latest deploy), the GitHub Actions workflows (deploy + the every-6h update-results cron), and the committed fallback live.json. Use when the user asks "are the workers/crons up?", "why is data stale?", wants to manually trigger the results cron, or check whether live scores are flowing.
---

# World Cup 2026 — backend status

This project has several moving parts that serve live data. Use this skill to check them
and to run the manual controls.

## Architecture recap (so the report is interpretable)
- **Cloudflare Worker `/live` is PRIMARY.** Real-time scores merged from football-data.org
  **and ESPN** (`scripts/lib/espn.mjs`), cached ~60s. URL:
  `https://worldcup26-live.debaditya-chatterjee.workers.dev/live`. Deploy only via
  `npm run worker:deploy` (NOT the Pages workflow). Its hourly cron (`0 * * * *`) searches
  YouTube highlights + Wikipedia goals into KV.
- **GitHub Actions `update-results.yml` is a FALLBACK refresher**, every 6h (`0 */6 * * *`).
  It writes the committed `public/data/live.json` that the Worker falls back to only if its
  live sources are briefly down. Being a few hours old is **normal**, not a failure.
- **GitHub Actions `deploy.yml`** builds + publishes the PWA to Pages (custom domain
  `fifa2026.scoreit.fyi`).

## To report status
Run the status script and relay its output, then add a one-line health verdict:

```bash
npm run status
```

It reports: Worker `/live` up/down + freshness + `sources` + any live matches, the latest
Worker deployment + cron schedule, the last `update-results` and `deploy` runs (with a ⚠ if
update-results may have missed a 6h cycle), and the fallback `live.json` age.

Interpreting it:
- Worker `/live` **UP** with `sources: football-data, espn` → live path healthy. This is what
  matters most; the fallback being hours old does NOT mean users see stale data.
- `update-results` last run > ~7h ago → GitHub's scheduler likely skipped a cycle (it's
  unreliable; that's why the Worker is primary). Offer to trigger it manually.

## Manual controls (only when the user asks)
- **Run the fallback cron now:** `gh workflow run update-results.yml -R debac28/world-cup-2026`
  then optionally watch: `gh run watch <id>`.
- **Trigger a redeploy:** `gh workflow run deploy.yml -R debac28/world-cup-2026`.
- **Tail Worker logs (incl. cron):** `npx wrangler tail -c worker/wrangler.toml`.
- **Redeploy the Worker after code changes:** `npm run worker:deploy`.

Requires `gh` and `wrangler` to be installed and authenticated; the script degrades
gracefully and notes if either is missing.
