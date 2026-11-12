import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hashToken } from '../lib/tokens'

const stub = (name: string, exports: unknown) => { const filename = require.resolve(name); require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeJS.Module }

type Row = Record<string, any>
const db = {
  invitations: [] as Row[],
  audit: [] as Row[],
  auditCounts: { actor: 0, invitation: 0 },
  updateManyCount: undefined as number | undefined,
  users: [] as Row[],
  memberships: [] as Row[],
  /** Chạy ngay trước transaction: mô phỏng thay đổi được commit trong lúc băm mật khẩu (~0,3 giây). */
  beforeTransaction: undefined as (() => void) | undefined,
}
const emailCalls: any[] = []
let emailBehaviour: 'ok' | 'fail' | 'throw' = 'ok'

const matchRow = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => {
  if (value && typeof value === 'object' && 'gt' in (value as Row)) return row[key] > (value as Row).gt
  if (value && typeof value === 'object' && 'not' in (value as Row)) return row[key] !== (value as Row).not
  return row[key] === value
})

const prisma: any = {
  user: {
    findUnique: async () => null,
    create: async ({ data }: any) => { const row = { id: `user-${db.users.length + 1}`, ...data }; db.users.push(row); return row },
  },
  organizationUnit: { findUnique: async () => ({ type: 'DEPARTMENT', status: 'ACTIVE' }) },
  organizationMembership: { create: async ({ data }: any) => { db.memberships.push(data) } },
  invitation: {
    findFirst: async ({ where }: any) => db.invitations.find((row) => matchRow(row, where)) ?? null,
    findUnique: async ({ where }: any) => db.invitations.find((row) => (where.id ? row.id === where.id : row.token_hash === where.token_hash)) ?? null,
    create: async ({ data }: any) => { const row = { id: `inv-${db.invitations.length + 1}`, delivery_method: 'EMAIL', ...data }; db.invitations.push(row); return row },
    update: async ({ where, data }: any) => { const row = db.invitations.find((r) => r.id === where.id)!; Object.assign(row, data); return row },
    updateMany: async ({ where, data }: any) => {
      const rows = db.invitations.filter((row) => matchRow(row, where))
      const count = db.updateManyCount ?? rows.length
      if (count > 0) rows.forEach((row) => Object.assign(row, data))
      return { count }
    },
  },
  auditLog: {
    count: async ({ where }: any) => (where.actor_user_id ? db.auditCounts.actor : db.auditCounts.invitation),
    create: async ({ data }: any) => { db.audit.push(data) },
  },
  // Giống Prisma: transaction ném lỗi thì hoàn tác toàn bộ (ở đây chụp lại và khôi phục dữ liệu giả).
  $transaction: async (fn: any) => {
    db.beforeTransaction?.()
    const snapshot = JSON.parse(JSON.stringify({ invitations: db.invitations, users: db.users, memberships: db.memberships }), (_k, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v) : v))
    try {
      return await fn(prisma)
    } catch (error) {
      db.invitations.splice(0, db.invitations.length, ...snapshot.invitations)
      db.users.splice(0, db.users.length, ...snapshot.users)
      db.memberships.splice(0, db.memberships.length, ...snapshot.memberships)
      throw error
    }
  },
}
stub('../lib/prisma', { prisma })
stub('../lib/position-replacement', { assignMembershipPosition: async () => {} })
stub('../lib/email', {
  sendInvitationEmail: async (params: any) => {
    emailCalls.push(params)
    if (emailBehaviour === 'throw') throw new Error('boom')
    return emailBehaviour === 'ok' ? { success: true } : { success: false, error: 'Resend từ chối' }
  },
})
stub('../lib/learning-assignments', { reconcileLearningAssignmentsForUser: async () => {} })
const { sendMemberInvitation, issueInvitationLink, resendInvitation, cancelInvitation, acceptInvitation } = require('../lib/invitations')

const base = { email: 'new@bbe.vn', role: 'MEMBER' as const, organizationUnitId: 'unit-1', invitedBy: 'lead-1' }
function reset() {
  db.invitations.length = 0
  db.audit.length = 0
  db.auditCounts = { actor: 0, invitation: 0 }
  db.updateManyCount = undefined
  db.users.length = 0
  db.memberships.length = 0
  db.beforeTransaction = undefined
  emailCalls.length = 0
  emailBehaviour = 'ok'
}
const future = () => new Date(Date.now() + 3600_000)

describe('invitation delivery: email first, link as the safety net', () => {
  it('mail sent: delivery stays EMAIL', async () => {
    reset()
    const result = await sendMemberInvitation(base)
    assert.equal(result.ok, true)
    assert.deepEqual([result.emailSent, result.delivery], [true, 'EMAIL'])
    assert.equal(db.invitations[0].delivery_method, 'EMAIL')
    assert.equal(emailCalls[0].slotDay, undefined, 'the mail layer reserves its own slot in auto mode')
  })

  it('mail refused (quota or provider error): invitation is kept and switches to LINK instead of failing', async () => {
    reset()
    emailBehaviour = 'fail'
    const result = await sendMemberInvitation(base)
    assert.equal(result.ok, true)
    assert.deepEqual([result.emailSent, result.delivery, result.emailError], [false, 'LINK', 'Resend từ chối'])
    assert.equal(db.invitations[0].status, 'PENDING')
    assert.equal(db.invitations[0].delivery_method, 'LINK')
  })

  it('mail layer throws: still not an error, falls back to LINK', async () => {
    reset()
    emailBehaviour = 'throw'
    const result = await sendMemberInvitation(base)
    assert.equal(result.ok, true)
    assert.equal(result.delivery, 'LINK')
    assert.equal(db.invitations[0].delivery_method, 'LINK')
  })

  it('caller found no slot (bulk overflow): no mail is attempted and the invitation is LINK', async () => {
    reset()
    const result = await sendMemberInvitation({ ...base, mail: { kind: 'link' } })
    assert.equal(emailCalls.length, 0)
    assert.deepEqual([result.emailSent, result.delivery], [false, 'LINK'])
    assert.match(result.emailError, /hết hạn mức/)
  })

  it('caller reserved a slot: the day is passed on so the mail layer keeps or refunds that exact slot', async () => {
    reset()
    const result = await sendMemberInvitation({ ...base, mail: { kind: 'reserved', day: '2026-11-11' } })
    assert.equal(emailCalls[0].slotDay, '2026-11-11')
    assert.equal(result.delivery, 'EMAIL')
  })

  it('resending a LINK invitation by mail flips it back to EMAIL when the mail goes out', async () => {
    reset()
    db.invitations.push({ id: 'inv-9', email: 'a@bbe.vn', role: 'MEMBER', invited_by: 'lead-1', status: 'PENDING', delivery_method: 'LINK', token_hash: 'old' })
    const result = await resendInvitation('inv-9', 'lead-1', 'LEAD')
    assert.deepEqual([result.ok, result.delivery], [true, 'EMAIL'])
    assert.equal(db.invitations[0].delivery_method, 'EMAIL')
  })
})

describe('issuing an invite link', () => {
  const link = (overrides: Row = {}) => ({ id: 'inv-1', email: 'x@bbe.vn', role: 'MEMBER', invited_by: 'lead-1', status: 'PENDING', delivery_method: 'LINK', expires_at: future(), token_hash: 'old-hash', ...overrides })

  it('rotates the token (old link dies), keeps the 24h expiry and writes an audit row without the token', async () => {
    reset()
    const expiresAt = future()
    db.invitations.push(link({ expires_at: expiresAt }))
    const result = await issueInvitationLink('inv-1', 'lead-1', 'LEAD', true)
    assert.equal(result.ok, true)
    assert.match(result.token, /^[0-9a-f]{64}$/)
    assert.equal(db.invitations[0].token_hash, hashToken(result.token))
    assert.notEqual(db.invitations[0].token_hash, 'old-hash')
    assert.equal(result.expiresAt, expiresAt)
    assert.equal(db.audit.length, 1)
    assert.deepEqual([db.audit[0].action, db.audit[0].entity_type, db.audit[0].entity_id, db.audit[0].actor_user_id], ['INVITATION_LINK_ISSUED', 'INVITATION', 'inv-1', 'lead-1'])
    assert.ok(!JSON.stringify(db.audit[0]).includes(result.token))
    assert.ok(!JSON.stringify(db.audit[0]).includes(hashToken(result.token)))
  })

  it('two requests give two different tokens, so only the latest link works', async () => {
    reset()
    db.invitations.push(link())
    const first = await issueInvitationLink('inv-1', 'lead-1', 'LEAD', true)
    const second = await issueInvitationLink('inv-1', 'lead-1', 'LEAD', true)
    assert.notEqual(first.token, second.token)
    assert.equal(db.invitations[0].token_hash, hashToken(second.token))
  })

  it('refuses unknown, foreign, non-pending, expired, emailed and cancelled invitations', async () => {
    reset()
    assert.equal((await issueInvitationLink('missing', 'lead-1', 'LEAD', true)).code, 'InvitationNotFound')
    db.invitations.push(link())
    assert.equal((await issueInvitationLink('inv-1', 'someone-else', 'LEAD', false)).code, 'AccessDenied')
    assert.equal((await issueInvitationLink('inv-1', 'someone-else', 'ADMIN', false)).ok, true, 'admin may')
    for (const patch of [{ status: 'ACCEPTED' }, { status: 'CANCELLED' }, { status: 'EXPIRED' }, { expires_at: new Date(Date.now() - 1000) }]) {
      reset()
      db.invitations.push(link(patch))
      const result = await issueInvitationLink('inv-1', 'lead-1', 'LEAD', true)
      assert.equal(result.code, 'InvalidState', JSON.stringify(patch))
      assert.equal(db.invitations[0].token_hash, 'old-hash')
      assert.equal(db.audit.length, 0)
    }
    reset()
    db.invitations.push(link({ delivery_method: 'EMAIL' }))
    assert.equal((await issueInvitationLink('inv-1', 'lead-1', 'LEAD', true)).code, 'NotLinkDelivery')
  })

  it('is rate limited per person and per invitation', async () => {
    reset()
    db.invitations.push(link())
    db.auditCounts = { actor: 60, invitation: 0 }
    assert.equal((await issueInvitationLink('inv-1', 'lead-1', 'LEAD', true)).code, 'RateLimited')
    db.auditCounts = { actor: 0, invitation: 10 }
    assert.equal((await issueInvitationLink('inv-1', 'lead-1', 'LEAD', true)).code, 'RateLimited')
    assert.equal(db.invitations[0].token_hash, 'old-hash')
  })

  it('a race where the invitation was accepted or cancelled between check and update changes nothing', async () => {
    reset()
    db.invitations.push(link())
    db.updateManyCount = 0
    const result = await issueInvitationLink('inv-1', 'lead-1', 'LEAD', true)
    assert.equal(result.code, 'InvalidState')
    assert.equal(db.audit.length, 0)
  })
})

describe('accepting an invitation: claim by token, status and expiry before anything is created', () => {
  const token = 'a'.repeat(64)
  const pending = (overrides: Row = {}) => ({ id: 'inv-1', email: 'New@BBE.vn', role: 'MEMBER', invited_by: 'lead-1', organization_unit_id: 'unit-1', status: 'PENDING', delivery_method: 'LINK', expires_at: future(), token_hash: hashToken(token), ...overrides })

  it('happy path: creates the account and marks the invitation ACCEPTED with accepted_at', async () => {
    reset()
    db.invitations.push(pending())
    const result = await acceptInvitation(token, 'Mat-khau-1')
    assert.equal(result.ok, true)
    assert.equal(db.users.length, 1)
    assert.equal(db.users[0].email, 'new@bbe.vn')
    assert.equal(db.invitations[0].status, 'ACCEPTED')
    assert.ok(db.invitations[0].accepted_at instanceof Date)
  })

  it('link was replaced while the password was being hashed: old link creates nothing', async () => {
    reset()
    db.invitations.push(pending())
    db.beforeTransaction = () => { db.invitations[0].token_hash = hashToken('b'.repeat(64)) }
    const result = await acceptInvitation(token, 'Mat-khau-1')
    assert.deepEqual([result.ok, result.code, result.message], [false, 'TokenAlreadyUsed', 'Link không còn hiệu lực, vui lòng xin link mới'])
    assert.equal(db.users.length, 0)
    assert.equal(db.memberships.length, 0)
    assert.equal(db.invitations[0].status, 'PENDING', 'the new link stays usable')
  })

  it('invitation was cancelled, accepted elsewhere or expired while hashing: nothing is created and status is not overwritten', async () => {
    for (const patch of [{ status: 'CANCELLED' }, { status: 'ACCEPTED' }, { expires_at: new Date(Date.now() - 1000) }]) {
      reset()
      db.invitations.push(pending())
      db.beforeTransaction = () => { Object.assign(db.invitations[0], patch) }
      const result = await acceptInvitation(token, 'Mat-khau-1')
      assert.deepEqual([result.ok, result.code], [false, 'TokenAlreadyUsed'], JSON.stringify(patch))
      assert.equal(db.users.length, 0, JSON.stringify(patch))
      assert.equal(db.invitations[0].status, 'status' in patch ? patch.status : 'PENDING')
    }
  })

  it('a failure after the claim rolls the claim back, so the invitation stays PENDING for a retry', async () => {
    reset()
    db.invitations.push(pending())
    const originalCreate = prisma.organizationMembership.create
    prisma.organizationMembership.create = async () => { throw new Error('db down') }
    try {
      await assert.rejects(() => acceptInvitation(token, 'Mat-khau-1'), /db down/)
    } finally {
      prisma.organizationMembership.create = originalCreate
    }
    assert.equal(db.invitations[0].status, 'PENDING')
    assert.equal(db.invitations[0].accepted_at, undefined)
    assert.equal(db.users.length, 0)
  })

  it('source check: the claim is the first statement of the transaction and is conditional on token, PENDING and expiry', () => {
    const source = require('fs').readFileSync(require.resolve('../lib/invitations.ts'), 'utf8') as string
    const body = source.slice(source.indexOf('export async function acceptInvitation'))
    const tx = body.slice(body.indexOf('prisma.$transaction'))
    assert.ok(tx.indexOf('invitation.updateMany') < tx.indexOf('user.create'), 'claim runs before the user is created')
    assert.match(tx, /updateMany\(\{\s*where: \{ id: invitation\.id, token_hash: tokenHash, status: 'PENDING', expires_at: \{ gt: claimedAt \} \}/)
    assert.doesNotMatch(tx, /invitation\.update\(\{\s*where: \{ id: invitation\.id \},\s*data: \{ status: 'ACCEPTED'/)
  })
})

describe('resend and cancel never undo an accepted invitation', () => {
  it('resend refuses (and changes nothing) when the invitation became ACCEPTED between the check and the update', async () => {
    reset()
    db.invitations.push({ id: 'inv-9', email: 'a@bbe.vn', role: 'MEMBER', invited_by: 'lead-1', status: 'PENDING', delivery_method: 'LINK', token_hash: 'old' })
    const originalFind = prisma.invitation.findUnique
    prisma.invitation.findUnique = async (args: any) => { const row = await originalFind(args); const seen = { ...row }; Object.assign(db.invitations[0], { status: 'ACCEPTED' }); return seen }
    try {
      const result = await resendInvitation('inv-9', 'lead-1', 'LEAD')
      assert.deepEqual([result.ok, result.code], [false, 'InvalidState'])
    } finally {
      prisma.invitation.findUnique = originalFind
    }
    assert.equal(db.invitations[0].status, 'ACCEPTED')
    assert.equal(db.invitations[0].token_hash, 'old')
    assert.equal(emailCalls.length, 0)
  })

  it('resend still revives cancelled and expired invitations', async () => {
    for (const status of ['CANCELLED', 'EXPIRED']) {
      reset()
      db.invitations.push({ id: 'inv-9', email: 'a@bbe.vn', role: 'MEMBER', invited_by: 'lead-1', status, delivery_method: 'LINK', token_hash: 'old' })
      const result = await resendInvitation('inv-9', 'lead-1', 'LEAD')
      assert.equal(result.ok, true, status)
      assert.equal(db.invitations[0].status, 'PENDING')
    }
  })

  it('cancel does not overwrite ACCEPTED when the accept lands between the check and the update', async () => {
    reset()
    db.invitations.push({ id: 'inv-8', email: 'a@bbe.vn', role: 'MEMBER', invited_by: 'lead-1', status: 'PENDING', delivery_method: 'LINK', token_hash: 'old' })
    const originalFind = prisma.invitation.findUnique
    prisma.invitation.findUnique = async (args: any) => { const row = await originalFind(args); const seen = { ...row }; Object.assign(db.invitations[0], { status: 'ACCEPTED' }); return seen }
    try {
      const result = await cancelInvitation('inv-8', 'lead-1', 'LEAD')
      assert.deepEqual([result.ok, result.code], [false, 'InvalidState'])
    } finally {
      prisma.invitation.findUnique = originalFind
    }
    assert.equal(db.invitations[0].status, 'ACCEPTED')
  })
})
