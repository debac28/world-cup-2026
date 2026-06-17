// Tally.so feedback popup — subtle bottom-right slider + on-demand pill button.
//
// Self-contained: injects its own CSS, loads Tally's embed script, and exposes
// window.disableFeedback(). Drop-in two ways:
//   • module:  import { initFeedback } from './lib/feedback.js'; initFeedback()
//   • script:  paste the body of initFeedback() into a <script> tag (it only uses
//              browser globals — no imports).
//
// Behaviour (see initFeedback):
//   1. Auto-opens a subtle bottom-right Tally slider 15s after load.
//   2. Auto-open only fires in the *first* open browser tab.
//   3. On submit we set localStorage.feedbackSubmitted=true so it never returns.
//   4. If that flag is already set on load, we bail before doing anything.
//   5. A semi-transparent "Feedback" pill (bottom-right) opens it on demand.
//   6. The pill is removed once feedback is submitted.
//   7. window.disableFeedback() kills it from the console with no deploy.

// Global on/off feature flag. Set to false and ship a PR to turn the feedback
// collector off for ALL users; set back to true to re-enable. This is the simple
// app-level kill switch (separate from per-browser window.disableFeedback()).
const FEEDBACK_ENABLED = false

// Tally form id — the slug in tally.so/r/<id> (here: tally.so/r/vGW5pg).
const TALLY_FORM_ID = 'vGW5pg'

const SHOW_DELAY_MS = 15000
const SUBMITTED_KEY = 'feedbackSubmitted' // localStorage: '"true"' once submitted/disabled
const TAB_COUNT_KEY = 'wc_openTabCount' // localStorage: shared count of open tabs
const TAB_SEEN_KEY = 'wc_tabCounted' // sessionStorage: this tab already counted (survives reload)

export function initFeedback() {
  // Global feature flag — when off, no popup, no pill, nothing, for everyone.
  if (!FEEDBACK_ENABLED) return

  // (4) Already submitted (or disabled) — do nothing, ever.
  if (localStorage.getItem(SUBMITTED_KEY) === 'true') return

  // (7) Console kill-switch — works whether or not the rest has run yet.
  window.disableFeedback = () => {
    try { localStorage.setItem(SUBMITTED_KEY, 'true') } catch {}
    removePill()
  }

  injectStyles()
  loadTally()
  addPill()
  listenForSubmit()

  // (2) Auto-open only in the first tab. The slider is intrusive in every tab;
  // the pill (above) is still available everywhere for on-demand feedback.
  if (isFirstTab()) {
    setTimeout(openPopup, SHOW_DELAY_MS)
  }
}

// --- Submission tracking ------------------------------------------------------

function markSubmitted() {
  try { localStorage.setItem(SUBMITTED_KEY, 'true') } catch {}
  removePill() // (6)
}

// (3) Tally also stops re-showing natively via doNotShowAfterSubmit, but we want
// our own persistent flag. Tally posts a JSON-string message on submit; its event
// name is "Tally.FormSubmitted" (we also accept a couple of aliases defensively).
function listenForSubmit() {
  window.addEventListener('message', (e) => {
    let data = e.data
    if (typeof data === 'string') {
      try { data = JSON.parse(data) } catch { return }
    }
    if (!data || typeof data !== 'object') return
    const event = data.event || data.type
    if (event === 'Tally.FormSubmitted' || event === 'Tally.FormResponse' || event === 'form_response') {
      markSubmitted()
    }
  })
}

// --- Tally popup --------------------------------------------------------------

function loadTally() {
  if (window.Tally) return
  if (document.querySelector('script[data-tally-embed]')) return
  const s = document.createElement('script')
  s.src = 'https://tally.so/widgets/embed.js'
  s.async = true
  s.setAttribute('data-tally-embed', '')
  document.head.appendChild(s)
}

function openPopup() {
  if (localStorage.getItem(SUBMITTED_KEY) === 'true') return
  // Embed script may not have finished loading yet — poll briefly.
  if (!window.Tally || typeof window.Tally.openPopup !== 'function') {
    return void setTimeout(openPopup, 400)
  }
  window.Tally.openPopup(TALLY_FORM_ID, {
    layout: 'default', // bottom-right corner slider, NOT a full-screen modal
    width: 360,
    hideTitle: true, // drop the form's title/header block — shorter popup
    overlay: false, // subtle: don't dim the page behind it
    autoClose: 2500, // close shortly after a successful submit
    // NB: no `showOnce` — Tally's showOnce blocks the popup from ever reopening,
    // which would break the on-demand pill. We gate the *auto* open ourselves
    // (15s timer fires once per load; feedbackSubmitted stops it for good).
    doNotShowAfterSubmit: true,
    onSubmit: markSubmitted, // primary, most reliable submit signal
  })
}

// --- Floating pill (5/6) ------------------------------------------------------

function addPill() {
  if (document.getElementById('feedback-pill')) return
  const btn = document.createElement('button')
  btn.id = 'feedback-pill'
  btn.type = 'button'
  btn.textContent = '💬 Feedback'
  btn.setAttribute('aria-label', 'Give feedback')
  btn.addEventListener('click', openPopup)
  document.body.appendChild(btn)
}

function removePill() {
  document.getElementById('feedback-pill')?.remove()
}

// --- First-tab detection (2) --------------------------------------------------
// sessionStorage is per-tab, so it can't see other tabs by itself; we keep the
// shared count in localStorage and use a per-tab sessionStorage flag so a reload
// doesn't recount the same tab. "First tab" = the one that found the count at 0.
function isFirstTab() {
  try {
    let first = sessionStorage.getItem(TAB_SEEN_KEY)
    if (first === null) {
      const open = Number(localStorage.getItem(TAB_COUNT_KEY) || '0')
      first = open <= 0 ? 'yes' : 'no'
      sessionStorage.setItem(TAB_SEEN_KEY, first)
      localStorage.setItem(TAB_COUNT_KEY, String(open + 1))
      // Decrement when this tab goes away so the count doesn't leak upward.
      window.addEventListener('pagehide', () => {
        const n = Number(localStorage.getItem(TAB_COUNT_KEY) || '1')
        localStorage.setItem(TAB_COUNT_KEY, String(Math.max(0, n - 1)))
      })
    }
    return first === 'yes'
  } catch {
    return true // storage blocked (private mode) — treat as the only tab
  }
}

// --- Styles -------------------------------------------------------------------

function injectStyles() {
  if (document.getElementById('feedback-styles')) return
  const css = `
    #feedback-pill {
      position: fixed;
      right: 16px;
      /* sit above the app's fixed bottom tab bar (--tabbar-h, 60px fallback) */
      bottom: calc(var(--tabbar-h, 60px) + env(safe-area-inset-bottom) + 14px);
      z-index: 9999;
      padding: 9px 15px;
      font: 700 0.8rem/1 system-ui, -apple-system, sans-serif;
      /* dark ink on the app's gold so it reads clearly against any background */
      color: var(--ink, #0a1410);
      background: var(--gold, #ffd23f);
      border: 1px solid rgba(0, 0, 0, 0.15);
      border-radius: 999px;
      cursor: pointer;
      opacity: 0.95;
      transition: opacity 0.2s ease, transform 0.2s ease;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    }
    #feedback-pill:hover,
    #feedback-pill:focus-visible {
      opacity: 1;
      transform: translateY(-1px);
      outline: none;
    }
  `
  const style = document.createElement('style')
  style.id = 'feedback-styles'
  style.textContent = css
  document.head.appendChild(style)
}
