import { el, flag, empty } from '../lib/dom.js'
import { sectionTitle, playerLink } from '../lib/components.js'

export function renderScorers(model) {
  const wrap = el('div', { class: 'stack' })
  wrap.appendChild(sectionTitle('Top goal scorers', 'Golden Boot race'))

  const scorers = [...(model.scorers || [])].sort((a, b) => b.goals - a.goals)

  if (!scorers.length) {
    wrap.appendChild(
      empty('No goals yet — scorers appear once the tournament kicks off.'),
    )
    return wrap
  }

  // Standard competition ranking ("1224"): tied players share a rank, the next
  // distinct goal count skips ahead — so 3 players on 3 goals are all rank 2 and
  // the next player is rank 5.
  let rank = 0
  let prevGoals = null
  const rows = scorers.map((s, i) => {
    if (s.goals !== prevGoals) {
      rank = i + 1
      prevGoals = s.goals
    }
    return el('tr', { class: i < 3 ? 'srow srow--qual' : 'srow' }, [
      el('td', { class: 'rank' }, String(rank)),
      el('td', { class: 'left' }, [
        el('div', { class: 'scorer' }, [
          el('span', { class: 'scorer__name' }, [playerLink(s.player, s.wiki, 'player-link player-link--name')]),
          el('span', { class: 'scorer__team' }, [
            flag(model.flagOf.get(s.team), s.team),
            s.team,
          ]),
        ]),
      ]),
      el('td', { class: 'pts' }, String(s.goals)),
    ])
  })

  wrap.appendChild(
    el('div', { class: 'card' }, [
      el('table', { class: 'standings scorers' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, '#'),
          el('th', { class: 'left' }, 'Player'),
          el('th', {}, 'Goals'),
        ])),
        el('tbody', {}, rows),
      ]),
    ]),
  )
  return wrap
}
