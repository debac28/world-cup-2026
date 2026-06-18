import './style.css'
import { registerSW } from 'virtual:pwa-register'
import { load, refresh, onModelUpdate } from './lib/data.js'
import { initAnalytics } from './lib/analytics.js'
import { initFeedback } from './lib/feedback.js'
import { el, clear } from './lib/dom.js'
import { renderToday } from './views/today.js'
import { renderMatches, setMatchesMode } from './views/matches.js'
import { renderGroups } from './views/groups.js'
import { renderScorers } from './views/scorers.js'
import { renderWatch } from './views/watch.js'

const TABS = [
  { id: 'today', label: 'Today', render: renderToday },
  { id: 'matches', label: 'Matches', render: renderMatches },
  { id: 'groups', label: 'Groups', render: renderGroups },
  { id: 'scorers', label: 'Scorers', render: renderScorers },
  { id: 'watch', label: 'Watch', render: renderWatch },
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
  // Bracket is no longer a top-level tab — redirect legacy #bracket links/bookmarks to
  // the Matches tab with its Bracket sub-tab preselected.
  if (location.hash === '#bracket') {
    setMatchesMode('bracket')
    history.replaceState(null, '', '#matches')
  }
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

// Set once the service worker registers (see initServiceWorker); forces a check for newly
// deployed app code. Kept at module scope so doRefresh can call it before the SW registers.
let checkForNewVersion = null

// Re-fetch live data and re-render. Guarded so overlapping triggers don't stack.
let refreshing = false
async function doRefresh() {
  if (refreshing) return
  refreshing = true
  setStatus('refreshing')
  // "Tap to refresh" must get the latest CODE, not just the latest data — otherwise an
  // installed PWA keeps running a stale bundle no matter how often the user refreshes. Force a
  // service-worker update check: if a new version is deployed, autoUpdate activates it and
  // reloads the page (pulling the new index.html + JS). registration.update() fetches sw.js
  // from the network directly, so this works even for a client still on an old cache-first SW
  // that a plain reload could never dislodge.
  checkForNewVersion?.()
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

// The DraftKings win line is fetched in the background after load; when it arrives, swap the
// freshly-rebuilt model in and re-render — but only on Today, the lone tab that shows win %,
// so other tabs aren't needlessly re-rendered (and scroll-reset) for a number they don't use.
onModelUpdate((updated) => {
  model = updated
  if (currentTab().id === 'today') renderView()
})

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

// Keep installed PWAs fresh. autoUpdate activates a new service worker and reloads as
// soon as one is found, but the browser rarely *checks* on its own — especially when an
// iOS home-screen app is resumed from its frozen state. So we proactively check for a new
// SW on an interval and every time the app regains focus/visibility, so new deploys and
// seed fixes reach home-screen users in minutes instead of days.
function initServiceWorker() {
  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      const check = () => registration.update().catch(() => {})
      // Expose to doRefresh so an explicit "tap to refresh" also checks for new app code.
      checkForNewVersion = check
      setInterval(check, 30 * 60 * 1000)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      window.addEventListener('focus', check)
    },
  })
}

initServiceWorker()
initAnalytics()
initFeedback()
init()
