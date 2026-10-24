// Minimal static server for browser tests. Serves a build directory with SPA fallback and reads
// files on every request, so a test can swap in a newer build on the same origin (update test).
// Test-only: GET /__test/serve?dir=<build dir> switches the served directory.
import { readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

const port = Number(process.env.PORT ?? 4173)
let root = path.resolve(process.argv[2] ?? 'dist-e2e')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile()
  } catch {
    return false
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/__test/serve') {
    root = path.resolve(url.searchParams.get('dir') ?? root)
    res.end(`serving ${root}`)
    return
  }
  let file = path.join(root, decodeURIComponent(url.pathname))
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403).end()
    return
  }
  if (!(await isFile(file))) {
    // SPA routes (no extension) get the shell, like the Firebase Hosting rewrite; assets 404.
    if (path.extname(url.pathname)) {
      res.writeHead(404).end()
      return
    }
    file = path.join(root, 'index.html')
  }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  })
  res.end(await readFile(file))
}).listen(port, '127.0.0.1', () => console.log(`static server on http://127.0.0.1:${port}`))
