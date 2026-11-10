import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'

// Route-level test of POST /api/v1/auth/login with every collaborator replaced by an in-memory double.
// Env vars and stubs must exist before the route module is loaded, hence the dynamic require below.
process.env.JWT_ACCESS_SECRET = 'unit-test-access-secret'
process.env.JWT_REFRESH_SECRET = 'unit-test-refresh-secret'

type StoredUser = {
  id: string; email: string; role: string; status: 'ACTIVE' | 'INACTIVE' | 'LOCKED'; lock_reason: string | null
  failed_login_count: number; locked_until: Date | null; password_hash: string; auth_version: number; chapter_members: unknown[]
}

const PASSWORD = 'Correct-horse-1'
let users: StoredUser[] = []
let refreshTokens: unknown[] = []
let invalidated: string[] = []

const fakePrisma = {
  user: {
    findUnique: async ({ where }: { where: { email: string } }) => users.find((row) => row.email === where.email) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
      const row = users.find((user) => user.id === where.id)!
      for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === 'object' && 'increment' in value) (row as any)[key] += value.increment
        else (row as any)[key] = value
      }
      return row
    },
    updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Record<string, any> }) => {
      const row = users.find((user) => user.id === where.id && user.status === where.status)
      if (!row) return { count: 0 }
      for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === 'object' && 'increment' in value) (row as any)[key] += value.increment
        else (row as any)[key] = value
      }
      return { count: 1 }
    },
  },
  refreshToken: { create: async (args: unknown) => { refreshTokens.push(args); return {} } },
}

function stub(modulePath: string, exports: Record<string, unknown>) {
  const filename = require.resolve(modulePath)
  require.cache[filename] = { id: filename, filename, loaded: true, exports, children: [], paths: [] } as unknown as NodeJS.Module
}

let POST: (request: any) => Promise<Response>

before(() => {
  stub('../lib/prisma', { prisma: fakePrisma })
  stub('../lib/affiliation-access', { hasActiveAffiliation: async () => true })
  stub('../lib/manager-learning-access', { getLearningManagerKind: async () => null })
  stub('../lib/auth', { invalidateUserAuthCache: (id: string) => { invalidated.push(id) } })
  POST = require('../app/api/v1/auth/login/route').POST
})

async function login(email: string, password: string) {
  const { NextRequest } = require('next/server')
  const response = await POST(new NextRequest('http://localhost/api/v1/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
  }))
  return { status: response.status, body: await response.json() as any }
}

const makeUser = (patch: Partial<StoredUser> = {}): StoredUser => ({
  id: 'user-1', email: 'learner@example.com', role: 'MEMBER', status: 'ACTIVE', lock_reason: null,
  failed_login_count: 0, locked_until: null, password_hash: bcrypt.hashSync(PASSWORD, 4), auth_version: 1, chapter_members: [], ...patch,
})

describe('POST /api/v1/auth/login lock rules (KHBB 7.2)', () => {
  beforeEach(() => { users = [makeUser()]; refreshTokens = []; invalidated = [] })

  it('answers 401 with the remaining attempts for the first four wrong passwords', async () => {
    for (const remaining of [4, 3, 2, 1]) {
      const { status, body } = await login('learner@example.com', 'wrong-password')
      assert.equal(status, 401)
      assert.equal(body.error.code, 'InvalidCredentials')
      assert.equal(body.error.remainingAttempts, remaining)
      assert.equal(users[0].status, 'ACTIVE')
    }
  })

  it('locks the account on the fifth wrong password, with PASSWORD_LOCK, no timed unlock, and a reset-password hint', async () => {
    for (let attempt = 0; attempt < 4; attempt++) await login('learner@example.com', 'wrong-password')
    const { status, body } = await login('learner@example.com', 'wrong-password')
    assert.equal(status, 403)
    assert.equal(body.error.code, 'AccountLocked')
    assert.equal(body.error.lockReason, 'PASSWORD_LOCK')
    assert.equal(body.error.remainingAttempts, 0)
    assert.match(body.error.message, /Quên mật khẩu/)
    assert.equal(users[0].status, 'LOCKED')
    assert.equal(users[0].lock_reason, 'PASSWORD_LOCK')
    assert.equal(users[0].locked_until, null, 'no locked_until: the lock never expires by itself')
    assert.deepEqual(invalidated, ['user-1'])
  })

  it('a locked account cannot sign in even with the right password, and nothing is written', async () => {
    users = [makeUser({ status: 'LOCKED', lock_reason: 'PASSWORD_LOCK', failed_login_count: 5 })]
    const { status, body } = await login('learner@example.com', PASSWORD)
    assert.equal(status, 403)
    assert.equal(body.error.code, 'AccountLocked')
    assert.equal(body.error.lockReason, 'PASSWORD_LOCK')
    assert.equal(users[0].status, 'LOCKED')
    assert.equal(users[0].failed_login_count, 5)
    assert.equal(refreshTokens.length, 0, 'no session was issued')
  })

  it('an overdue-locked account cannot sign in with the right password and is told to contact Admin', async () => {
    users = [makeUser({ status: 'LOCKED', lock_reason: 'OVERDUE_LOCK' })]
    const { status, body } = await login('learner@example.com', PASSWORD)
    assert.equal(status, 403)
    assert.equal(body.error.lockReason, 'OVERDUE_LOCK')
    assert.match(body.error.message, /Admin/)
    assert.equal(users[0].status, 'LOCKED')
    assert.equal(users[0].lock_reason, 'OVERDUE_LOCK')
    assert.equal(refreshTokens.length, 0)
  })

  it('a correct password resets only the counter and never touches status or lock_reason', async () => {
    users = [makeUser({ failed_login_count: 3 })]
    const { status, body } = await login('learner@example.com', PASSWORD)
    assert.equal(status, 200)
    assert.ok(body.accessToken)
    assert.equal(users[0].failed_login_count, 0)
    assert.equal(users[0].status, 'ACTIVE')
    assert.equal(users[0].lock_reason, null)
  })

  it('an inactive account is rejected before any password check and is not counted', async () => {
    users = [makeUser({ status: 'INACTIVE' })]
    const { status, body } = await login('learner@example.com', 'wrong-password')
    assert.equal(status, 403)
    assert.equal(body.error.code, 'AccountInactive')
    assert.equal(users[0].failed_login_count, 0)
  })
})
