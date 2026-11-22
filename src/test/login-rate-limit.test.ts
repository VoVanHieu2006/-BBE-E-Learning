import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'

// Route-level test of the per-source failed-login limit on POST /api/v1/auth/login (BUG-AUTH-RATE),
// with every collaborator replaced by an in-memory double. Stubs must exist before the route is loaded.
process.env.JWT_ACCESS_SECRET = 'unit-test-access-secret'
process.env.JWT_REFRESH_SECRET = 'unit-test-refresh-secret'

const PASSWORD = 'Correct-horse-1'
const user = {
  id: 'user-1', email: 'learner@example.com', role: 'MEMBER', status: 'ACTIVE', lock_reason: null,
  failed_login_count: 0, locked_until: null, password_hash: bcrypt.hashSync(PASSWORD, 4), auth_version: 1, chapter_members: [],
}
let counters = new Map<string, { count: number; expires_at: Date }>()

const fakePrisma = {
  user: {
    findUnique: async ({ where }: { where: { email: string } }) => (where.email === user.email ? user : null),
    update: async () => user,
    updateMany: async () => ({ count: 1 }),
  },
  refreshToken: { create: async () => ({}) },
  authRateLimit: {
    findUnique: async ({ where }: { where: { key: string } }) => counters.get(where.key) ?? null,
    upsert: async ({ where, create }: { where: { key: string }; create: { count: number; expires_at: Date } }) => {
      const row = counters.get(where.key)
      if (row) row.count += 1
      else counters.set(where.key, { count: create.count, expires_at: create.expires_at })
      return counters.get(where.key)!
    },
    deleteMany: async ({ where }: { where: { expires_at: { lt: Date } } }) => {
      counters.forEach((row, key) => { if (row.expires_at < where.expires_at.lt) counters.delete(key) })
      return { count: 0 }
    },
  },
}

function stub(modulePath: string, exports: Record<string, unknown>) {
  const filename = require.resolve(modulePath)
  require.cache[filename] = { id: filename, filename, loaded: true, exports, children: [], paths: [] } as unknown as NodeJS.Module
}

let POST: (request: any) => Promise<Response>
let limiter: typeof import('../lib/login-rate-limit')

before(() => {
  stub('../lib/prisma', { prisma: fakePrisma })
  stub('../lib/affiliation-access', { hasActiveAffiliation: async () => true })
  stub('../lib/manager-learning-access', { getLearningManagerKind: async () => null })
  stub('../lib/auth', { invalidateUserAuthCache: () => {} })
  POST = require('../app/api/v1/auth/login/route').POST
  limiter = require('../lib/login-rate-limit')
})

async function login(email: string, password: string, ip?: string) {
  const { NextRequest } = require('next/server')
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (ip) headers['x-forwarded-for'] = ip
  const response = await POST(new NextRequest('http://localhost/api/v1/auth/login', { method: 'POST', headers, body: JSON.stringify({ email, password }) }))
  return { status: response.status, retryAfter: response.headers.get('retry-after'), body: await response.json() as any }
}

describe('POST /api/v1/auth/login per-source failure limit', () => {
  beforeEach(() => { counters = new Map() })

  it('answers 429 with Retry-After once one source has failed the limit, across different emails', async () => {
    for (let attempt = 0; attempt < limiter.LOGIN_FAILURE_LIMIT; attempt += 1) {
      assert.equal((await login(`spray-${attempt}@example.com`, 'wrong-password', '203.0.113.7')).status, 401)
    }
    const blocked = await login('spray-next@example.com', 'wrong-password', '203.0.113.7')
    assert.equal(blocked.status, 429)
    assert.equal(blocked.body.error.code, 'TooManyAttempts')
    const seconds = Number(blocked.retryAfter)
    assert.ok(seconds >= 1 && seconds <= limiter.LOGIN_FAILURE_WINDOW_MS / 1000, `Retry-After within the window, got ${blocked.retryAfter}`)
  })

  it('refuses even the correct password from a blocked source, and leaves other sources alone', async () => {
    for (let attempt = 0; attempt < limiter.LOGIN_FAILURE_LIMIT; attempt += 1) await login(`spray-${attempt}@example.com`, 'wrong-password', '203.0.113.7, 10.0.0.1')
    assert.equal((await login(user.email, PASSWORD, '203.0.113.7')).status, 429, 'first x-forwarded-for entry identifies the source')
    assert.equal((await login(user.email, PASSWORD, '198.51.100.9')).status, 200)
  })

  it('does not count successful logins or malformed requests', async () => {
    for (let attempt = 0; attempt < limiter.LOGIN_FAILURE_LIMIT + 5; attempt += 1) {
      assert.equal((await login(user.email, PASSWORD, '203.0.113.7')).status, 200)
      assert.equal((await login('', '', '203.0.113.7')).status, 400)
    }
    assert.equal(counters.size, 0)
  })

  it('does not limit a request whose source is unknown', async () => {
    for (let attempt = 0; attempt < limiter.LOGIN_FAILURE_LIMIT + 5; attempt += 1) assert.equal((await login('nobody@example.com', 'wrong-password')).status, 401)
    assert.equal(counters.size, 0)
  })

  it('starts a fresh count in the next window and drops the expired one', async () => {
    const start = Math.floor(Date.now() / limiter.LOGIN_FAILURE_WINDOW_MS) * limiter.LOGIN_FAILURE_WINDOW_MS
    for (let attempt = 0; attempt < limiter.LOGIN_FAILURE_LIMIT; attempt += 1) await limiter.recordLoginFailure('203.0.113.7', start)
    assert.equal(await limiter.loginRetryAfterSeconds('203.0.113.7', start + 1000), limiter.LOGIN_FAILURE_WINDOW_MS / 1000 - 1)
    const next = start + limiter.LOGIN_FAILURE_WINDOW_MS
    assert.equal(await limiter.loginRetryAfterSeconds('203.0.113.7', next), null)
    await limiter.recordLoginFailure('203.0.113.7', next + 1)
    assert.equal(counters.size, 1, 'the expired window row is deleted')
  })
})
