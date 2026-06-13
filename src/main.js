import './style.css'
import { load, refresh } from './lib/data.js'
import { initAnalytics } from './lib/analytics.js'
import { el, clear } from './lib/dom.js'
import { renderToday } from './views/today.js'
import { renderMatches } from './views/matches.js'
import { renderGroups } from './views/groups.js'
import { renderScorers } from './views/scorers.js'
import { renderBracket } from './views/bracket.js'

const TABS = [
  { id: 'today', label: 'Today', render: renderToday },
  { id: 'matches', label: 'Matches', render: renderMatches },
  { id: 'groups', label: 'Groups', render: renderGroups },
  { id: 'bracket', label: 'Bracket', render: renderBracket },
  { id: 'scorers', label: 'Scorers', render: renderScorers },
]

const tabsEl = document.getElementById('tabs')
const viewEl = document.getElementById('view')
const statusEl = document.getElementById('status')

let model = null

function currentTab() {
  const id = location.hash.replace('#', '')
  return TABS.find((t) => t.id === id) || TABS[0]
}

function renderTabs(active) {
  clear(tabsEl)
  for (const t of TABS) {
    tabsEl.appendChild(
      el('a', {
        class: `tab ${t.id === active.id ? 'tab--on' : ''}`,
        href: `#${t.id}`,
        role: 'tab',
      }, t.label),
    )
  }
}

function renderView() {
  const tab = currentTab()
  renderTabs(tab)
  clear(viewEl)
  if (!model) return
  try {
    viewEl.appendChild(tab.render(model))
  } catch (e) {
    console.error(e)
    viewEl.appendChild(el('div', { class: 'empty' }, `Error rendering ${tab.id}: ${e.message}`))
  }
  viewEl.scrollTo?.(0, 0)
}

function setStatus(state) {
  if (state === 'refreshing') {
    statusEl.textContent = 'Refreshing…'
    return
  }
  if (!model) return
  if (model.updated) {
    statusEl.textContent = `Results updated ${relTime(model.updated)} · tap to refresh`
  } else {
    statusEl.textContent = 'Awaiting results · tap to refresh'
  }
}

// Re-fetch live data and re-render. Guarded so overlapping triggers don't stack.
let refreshing = false
async function doRefresh() {
  if (refreshing) return
  refreshing = true
  setStatus('refreshing')
  try {
    model = await refresh()
    renderView()
  } catch (e) {
    console.error('refresh failed', e)
  } finally {
    refreshing = false
    setStatus()
  }
}

function relTime(date) {
  const mins = Math.max(0, Math.round((Date.now() - date) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

window.addEventListener('hashchange', renderView)

// --- Refresh triggers ---------------------------------------------------------
// 1) Tap the status text.
statusEl.addEventListener('click', doRefresh)
statusEl.style.cursor = 'pointer'

// 2) When the app/tab returns to the foreground (e.g. reopened on a phone).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') doRefresh()
})
window.addEventListener('focus', doRefresh)

// 3) Adaptive polling while visible: every 60s when a match is in play, else 3 min.
let pollTimer = null
function schedulePoll() {
  clearTimeout(pollTimer)
  const liveNow = !!model && model.matches.some((m) => m.live)
  const delay = (liveNow ? 60 : 180) * 1000
  pollTimer = setTimeout(async () => {
    if (document.visibilityState === 'visible') await doRefresh()
    schedulePoll()
  }, delay)
}

// Keep the "updated Xm ago" label honest without a full re-fetch.
setInterval(setStatus, 30 * 1000)

async function init() {
  statusEl.textContent = 'Loading…'
  renderTabs(currentTab())
  try {
    model = await load()
    setStatus()
    renderView()
    schedulePoll()
  } catch (e) {
    console.error(e)
    statusEl.textContent = ''
    viewEl.appendChild(el('div', { class: 'empty' }, e.message))
  }
}

initAnalytics()
init()
