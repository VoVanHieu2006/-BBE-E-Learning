import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { hashToken } from '../lib/tokens'
import { isResetLinkRequestRateLimited, RESET_LINK_RATE_MAX_PER_ADMIN, RESET_LINK_RATE_MAX_PER_USER } from '../lib/email-quota-core'

const stub = (name: string, exports: unknown) => { const filename = require.resolve(name); require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module }
const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8')

type Row = Record<string, any>
const userId = '00000000-0000-4000-8000-0000000000a1'
const adminId = '00000000-0000-4000-8000-0000000000ad'
const db = {
  users: [] as Row[],
  tokens: [] as Row[],
  audit: [] as Row[],
  auditCounts: { actor: 0, user: 0 },
}
let role = 'ADMIN'
let authOk = true
let mailBehaviour: 'ok' | 'fail' | 'quota' | 'throw' = 'ok'
const mailCalls: any[] = []

const prisma: any = {
  user: { findUnique: async ({ where }: any) => db.users.find((row) => row.id === where.id) ?? null },
  passwordResetToken: {
    updateMany: async ({ where, data }: any) => {
      const rows = db.tokens.filter((row) => row.user_id === where.user_id && row.used_at === null)
      rows.forEach((row) => Object.assign(row, data))
      return { count: rows.length }
    },
    create: async ({ data }: any) => { db.tokens.push({ used_at: null, ...data }); return data },
  },
  auditLog: {
    count: async ({ where }: any) => (where.actor_user_id ? db.auditCounts.actor : db.auditCounts.user),
    create: async ({ data }: any) => { db.audit.push(data); return data },
  },
  $transaction: async (ops: any[]) => Promise.all(ops),
}
stub('../lib/prisma', { prisma })
stub('../lib/auth', { authenticate: async () => (authOk ? { ok: true, context: { userId: adminId, role } } : { ok: false, error: { code: 'Unauthorized' } }) })
stub('../lib/email', {
  sendPasswordResetEmail: async (params: any) => {
    mailCalls.push(params)
    if (mailBehaviour === 'throw') throw new Error('boom')
    if (mailBehaviour === 'quota') return { success: false, error: 'Đã hết hạn mức email hôm nay, hãy dùng link mời.', quotaExhausted: true }
    return mailBehaviour === 'ok' ? { success: true } : { success: false, error: 'Resend từ chối' }
  },
})
const lib = require('../lib/password-reset-link') as typeof import('../lib/password-reset-link')
const mailRoute = require('../app/api/v1/users/[userId]/password-reset/route') as typeof import('../app/api/v1/users/[userId]/password-reset/route')
const linkRoute = require('../app/api/v1/users/[userId]/password-reset/link/route') as typeof import('../app/api/v1/users/[userId]/password-reset/link/route')

function reset() {
  db.users.length = 0
  db.tokens.length = 0
  db.audit.length = 0
  db.auditCounts = { actor: 0, user: 0 }
  db.users.push({ id: userId, email: 'hv@bbe.vn', status: 'ACTIVE', lock_reason: null })
  role = 'ADMIN'
  authOk = true
  mailBehaviour = 'ok'
  mailCalls.length = 0
}
const params = (id = userId) => ({ params: { userId: id } })
const req = () => new NextRequest(`http://localhost/api/v1/users/${userId}/password-reset`, { method: 'POST' })
const liveTokens = () => db.tokens.filter((row) => row.used_at === null)

describe('rate limit helper', () => {
  it('blocks at the per-admin and per-user caps only', () => {
    assert.equal(isResetLinkRequestRateLimited({ byActor: RESET_LINK_RATE_MAX_PER_ADMIN - 1, byUser: RESET_LINK_RATE_MAX_PER_USER - 1 }), false)
    assert.equal(isResetLinkRequestRateLimited({ byActor: RESET_LINK_RATE_MAX_PER_ADMIN, byUser: 0 }), true)
    assert.equal(isResetLinkRequestRateLimited({ byActor: 0, byUser: RESET_LINK_RATE_MAX_PER_USER }), true)
  })
})

describe('eligibility and URL', () => {
  it('ACTIVE or password-locked accounts only', () => {
    assert.equal(lib.canIssuePasswordResetLink({ status: 'ACTIVE' }), true)
    assert.equal(lib.canIssuePasswordResetLink({ status: 'LOCKED', lock_reason: 'PASSWORD_LOCK' }), true)
    assert.equal(lib.canIssuePasswordResetLink({ status: 'LOCKED', lock_reason: 'OVERDUE_LOCK' }), false)
    assert.equal(lib.canIssuePasswordResetLink({ status: 'INACTIVE' }), false)
  })
  it('builds /reset-password?token= on the app URL', () => {
    assert.match(lib.buildPasswordResetUrl('abc'), /\/reset-password\?token=abc$/)
  })
})

describe('issuePasswordResetLink', () => {
  it('rotates the token (old dies), expires in 15 minutes, audits without the token', async () => {
    reset()
    db.tokens.push({ user_id: userId, token_hash: 'old', used_at: null, expires_at: new Date(Date.now() + 60000) })
    const before = Date.now()
    const result: any = await lib.issuePasswordResetLink(userId, adminId)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.match(result.token, /^[0-9a-f]{64}$/)
    assert.equal(liveTokens().length, 1, 'only the new token stays usable')
    assert.equal(liveTokens()[0].token_hash, hashToken(result.token))
    assert.equal(liveTokens()[0].user_id, userId)
    assert.ok(Math.abs(result.expiresAt.getTime() - (before + 15 * 60 * 1000)) < 5000)
    assert.equal(db.audit.length, 1)
    assert.deepEqual([db.audit[0].action, db.audit[0].entity_type, db.audit[0].entity_id, db.audit[0].actor_user_id], ['PASSWORD_RESET_LINK_ISSUED', 'USER', userId, adminId])
    const audit = JSON.stringify(db.audit[0])
    assert.ok(!audit.includes(result.token) && !audit.includes(hashToken(result.token)))
  })

  it('two requests give different tokens; only the latest is live', async () => {
    reset()
    const first: any = await lib.issuePasswordResetLink(userId, adminId)
    const second: any = await lib.issuePasswordResetLink(userId, adminId)
    assert.ok(first.ok && second.ok)
    if (!first.ok || !second.ok) return
    assert.notEqual(first.token, second.token)
    assert.deepEqual(liveTokens().map((row) => row.token_hash), [hashToken(second.token)])
  })

  it('password-locked account is allowed; inactive, overdue-locked and unknown are refused with no token or audit', async () => {
    reset()
    db.users[0] = { ...db.users[0], status: 'LOCKED', lock_reason: 'PASSWORD_LOCK' }
    assert.equal((await lib.issuePasswordResetLink(userId, adminId)).ok, true)
    for (const patch of [{ status: 'INACTIVE' }, { status: 'LOCKED', lock_reason: 'OVERDUE_LOCK' }]) {
      reset()
      db.users[0] = { ...db.users[0], ...patch }
      const result: any = await lib.issuePasswordResetLink(userId, adminId)
      assert.equal(result.code, 'InvalidState', JSON.stringify(patch))
      assert.equal(db.tokens.length + db.audit.length, 0)
    }
    reset()
    const missing: any = await lib.issuePasswordResetLink('00000000-0000-4000-8000-0000000000ff', adminId)
    assert.equal(missing.code, 'UserNotFound')
  })

  it('is rate limited per admin and per user, creating nothing', async () => {
    reset()
    db.auditCounts = { actor: RESET_LINK_RATE_MAX_PER_ADMIN, user: 0 }
    assert.equal((await lib.issuePasswordResetLink(userId, adminId) as any).code, 'RateLimited')
    db.auditCounts = { actor: 0, user: RESET_LINK_RATE_MAX_PER_USER }
    assert.equal((await lib.issuePasswordResetLink(userId, adminId) as any).code, 'RateLimited')
    assert.equal(db.tokens.length + db.audit.length, 0)
  })
})

describe('POST /users/[userId]/password-reset (mail route)', () => {
  it('mail sent: emailSent true, old behaviour kept, no link or token in the body', async () => {
    reset()
    const response = await mailRoute.POST(req(), params())
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.deepEqual([body.emailSent, body.delivery], [true, 'EMAIL'])
    assert.match(body.message, /hv@bbe\.vn/)
    assert.equal(mailCalls.length, 1)
    assert.ok(!JSON.stringify(body).includes(mailCalls[0].token))
  })

  it('quota exhausted, provider error or throw: 200 with emailSent false and delivery LINK, no token/link', async () => {
    for (const behaviour of ['quota', 'fail', 'throw'] as const) {
      reset()
      mailBehaviour = behaviour
      const response = await mailRoute.POST(req(), params())
      const body = await response.json()
      assert.equal(response.status, 200, behaviour)
      assert.deepEqual([body.emailSent, body.delivery], [false, 'LINK'], behaviour)
      assert.equal(typeof body.emailError, 'string')
      assert.equal(body.quotaExhausted, behaviour === 'quota')
      assert.equal(response.headers.get('Cache-Control'), 'no-store')
      const text = JSON.stringify(body)
      assert.ok(!/token|reset-password|http/i.test(text), `no token/link in ${text}`)
      if (behaviour !== 'throw') assert.ok(!text.includes(mailCalls[0].token))
    }
  })

  it('account that cannot get a link keeps the hard 502 when mail fails', async () => {
    reset()
    db.users[0].status = 'INACTIVE'
    mailBehaviour = 'fail'
    const response = await mailRoute.POST(req(), params())
    assert.equal(response.status, 502)
    assert.equal((await response.json()).error.code, 'EmailSendFailed')
  })

  it('still admin only and 404 for an unknown user', async () => {
    reset()
    role = 'LEAD'
    assert.equal((await mailRoute.POST(req(), params())).status, 403)
    role = 'ADMIN'
    assert.equal((await mailRoute.POST(req(), params('00000000-0000-4000-8000-0000000000ff'))).status, 404)
  })
})

describe('POST /users/[userId]/password-reset/link (link route)', () => {
  it('admin gets the link once, no-store, only in the response body', async () => {
    reset()
    const response = await linkRoute.POST(req(), params())
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.match(body.link, /\/reset-password\?token=[0-9a-f]{64}$/)
    const token = body.link.split('token=')[1]
    assert.equal(liveTokens()[0].token_hash, hashToken(token))
    assert.equal(body.userId, userId)
    assert.ok(!JSON.stringify(db.audit).includes(token))
  })

  it('anonymous 401, non-admin 403, bad id 400, ineligible 409, rate limited 429, unknown 404', async () => {
    reset()
    authOk = false
    assert.equal((await linkRoute.POST(req(), params())).status, 401)
    authOk = true
    for (const other of ['LEAD', 'CHAPTER_LEADER', 'MEMBER']) {
      role = other
      assert.equal((await linkRoute.POST(req(), params())).status, 403, other)
    }
    role = 'ADMIN'
    assert.equal((await linkRoute.POST(req(), params('not-a-uuid'))).status, 400)
    db.users[0].status = 'INACTIVE'
    assert.equal((await linkRoute.POST(req(), params())).status, 409)
    db.users[0].status = 'ACTIVE'
    db.auditCounts.actor = RESET_LINK_RATE_MAX_PER_ADMIN
    const limited = await linkRoute.POST(req(), params())
    assert.equal(limited.status, 429)
    assert.equal(limited.headers.get('Cache-Control'), 'no-store')
    db.auditCounts.actor = 0
    assert.equal((await linkRoute.POST(req(), params('00000000-0000-4000-8000-0000000000ff'))).status, 404)
    assert.equal(db.tokens.length, 0, 'refused calls create no token')
  })
})

describe('source checks', () => {
  it('public forgot-password route is unchanged: never returns a token or link', () => {
    const source = read('src/app/api/v1/auth/password-reset/request/route.ts')
    assert.match(source, /return NextResponse\.json\(\{ message, sent: true \}/)
    assert.doesNotMatch(source, /password-reset-link|buildPasswordResetUrl|emailSent/)
  })

  it('UI button copies via copyTextLater, never keeps or shows the link, and the page wires it to emailSent === false', () => {
    const button = read('src/components/admin/ResetLinkButton.tsx')
    assert.match(button, /copyTextLater\(link\)/)
    assert.match(button, /password-reset\/link/)
    assert.match(button, /Link đặt lại mật khẩu \$\{email\}/)
    assert.doesNotMatch(button, /useState\(.*link/i)
    assert.doesNotMatch(button, /set\w+\(\s*(link|res\.data\.link)/)
    assert.doesNotMatch(button, /\{link\}|\{res\.data/)
    const page = read('src/app/admin/users/page.tsx')
    assert.match(page, /res\.data\?\.emailSent === false/)
    assert.match(page, /<ResetLinkButton/)
    assert.match(page, /<EmailQuotaNotice/)
  })

  it('no raw SQL and no console logging in the link code (the link must never reach logs)', () => {
    const lib = read('src/lib/password-reset-link.ts')
    assert.doesNotMatch(lib, /\$executeRaw|\$queryRaw/)
    assert.doesNotMatch(read('src/app/api/v1/users/[userId]/password-reset/link/route.ts'), /console\./)
    assert.doesNotMatch(lib, /console\./)
  })
})
