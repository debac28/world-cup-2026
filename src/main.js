import './style.css'
import { load } from './lib/data.js'
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

function setStatus() {
  if (!model) return
  if (model.updated) {
    const rel = relTime(model.updated)
    statusEl.textContent = `Results updated ${rel}`
  } else {
    statusEl.textContent = 'Schedule loaded · awaiting results'
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

async function init() {
  statusEl.textContent = 'Loading…'
  renderTabs(currentTab())
  try {
    model = await load()
    setStatus()
    renderView()
  } catch (e) {
    console.error(e)
    statusEl.textContent = ''
    viewEl.appendChild(el('div', { class: 'empty' }, e.message))
  }
}

init()
