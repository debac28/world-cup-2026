#!/usr/bin/env node
/**
 * Operational status of the World Cup 2026 live-data backends. Run: `npm run status`.
 *
 * Checks, in order of what users actually depend on:
 *   1. Cloudflare Worker /live  — the PRIMARY live backend (football-data + ESPN merge),
 *      plus its hourly highlights/goals cron and latest deployment.
 *   2. GitHub Actions           — the deploy workflow and the every-6h update-results cron.
 *   3. Committed live.json       — the FALLBACK base the Worker uses only if its sources are
 *      briefly down (so a few hours old is normal/expected, not a problem).
 *
 * Degrades gracefully if `gh` or `wrangler` aren't installed/authed.
 */
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const REPO = 'debac28/world-cup-2026'
const WORKER_URL = 'https://worldcup26-live.debaditya-chatterjee.workers.dev/live'
const RAW_LIVE = `https://raw.githubusercontent.com/${REPO}/main/public/data/live.json`
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WRANGLER_CFG = join(ROOT, 'worker', 'wrangler.toml')

const C = { reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m' }
const c = (col, s) => `${C[col]}${s}${C.reset}`
const head = (s) => console.log(`\n${c('bold', s)}\n${c('dim', '─'.repeat(s.length))}`)
const row = (k, v) => console.log(`  ${k.padEnd(16)} ${v}`)

function age(iso) {
  if (!iso) return c('yellow', 'unknown')
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return c('yellow', 'unparseable')
  const s = (Date.now() - t) / 1000
  const str = s < 90 ? `${Math.round(s)}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${(s / 3600).toFixed(1)}h ago`
  return str
}

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], cwd: ROOT }).trim()
  } catch {
    return null
  }
}

async function getJSON(url) {
  try {
    const r = await fetch(url)
    if (!r.ok) return { __err: `HTTP ${r.status}` }
    return await r.json()
  } catch (e) {
    return { __err: e.message }
  }
}

function conclusionColor(conc) {
  if (conc === 'success') return c('green', conc)
  if (conc === 'failure' || conc === 'cancelled') return c('red', conc)
  return c('yellow', conc || 'in_progress')
}

// --- 1. Cloudflare Worker (primary) ------------------------------------------
async function worker() {
  head('① Cloudflare Worker — PRIMARY live backend')
  const live = await getJSON(WORKER_URL)
  if (live.__err) {
    row('/live', c('red', `DOWN (${live.__err})`))
  } else {
    const r = live.results || {}
    const liveMatches = Object.entries(r).filter(([, m]) => ['HT', '1H', '2H'].includes(m.status))
    const ft = Object.values(r).filter((m) => m.status === 'FT').length
    row('/live', c('green', 'UP') + c('dim', `  (updated ${age(live.updated)})`))
    row('sources', (live.sources || ['—']).join(', '))
    row('matches', `${Object.keys(r).length} total · ${c('cyan', liveMatches.length + ' live')} · ${ft} finished`)
    for (const [id, m] of liveMatches) {
      row('', c('cyan', `#${id} ${m.home} ${m.homeGoals ?? 0}–${m.awayGoals ?? 0} ${m.away} (${m.status})`))
    }
  }
  // Latest deployment + cron schedule
  const dep = sh(`npx wrangler deployments list -c "${WRANGLER_CFG}" 2>/dev/null | grep -m1 Created`)
  row('deployment', dep ? dep.replace(/\s+/g, ' ') : c('yellow', 'wrangler not authed/installed'))
  const cron = sh(`grep -A2 '\\[triggers\\]' "${WRANGLER_CFG}" | grep crons`)
  row('cron', (cron ? cron.replace(/.*=\s*/, '') : '["0 * * * *"]') + c('dim', '  (hourly: highlights + goals)'))
}

// --- 2. GitHub Actions -------------------------------------------------------
function ghRun(workflow) {
  const out = sh(`gh run list --workflow=${workflow} --limit 1 --json status,conclusion,createdAt,displayTitle -R ${REPO}`)
  if (!out) return null
  try {
    return JSON.parse(out)[0] || null
  } catch {
    return null
  }
}

function actions() {
  head('② GitHub Actions')
  if (!sh('gh --version')) {
    row('gh', c('yellow', 'not installed/authed — skipping'))
    return
  }
  const upd = ghRun('update-results.yml')
  if (upd) {
    const a = age(upd.createdAt)
    const stale = (Date.now() - new Date(upd.createdAt).getTime()) / 3600000 > 7 // >7h = missed a 6h cycle
    row('update-results', `${conclusionColor(upd.conclusion)} ${c('dim', a)}${stale ? c('yellow', '  ⚠ may have missed a 6h cycle') : ''}`)
    row('', c('dim', 'cron: every 6h · fallback-base refresher only (Worker is primary)'))
  } else {
    row('update-results', c('yellow', 'no runs found'))
  }
  const dep = ghRun('deploy.yml')
  if (dep) row('deploy', `${conclusionColor(dep.conclusion)} ${c('dim', age(dep.createdAt))}`)
}

// --- 3. Fallback live.json ---------------------------------------------------
async function fallback() {
  head('③ Committed live.json — FALLBACK only')
  const j = await getJSON(RAW_LIVE)
  if (j.__err) {
    row('raw live.json', c('red', j.__err))
  } else {
    row('updated', `${age(j.updated)} ${c('dim', '(≈6h cadence is normal — used only if the Worker is down)')}`)
    row('results', `${Object.keys(j.results || {}).length}`)
  }
}

console.log(c('bold', '\nWorld Cup 2026 — backend status'))
await worker()
actions()
await fallback()
console.log(c('dim', '\nManual cron run:  gh workflow run update-results.yml -R ' + REPO))
console.log(c('dim', 'Worker logs:      npx wrangler tail -c worker/wrangler.toml\n'))
