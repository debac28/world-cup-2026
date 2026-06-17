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

  const rows = scorers.map((s, i) =>
    el('tr', { class: i < 3 ? 'srow srow--qual' : 'srow' }, [
      el('td', { class: 'rank' }, String(i + 1)),
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
    ]),
  )

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
