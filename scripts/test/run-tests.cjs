const { spawnSync } = require('node:child_process')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const ts = file => ['-r', 'ts-node/register', '-r', './scripts/test/alias-hook.cjs', file]
// Explicit lists: never discover and execute arbitrary scripts against a database.
const suites = {
  unit: [
    ...['business-rules','video-playback-guard','video-progress-session','video-fullscreen-controls','video-controls-youtube-ux','video-switching-leak','video-player-ui','shared-learning-path','quiz-plan-b-selection','p1-rules','prompt1-verification','prompt2-verification','master-verification','video-continuity-security','chapter-initial-rewards'].map(name => ts(`src/test/${name}.test.ts`)),
    ...['baseline-empty-database.test.mjs','test-formula-audit.cjs','test-chapter-period-api.cjs','test-chapter-term-aggregation.cjs','test-completed-lessons.cjs','test-transfer-responses.cjs'].map(file => [`scripts/test/${file}`]),
    ['scripts/test/database-safety.test.cjs'], ['load-tests/tests/safety.test.mjs'], ['load-tests/tests/profiler.test.mjs'],
  ],
  integration: [
    ...['test-learning-flow-integration.mjs','test-chapter-leaderboard-integration.mjs','test-learning-security.mjs','test-learning-cycles-integration.cjs','test-reward-pause-integration.cjs','test-organization-integrity.cjs','test-organization-repair.mjs','test-chapter-transfer-integration.cjs','test-completed-lessons-integration.cjs','test-star-history-integration.cjs','test-fb-fixes.cjs'].map(file => [`scripts/test/${file}`]),
    ...['admin-program-and-lead-dept','quiz-and-refresh-integration','chapter-six-month-transfer'].map(name => ['-r','./scripts/test/require-test-database.cjs',...ts(`src/test/${name}.test.ts`)]),
  ],
  browser: ['player','tabs','sidebar','fb','refactor'].map(name => ['node_modules/@playwright/test/cli.js','test','-c',`playwright.${name}.config.ts`]),
}
const group = process.argv[2] || 'unit'
if (!Object.hasOwn(suites, group)) throw new Error('Choose unit, integration or browser')
const selected = process.argv[3]
if (group === 'integration' && !selected) {
  console.error('Select one integration suite; each has its own guarded DB/app configuration (docs/testing.md).')
  for (const args of suites.integration) console.error(`  ${args.at(-1)}`)
  process.exit(1)
}
const commands = suites[group].filter(args => !selected || args.at(-1).includes(selected))
if (!commands.length) throw new Error('No suite matches the requested name')
if (group === 'integration' && commands.length !== 1) throw new Error('Select exactly one integration suite to avoid sharing configuration across databases')
for (const args of commands) {
  console.log(`\nRunning ${args.at(-1)}`)
  const env = { ...process.env, TS_NODE_PROJECT: 'tsconfig.test.json' }
  if (group === 'unit') {
    env.DATABASE_URL = env.DIRECT_URL = 'postgresql://unit_tests@127.0.0.1:1/bbe_test_unit'
  }
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
console.log(`\nPASS: ${commands.length} ${group} suites`)
