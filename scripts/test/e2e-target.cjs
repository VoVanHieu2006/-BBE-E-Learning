// Shared guard and fixture configuration for the real end-to-end suite (docs/testing.md).
// The suite resets its database, so only a loopback disposable bbe_test_* database is accepted.
const DEFAULT_URL = 'postgresql://postgres:pg@127.0.0.1:55440/bbe_test_e2e'
const PORT = Number(process.env.E2E_PORT || 3130)
// Next middleware builds its redirects on `localhost`, so the browser must use the same host or it loses its cookies.
const HOST = 'localhost'
const BASE_URL = `http://${HOST}:${PORT}`

function validateE2eTarget(target) {
  if (!target) throw new Error('E2E_DATABASE_URL for a disposable local bbe_test_* database is required')
  let url
  try { url = new URL(target) } catch { throw new Error('Invalid E2E_DATABASE_URL; credentials suppressed') }
  const allowedParams = ['schema', 'connection_limit', 'pool_timeout', 'connect_timeout']
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !/^\/bbe_test_[a-z0-9_]+$/.test(url.pathname)
    || [...url.searchParams.keys()].some((key) => !allowedParams.includes(key))
    || (url.searchParams.has('schema') && url.searchParams.get('schema') !== 'public')) {
    throw new Error('Only loopback disposable bbe_test_* PostgreSQL databases with public schema are allowed')
  }
  return { databaseName: url.pathname.slice(1), port: url.port || '5432' }
}

// Fixture-only values: never reuse deployment secrets for tests.
function appEnv(databaseUrl) {
  return {
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    JWT_ACCESS_SECRET: 'e2e-fixture-only-access-secret-32-bytes!!',
    JWT_REFRESH_SECRET: 'e2e-fixture-only-refresh-secret-32-bytes!',
    TOKEN_HASH_PEPPER: 'e2e-fixture-only-token-hash-pepper',
    CRON_SECRET: 'e2e-fixture-only-cron-secret',
    NEXT_PUBLIC_APP_URL: BASE_URL,
    NEXT_TELEMETRY_DISABLED: '1',
    // External services stay unconfigured: mail falls back to invitation links, uploads are not exercised.
    RESEND_API_KEY: '', YOUTUBE_API_KEY: '',
    CLOUDINARY_CLOUD_NAME: '', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '',
    R2_ACCOUNT_ID: '', R2_ENDPOINT: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', R2_BUCKET_NAME: '', R2_PUBLIC_URL: '',
  }
}

module.exports = { DEFAULT_URL, PORT, HOST, BASE_URL, validateE2eTarget, appEnv }
