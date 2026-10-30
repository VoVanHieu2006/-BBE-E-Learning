const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const envPath = path.join(root, '.env')
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envPath)

const result = spawnSync(process.execPath, [
  '-r', 'ts-node/register',
  '-r', './scripts/test/alias-hook.cjs',
  'scripts/db/remediate-video-completion.ts',
  ...process.argv.slice(2),
], {
  cwd: root,
  env: { ...process.env, TS_NODE_PROJECT: 'scripts/tsconfig.json' },
  stdio: 'inherit',
  windowsHide: true,
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
