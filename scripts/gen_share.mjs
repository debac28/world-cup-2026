// Generates ONE generic Open Graph image (public/og.png) used as the preview card for every
// share (match "Start a party" and watch-party invites). Match-specific details — teams,
// match number, stage, kickoff in the viewer's local time — go in the MESSAGE TEXT, not the
// image, so we never need per-match images and never bake a fixed timezone into a picture.
//
// Run once after changing the design:  node scripts/gen_share.mjs   (commits public/og.png)

import { createCanvas, GlobalFonts } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

// System Arial locally; if a bundled font is added later, point these at it so the render is
// identical in CI. (One-off asset, so local generation + commit is fine.)
try {
  GlobalFonts.registerFromPath('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 'WCBold')
  GlobalFonts.registerFromPath('/System/Library/Fonts/Supplemental/Arial.ttf', 'WC')
} catch {}
const BOLD = (px) => `${px}px WCBold, Arial, sans-serif`
const REG = (px) => `${px}px WC, Arial, sans-serif`

function ball(ctx, cx, cy, r) {
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill()
  // simple pentagon accents
  ctx.fillStyle = '#0a1410'
  const pent = (x, y, s) => {
    ctx.beginPath()
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5
      const px = x + s * Math.cos(a), py = y + s * Math.sin(a)
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
    }
    ctx.closePath(); ctx.fill()
  }
  pent(cx, cy, r * 0.34)
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5
    pent(cx + r * 0.74 * Math.cos(a), cy + r * 0.74 * Math.sin(a), r * 0.2)
  }
  ctx.restore()
}

function main() {
  const W = 1200, H = 630
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')

  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, '#0e4a37')
  g.addColorStop(1, '#08160f')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  // subtle pitch motif
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'
  ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(W / 2, 70); ctx.lineTo(W / 2, H - 70); ctx.stroke()
  ctx.beginPath(); ctx.arc(W / 2, H / 2, 110, 0, Math.PI * 2); ctx.stroke()

  ball(ctx, W / 2, 150, 52)

  ctx.textAlign = 'center'
  ctx.fillStyle = '#eaf3ee'
  ctx.font = BOLD(86)
  ctx.fillText('WORLD CUP ', W / 2 - 70, 320)
  // re-draw "2026" in gold right after
  const baseW = ctx.measureText('WORLD CUP ').width
  ctx.fillStyle = '#ffd23f'
  ctx.textAlign = 'left'
  ctx.fillText('2026', W / 2 - 70 + baseW / 2, 320)

  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  ctx.font = BOLD(54)
  ctx.fillText("Let's watch together", W / 2, 410)

  ctx.fillStyle = '#8fb3a4'
  ctx.font = REG(30)
  ctx.fillText('Live scores · Fixtures in your timezone · Local watch parties', W / 2, 470)

  const png = canvas.encode('png')
  Promise.resolve(png).then((buf) => {
    writeFileSync(resolve(ROOT, 'public/og.png'), buf)
    console.log('wrote public/og.png (1200×630 generic share card)')
  })
}

main()
