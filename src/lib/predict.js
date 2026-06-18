// Pre-match win probability from FIFA ranking points.
//
// FIFA's ranking is itself an Elo system, so its points feed straight into the standard
// Elo expected-score formula. We collapse the draw into the win/lose split (the app shows
// a simple two-way "who's more likely to win"), so the two numbers always sum to 100.
//
// ELO_SCALE is the one calibration knob — the classic Elo divisor. Smaller = more
// decisive (a given points gap maps to a more lopsided split). 400 is the standard.
const ELO_SCALE = 400

// Returns { home, away } integer percentages summing to 100, or null when either rating
// is missing (e.g. an unresolved knockout slot whose team isn't known yet).
export function winProbability(homeRating, awayRating) {
  if (homeRating == null || awayRating == null) return null
  const pHome = 1 / (1 + 10 ** ((awayRating - homeRating) / ELO_SCALE))
  const home = Math.round(pHome * 100)
  return { home, away: 100 - home }
}

// American moneyline -> raw implied probability (still carries the bookmaker's margin/vig).
function moneylineToProb(ml) {
  if (ml == null || Number.isNaN(Number(ml))) return null
  const n = Number(ml)
  return n >= 0 ? 100 / (n + 100) : -n / (-n + 100)
}

// Two-way win split from a sportsbook's three-way moneyline (home / draw / away). This is
// the preferred source for the card's win % — a real market price, not our Elo guess. We
// de-vig across all three outcomes, then fold the draw out the same way `winProbability`
// does, so the two numbers still sum to 100 and slot straight into the existing badges.
// Returns { home, away } integer percentages, or null if the line is incomplete.
export function oddsWinProbability(homeML, drawML, awayML) {
  const ph = moneylineToProb(homeML)
  const pd = moneylineToProb(drawML)
  const pa = moneylineToProb(awayML)
  if (ph == null || pd == null || pa == null) return null
  const overround = ph + pd + pa
  if (overround <= 0) return null
  // De-vig to true probabilities, then condition on "not a draw": P(home | someone wins).
  const home = ph / overround
  const away = pa / overround
  const decisive = home + away
  if (decisive <= 0) return null
  const h = Math.round((home / decisive) * 100)
  return { home: h, away: 100 - h }
}
