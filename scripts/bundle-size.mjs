// Reports raw and gzip sizes of a production build (default: dist/) and writes them to
// docs/evidence/bundle-size.json. Run after `npm run build`.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const dir = path.resolve(process.argv[2] ?? 'dist')
const files = []
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const full = path.join(d, name)
    if (statSync(full).isDirectory()) walk(full)
    else if (/\.(js|css|html|webmanifest)$/.test(name)) files.push(full)
  }
}
walk(dir)

const rows = files
  .map((f) => {
    const buf = readFileSync(f)
    return {
      file: path.relative(dir, f).replaceAll('\\', '/'),
      raw: buf.length,
      gzip: gzipSync(buf).length,
    }
  })
  .sort((a, b) => b.raw - a.raw)
const sum = (ext, key) => rows.filter((r) => r.file.endsWith(ext)).reduce((n, r) => n + r[key], 0)
const totals = {
  appJs: {
    raw: sum('.js', 'raw') - (rows.find((r) => r.file === 'sw.js')?.raw ?? 0),
    gzip: sum('.js', 'gzip') - (rows.find((r) => r.file === 'sw.js')?.gzip ?? 0),
  },
  serviceWorker: rows.find((r) => r.file === 'sw.js') ?? null,
  css: { raw: sum('.css', 'raw'), gzip: sum('.css', 'gzip') },
}
const kb = (n) => `${(n / 1024).toFixed(1)} kB`
for (const r of rows)
  console.log(`${r.file.padEnd(52)} ${kb(r.raw).padStart(10)} ${kb(r.gzip).padStart(10)} gzip`)
console.log(`\nApp JS total: ${kb(totals.appJs.raw)} raw / ${kb(totals.appJs.gzip)} gzip`)
console.log(`CSS total:    ${kb(totals.css.raw)} raw / ${kb(totals.css.gzip)} gzip`)
mkdirSync('docs/evidence', { recursive: true })
writeFileSync(
  'docs/evidence/bundle-size.json',
  `${JSON.stringify({ measuredAt: new Date().toISOString(), buildDir: path.basename(dir), totals, files: rows }, null, 2)}\n`,
)
