import { execFileSync } from 'node:child_process'

const windows = process.platform === 'win32'
const npmCommand = windows ? (process.env.ComSpec ?? 'cmd.exe') : 'npm'
const npmArgs = windows
  ? ['/d', '/s', '/c', 'npm.cmd pack --dry-run --json']
  : ['pack', '--dry-run', '--json']
const output = execFileSync(npmCommand, npmArgs, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})

const manifest = JSON.parse(output)[0]
const files = new Set((manifest?.files ?? []).map(file => file.path))
const required = [
  'lib/index.js',
  'lib/index.d.ts',
  'cordis.patch.yml',
  'package.json',
  'README.md',
  'LICENSE',
]
const forbidden = [/^src\//, /^tests\//, /^dist\//, /(^|\/)\.env(?:\.|$)/, /\.log$/]
const missing = required.filter(file => !files.has(file))
const unexpected = [...files].filter(file => forbidden.some(pattern => pattern.test(file)))

if (missing.length > 0 || unexpected.length > 0) {
  if (missing.length > 0) console.error(`Missing package files: ${missing.join(', ')}`)
  if (unexpected.length > 0) console.error(`Unexpected package files: ${unexpected.join(', ')}`)
  process.exit(1)
}

console.log(`Package contents verified (${files.size} files)`)
