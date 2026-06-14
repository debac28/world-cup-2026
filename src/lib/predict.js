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
