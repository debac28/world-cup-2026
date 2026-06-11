// Tiny DOM helpers — no framework.

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue
    if (k === 'class') node.className = v
    else if (k === 'html') node.innerHTML = v
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v)
    } else if (k === 'dataset') {
      Object.assign(node.dataset, v)
    } else node.setAttribute(k, v)
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
  }
  return node
}

export function clear(node) {
  node.replaceChildren()
  return node
}

// Flag image for a team. `code` is a flagcdn code (e.g. "br", "gb-eng"); falls back
// to a neutral placeholder when unknown (e.g. an unresolved knockout slot).
export function flag(code, name = '') {
  if (!code) return el('span', { class: 'flag flag--tbd', title: name }, '')
  const img = el('img', {
    class: 'flag',
    src: `https://flagcdn.com/w40/${code}.png`,
    srcset: `https://flagcdn.com/w80/${code}.png 2x`,
    width: '24',
    height: '18',
    loading: 'lazy',
    alt: name,
    title: name,
  })
  // If the flag CDN is unreachable, fall back to a neutral placeholder instead of a
  // broken-image icon.
  img.addEventListener('error', () => {
    img.replaceWith(el('span', { class: 'flag flag--tbd', title: name }, ''))
  })
  return img
}

export function empty(message) {
  return el('div', { class: 'empty' }, message)
}
