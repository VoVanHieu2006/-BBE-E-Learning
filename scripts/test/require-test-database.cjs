// Load before Prisma in legacy DB suites; never fall back to the application's .env.
const target = process.env.TEST_DATABASE_URL
if (!target) throw new Error('Explicit TEST_DATABASE_URL for a disposable local bbe_test_* database is required')
let url
try { url = new URL(target) }
catch { throw new Error('Invalid disposable TEST_DATABASE_URL; credentials suppressed') }
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/^\/bbe_test_[a-z0-9_]+$/.test(url.pathname) || [...url.searchParams.keys()].some(key => !['schema','connection_limit','pool_timeout','connect_timeout'].includes(key)) || (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public')) {
  throw new Error('Only loopback disposable bbe_test_* PostgreSQL databases with public schema are allowed')
}
process.env.DATABASE_URL = target
process.env.DIRECT_URL = target
