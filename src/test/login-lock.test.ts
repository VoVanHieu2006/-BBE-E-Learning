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
let affiliated = true
let bcryptCompares = 0
const realCompare = bcrypt.compare
;(bcrypt as any).compare = (...args: any[]) => { bcryptCompares++; return (realCompare as any)(...args) }

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
  stub('../lib/affiliation-access', { hasActiveAffiliation: async () => affiliated })
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

const GENERIC = /^Tài khoản hoặc mật khẩu không đúng/

describe('POST /api/v1/auth/login lock rules (KHBB 7.2)', () => {
  beforeEach(() => { users = [makeUser()]; refreshTokens = []; invalidated = []; affiliated = true; bcryptCompares = 0 })

  it('answers the same generic 401 for the first four wrong passwords, without remaining attempts', async () => {
    for (const count of [1, 2, 3, 4]) {
      const { status, body } = await login('learner@example.com', 'wrong-password')
      assert.equal(status, 401)
      assert.equal(body.error.code, 'InvalidCredentials')
      assert.match(body.error.message, GENERIC)
      assert.match(body.error.message, /Quên mật khẩu/)
      assert.equal('remainingAttempts' in body.error, false)
      assert.equal(users[0].failed_login_count, count)
      assert.equal(users[0].status, 'ACTIVE')
    }
  })

  it('locks the account on the fifth wrong password (PASSWORD_LOCK, no timed unlock) but still answers the generic 401', async () => {
    const first = await login('learner@example.com', 'wrong-password')
    for (let attempt = 0; attempt < 3; attempt++) await login('learner@example.com', 'wrong-password')
    const fifth = await login('learner@example.com', 'wrong-password')
    assert.equal(fifth.status, 401)
    assert.deepEqual(fifth.body, first.body, 'the lock is not revealed to someone without the password')
    assert.equal(users[0].status, 'LOCKED')
    assert.equal(users[0].lock_reason, 'PASSWORD_LOCK')
    assert.equal(users[0].locked_until, null, 'no locked_until: the lock never expires by itself')
    assert.deepEqual(invalidated, ['user-1'])
  })

  it('an unknown email and a known email with a wrong password get the identical response, and both run bcrypt', async () => {
    const unknown = await login('nobody@example.com', 'wrong-password')
    assert.equal(bcryptCompares, 1, 'dummy bcrypt runs when the email does not exist')
    const known = await login('learner@example.com', 'wrong-password')
    assert.equal(bcryptCompares, 2)
    assert.equal(unknown.status, known.status)
    assert.deepEqual(unknown.body, known.body)
  })

  it('locked, inactive and no-affiliation accounts with a wrong password get the generic 401 and are not counted', async () => {
    const reference = (await login('nobody@example.com', 'wrong-password')).body
    const cases: Array<[Partial<StoredUser>, boolean]> = [
      [{ status: 'LOCKED', lock_reason: 'PASSWORD_LOCK', failed_login_count: 5 }, true],
      [{ status: 'LOCKED', lock_reason: 'OVERDUE_LOCK' }, true],
      [{ status: 'INACTIVE' }, true],
      [{ status: 'ACTIVE' }, false],
    ]
    for (const [patch, hasAffiliation] of cases) {
      users = [makeUser(patch)]
      affiliated = hasAffiliation
      const countBefore = users[0].failed_login_count
      const { status, body } = await login('learner@example.com', 'wrong-password')
      assert.equal(status, 401)
      assert.deepEqual(body, reference)
      assert.equal(users[0].failed_login_count, countBefore)
      assert.equal(users[0].status, patch.status)
    }
  })

  it('a password-locked account cannot sign in with the right password, is told to reset, and nothing is written', async () => {
    users = [makeUser({ status: 'LOCKED', lock_reason: 'PASSWORD_LOCK', failed_login_count: 5 })]
    const { status, body } = await login('learner@example.com', PASSWORD)
    assert.equal(status, 403)
    assert.equal(body.error.code, 'AccountLocked')
    assert.equal(body.error.lockReason, 'PASSWORD_LOCK')
    assert.match(body.error.message, /Quên mật khẩu/)
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

  it('an inactive account with the right password gets AccountInactive and no session', async () => {
    users = [makeUser({ status: 'INACTIVE' })]
    const { status, body } = await login('learner@example.com', PASSWORD)
    assert.equal(status, 403)
    assert.equal(body.error.code, 'AccountInactive')
    assert.equal(refreshTokens.length, 0)
  })

  it('an account without an active affiliation and the right password gets NoActiveAffiliation', async () => {
    affiliated = false
    const { status, body } = await login('learner@example.com', PASSWORD)
    assert.equal(status, 403)
    assert.equal(body.error.code, 'NoActiveAffiliation')
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
})
