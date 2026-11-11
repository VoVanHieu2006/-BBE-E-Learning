const { spawnSync } = require('node:child_process')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const ts = file => ['-r', 'ts-node/register', '-r', './scripts/test/alias-hook.cjs', file]
// Explicit lists: never discover and execute arbitrary scripts against a database.
const suites = {
  unit: [
    ts('src/test/chapter-placement-replacement.test.ts'),
    ts('src/test/materialize-learning-rule.test.ts'),
    ts('src/test/middleware-session.test.ts'),
    ts('src/test/invitation-list-scope.test.ts'),
    ts('src/test/invitation-management.test.ts'),
    ts('src/test/dna-leaderboard-scope.test.ts'),
    ts('src/test/member-invite-scope.test.ts'),
    ts('src/test/chapter-transfer-history.test.ts'),
    ts('src/test/learning-unlocks.test.ts'),
    ['src/test/admin-chapters-state.test.cjs'],
    ...['manager-learning-exemption','position-replacement','standardize-migration','role-sessions','business-rules','video-playback-guard','video-progress-session','video-fullscreen-controls','video-controls-youtube-ux','video-switching-leak','video-player-ui','shared-learning-path','quiz-plan-b-selection','p1-rules','prompt1-verification','prompt2-verification','master-verification','video-continuity-security','chapter-initial-rewards','transfer-windows','pwa-standalone','viewport-reset','bulk-invite','quiz-timer-navigator','lesson-navigation','monthly-reward-reset','monthly-review','learning-cycles','account-lock-rules','deadline-enforcement','deadline-extension','login-lock','course-update-rules','lesson-new-label','fun-display-name','course-draft','course-draft-publish','course-draft-routes','learning-display','content-deletion','content-management','ranking-departures'].map(name => ts(`src/test/${name}.test.ts`)),
    ...['baseline-empty-database.test.mjs','test-formula-audit.cjs','test-p05-assets.cjs','test-p05-routes.cjs','test-chapter-period-api.cjs','test-chapter-term-aggregation.cjs','test-completed-lessons.cjs','test-transfer-responses.cjs','test-transfer-guard.cjs','test-transfer-admin-view.cjs'].map(file => [`scripts/test/${file}`]),
    ['scripts/test/database-safety.test.cjs'], ['load-tests/tests/safety.test.mjs'], ['load-tests/tests/profiler.test.mjs'],
  ],
  integration: [
    ...['test-learning-flow-integration.mjs','test-chapter-leaderboard-integration.mjs','test-learning-security.mjs','test-learning-cycles-integration.cjs','test-reward-pause-integration.cjs','test-organization-integrity.cjs','test-organization-repair.mjs','test-chapter-transfer-integration.cjs','test-completed-lessons-integration.cjs','test-star-history-integration.cjs','test-fb-fixes.cjs'].map(file => [`scripts/test/${file}`]),
    ...['admin-program-and-lead-dept','quiz-and-refresh-integration','chapter-six-month-transfer'].map(name => ['-r','./scripts/test/require-test-database.cjs',...ts(`src/test/${name}.test.ts`)]),
  ],
  browser: ['player','tabs','sidebar','fb','refactor','quiz','course-update'].map(name => ['node_modules/@playwright/test/cli.js','test','-c',`playwright.${name}.config.ts`]),
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
