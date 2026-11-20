import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Route-level test of POST /api/v1/auth/password-reset/request with in-memory doubles:
// anonymous callers must not be able to burn the shared email quota for one account.

type Token = { user_id: string; created_at: Date; used_at: Date | null }
let tokens: Token[] = []
let mails = 0
const user = { id: 'user-1', email: 'learner@example.com', status: 'ACTIVE', lock_reason: null, locked_until: null }

const fakePrisma = {
  user: { findUnique: async ({ where }: any) => (where.email === user.email ? user : null) },
  passwordResetToken: {
    findMany: async ({ where, take }: any) => tokens
      .filter((t) => t.user_id === where.user_id && t.created_at > where.created_at.gt)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, take),
    updateMany: async () => ({ count: 0 }),
    create: async ({ data }: any) => { tokens.push({ user_id: data.user_id, created_at: new Date(), used_at: null }); return {} },
  },
}

function stub(modulePath: string, exports: Record<string, unknown>) {
  const filename = require.resolve(modulePath)
  require.cache[filename] = { id: filename, filename, loaded: true, exports, children: [], paths: [] } as unknown as NodeJS.Module
}

let POST: (request: any) => Promise<Response>

before(() => {
  stub('../lib/prisma', { prisma: fakePrisma })
  stub('../lib/email', { sendPasswordResetEmail: async () => { mails++ } })
  POST = require('../app/api/v1/auth/password-reset/request/route').POST
})

beforeEach(() => { tokens = []; mails = 0 })

async function request(body: unknown) {
  const { NextRequest } = require('next/server')
  const response = await POST(new NextRequest('http://localhost/api/v1/auth/password-reset/request', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
  return { status: response.status, body: await response.json() as any }
}

describe('password reset request throttle', () => {
  it('sends the first email', async () => {
    const res = await request({ email: user.email })
    assert.equal(res.status, 200)
    assert.equal(mails, 1)
  })

  it('does not send a second email within one minute, but answers the same way', async () => {
    await request({ email: user.email })
    const res = await request({ email: user.email })
    assert.equal(res.status, 200)
    assert.equal(mails, 1)
  })

  it('caps emails at 3 per hour per account', async () => {
    const tenMinutes = 10 * 60 * 1000
    tokens = [1, 2, 3].map((n) => ({ user_id: user.id, created_at: new Date(Date.now() - n * tenMinutes), used_at: null }))
    await request({ email: user.email })
    assert.equal(mails, 0)
  })

  it('allows a new email once older requests leave the one-hour window', async () => {
    tokens = [1, 2, 3].map((n) => ({ user_id: user.id, created_at: new Date(Date.now() - (60 + n) * 60 * 1000), used_at: null }))
    await request({ email: user.email })
    assert.equal(mails, 1)
  })

  it('rejects a malformed body with 400 instead of crashing', async () => {
    assert.equal((await request('not json')).status, 400)
    assert.equal((await request({ email: 123 })).status, 400)
  })
})
