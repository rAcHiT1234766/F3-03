// Generates FieldLog's PNG icons with Node built-ins only (no image dependencies).
// Regular icons: rounded tile. Maskable icon: full-bleed background with the artwork kept
// inside the central safe zone (a circle of radius 40% of the icon size).
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const ACCENT = [31, 111, 92]
const DARK = [18, 72, 59]
const WHITE = [255, 255, 255]

function crc32(buf) {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // no filter
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// Signed-distance helpers in normalized [0, 1] coordinates.
function roundedRect(x, y, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const qx = Math.abs(x - cx) - ((x1 - x0) / 2 - r)
  const qy = Math.abs(y - cy) - ((y1 - y0) / 2 - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

function segment(x, y, ax, ay, bx, by) {
  const px = x - ax
  const py = y - ay
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - dx * t, py - dy * t)
}

/** Returns [r, g, b, a] for one sample point. `scale` shrinks artwork around the center. */
function sample(x, y, { maskable, scale }) {
  const tile = maskable ? -1 : roundedRect(x, y, 0, 0, 1, 1, 0.22)
  if (tile > 0) return [0, 0, 0, 0]
  // Map into artwork space.
  const ax = (x - 0.5) / scale + 0.5
  const ay = (y - 0.5) / scale + 0.5
  const check = Math.min(
    segment(ax, ay, 0.37, 0.54, 0.46, 0.63),
    segment(ax, ay, 0.46, 0.63, 0.63, 0.44),
  )
  if (check < 0.035) return [...ACCENT, 255]
  if (roundedRect(ax, ay, 0.41, 0.18, 0.59, 0.29, 0.035) < 0) return [...DARK, 255]
  if (roundedRect(ax, ay, 0.28, 0.23, 0.72, 0.8, 0.06) < 0) return [...WHITE, 255]
  return [...ACCENT, 255]
}

function render(size, options) {
  const ss = 4 // 4×4 supersampling for smooth edges
  const out = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0]
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const [r, g, b, a] = sample(
            (px + (sx + 0.5) / ss) / size,
            (py + (sy + 0.5) / ss) / size,
            options,
          )
          acc[0] += r * a
          acc[1] += g * a
          acc[2] += b * a
          acc[3] += a
        }
      }
      const i = (py * size + px) * 4
      const alpha = acc[3] / (ss * ss)
      out[i] = acc[3] ? Math.round(acc[0] / acc[3]) : 0
      out[i + 1] = acc[3] ? Math.round(acc[1] / acc[3]) : 0
      out[i + 2] = acc[3] ? Math.round(acc[2] / acc[3]) : 0
      out[i + 3] = Math.round(alpha)
    }
  }
  return encodePng(size, out)
}

const dir = new URL('../public/icons/', import.meta.url)
mkdirSync(dir, { recursive: true })
const icons = [
  ['icon-192.png', 192, { maskable: false, scale: 1 }],
  ['icon-512.png', 512, { maskable: false, scale: 1 }],
  ['apple-touch-icon-180.png', 180, { maskable: true, scale: 0.9 }],
  ['maskable-512.png', 512, { maskable: true, scale: 0.8 }],
]
for (const [name, size, options] of icons) {
  writeFileSync(new URL(name, dir), render(size, options))
  console.log(`wrote public/icons/${name}`)
}
