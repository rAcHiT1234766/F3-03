// Runs the Firebase CLI with the real JVM first on PATH.
// On Windows, `java` often resolves to Oracle's "javapath" launcher, which starts the actual
// JVM as a separate process. The CLI then stops only the launcher at shutdown and the Firestore
// emulator JVM keeps running, holding its ports. Pointing PATH at <java.home>/bin avoids that.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

function javaHome() {
  if (process.env.JAVA_HOME && existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME
  const probe = spawnSync('java', ['-XshowSettings:properties', '-version'], { encoding: 'utf8' })
  const match = /java\.home = (.+)/.exec(`${probe.stderr ?? ''}${probe.stdout ?? ''}`)
  return match ? match[1].trim() : null
}

const env = { ...process.env }
const home = javaHome()
if (home) {
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  env[pathKey] = `${path.join(home, 'bin')}${path.delimiter}${env[pathKey] ?? ''}`
  env.JAVA_HOME = home
}

// Run the CLI's JS entry with this Node binary: no shell, so arguments pass through unchanged.
const cli = path.resolve('node_modules', 'firebase-tools', 'lib', 'bin', 'firebase.js')
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit', env })
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
