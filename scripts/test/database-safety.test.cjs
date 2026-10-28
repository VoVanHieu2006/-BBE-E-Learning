const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const run = target => spawnSync(process.execPath, ['-r', './scripts/test/require-test-database.cjs', '-e', 'if(process.env.DATABASE_URL!==process.env.TEST_DATABASE_URL||process.env.DIRECT_URL!==process.env.TEST_DATABASE_URL)process.exit(2)'], {
  env: { ...process.env, TEST_DATABASE_URL: target || '', DATABASE_URL: 'postgresql://application.invalid/live', DIRECT_URL: 'postgresql://application.invalid/live' }, encoding: 'utf8', windowsHide: true,
})
test('DB suites refuse missing, remote, application, schema override and rerouting targets before loading Prisma', () => {
  for (const target of [undefined, 'malformed-private-target', 'postgresql://example.com/bbe_test_fixture', 'postgresql://127.0.0.1/application', 'postgresql://127.0.0.1/bbe_test_fixture?host=example.com', 'postgresql://127.0.0.1/bbe_test_fixture?schema=private', 'http://127.0.0.1/bbe_test_fixture']) {
    const result = run(target)
    assert.ifError(result.error)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /disposable|loopback/)
    assert.equal(result.stderr.includes('malformed-private-target'), false)
  }
})
test('DB suites select only the explicit disposable loopback URL', () => {
  for (const host of ['127.0.0.1','localhost','[::1]']) {
    const result = run(`postgresql://${host}:55439/bbe_test_fixture?schema=public`)
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr)
  }
})
