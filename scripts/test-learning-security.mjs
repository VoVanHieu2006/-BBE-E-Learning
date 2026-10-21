import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { SignJWT } from 'jose'

const target = process.env.TEST_DATABASE_URL
if (!target) throw new Error('TEST_DATABASE_URL is required; no application database fallback.')
const url = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/bbe_test_learning_cycles') throw new Error('Only local bbe_test_learning_cycles is allowed.')
const app = new URL(process.env.TEST_APP_URL || 'http://127.0.0.1:3112')
if (!['127.0.0.1', 'localhost'].includes(app.hostname)) throw new Error('Only a local test app is allowed.')
if (!process.env.JWT_ACCESS_SECRET || !process.env.CRON_SECRET) throw new Error('Explicit test JWT_ACCESS_SECRET and CRON_SECRET are required.')
process.env.DATABASE_URL = target; process.env.DIRECT_URL = target
const { PrismaClient } = await import('@prisma/client')
const db = new PrismaClient()
const prefix = randomUUID()
const token = (user) => new SignJWT({ role: user.role }).setProtectedHeader({ alg: 'HS256' }).setSubject(user.id).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET))
async function call(path, bearer, method = 'GET', body) {
  const response = await fetch(new URL(path, app), { method, headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { status: response.status, body: await response.json().catch(() => null) }
}
try {
  const admin = await db.user.create({ data: { email: `${prefix}-admin@example.invalid`, role: 'ADMIN', password_hash: '-' } })
  const lead = await db.user.create({ data: { email: `${prefix}-lead@example.invalid`, role: 'CHAPTER_LEADER', password_hash: '-' } })
  const member = await db.user.create({ data: { email: `${prefix}-member@example.invalid`, role: 'MEMBER', password_hash: '-' } })
  const root = await db.organizationUnit.create({ data: { type: 'ROOT', name: prefix } })
  const chapters = []
  for (let index = 0; index < 2; index++) {
    const unit = await db.organizationUnit.create({ data: { type: 'CHAPTER', name: `${prefix}-${index}`, parent_id: root.id } })
    const chapter = await db.chapter.create({ data: { name: `${prefix}-${index}`, organization_unit_id: unit.id } })
    const department = await db.organizationUnit.create({ data: { name: 'Ban Thành Viên', code: 'BTV', type: 'DEPARTMENT', parent_id: unit.id } })
    chapters.push({ ...chapter, department })
  }
  await db.chapterMember.create({ data: { chapter_id: chapters[0].id, user_id: lead.id } })
  await db.chapterMember.create({ data: { chapter_id: chapters[1].id, user_id: member.id } })
  await db.organizationMembership.create({ data: { unit_id: chapters[1].organization_unit_id, user_id: member.id } })
  const batch = await db.chapterReorganization.create({ data: { chapter_id: chapters[1].id, effective_at: new Date(Date.now() - 60_000), status: 'SCHEDULED', created_by_user_id: admin.id, items: { create: { user_id: member.id, department_unit_id: chapters[1].department.id } } } })
  const [adminToken, leadToken, memberToken] = await Promise.all([token(admin), token(lead), token(member)])
  const batchPath = `/api/v1/chapters/${chapters[1].id}/reorganizations/${batch.id}`
  for (const method of ['POST', 'DELETE']) assert.equal((await call(batchPath, leadToken, method)).status, 403, `cross-Chapter ${method} must fail`)
  assert.equal((await call(`/api/v1/chapters/${chapters[1].id}/members/${member.id}/department`, leadToken, 'POST', { departmentUnitId: chapters[1].department.id })).status, 403)
  assert.equal((await call(`/api/v1/chapters/${chapters[1].id}/members/bulk-deactivate`, leadToken, 'POST', { userIds: [member.id] })).status, 403)
  assert.equal((await call(`/api/v1/chapters/${chapters[0].id}/members/bulk-deactivate`, leadToken, 'POST', { userIds: [member.id] })).status, 403)
  assert.equal((await call(`/api/v1/chapters/${chapters[0].id}/members/${member.id}/department`, leadToken, 'POST', { departmentUnitId: chapters[0].department.id })).status, 404)
  for (const path of [`/api/v1/chapters/${chapters[1].id}/reorganizations`, `/api/v1/chapters/${chapters[1].id}/current-roster`, `/api/v1/chapters/${chapters[1].id}/dashboard/members`]) assert.equal((await call(path, adminToken)).status, 200)
  assert.equal((await db.chapterReorganization.findUniqueOrThrow({ where: { id: batch.id } })).status, 'SCHEDULED', 'GET must never apply a due transfer')
  assert.equal((await call('/api/v1/admin/learning-policy', memberToken)).status, 403)
  assert.equal((await call('/api/v1/admin/learning-policy', adminToken)).status, 200)
  assert.equal((await call('/api/v1/admin/learning-policy', adminToken, 'PUT', { targets: [{ code: 'not valid' }] })).status, 400)
  assert.equal((await call('/api/internal/organization/reorganizations/apply')).status, 401)
  assert.equal((await call('/api/internal/attempts/auto-submit', undefined, 'POST')).status, 401)
  const leaderboard = await call('/api/v1/leaderboard?group=MEMBER&periodType=MONTH', memberToken)
  assert.equal(leaderboard.status, 200)
  assert.ok((leaderboard.body.items || []).every((row) => !('email' in row)))
  assert.equal((await call('/api/v1/learning/me', memberToken)).status, 200)
  await db.chapterReorganization.update({ where: { id: batch.id }, data: { status: 'CANCELLED' } })
  const inactive = await db.user.create({ data: { email: `${prefix}-retire@example.invalid`, display_name: 'Retirement fixture', role: 'MEMBER', password_hash: 'secret-test', status: 'INACTIVE', deactivated_at: new Date(Date.now() - 31 * 86_400_000) } })
  await db.starLedger.create({ data: { user_id: inactive.id, amount: 7, reason: 'ADMIN_ADJUSTMENT', reward_key: prefix, source_type: 'USER', source_id: inactive.id } })
  const badEvent = await db.learningOutbox.create({ data: { kind: 'RECONCILE_ASSIGNMENTS', event_key: `bad:${prefix}`, user_id: randomUUID(), payload: {} } })
  assert.equal((await call('/api/internal/organization/reorganizations/apply', process.env.CRON_SECRET)).status, 200)
  const retired = await db.user.findUniqueOrThrow({ where: { id: inactive.id } })
  assert.ok(retired.anonymized_at)
  assert.equal(retired.display_name, null)
  assert.equal((await db.starLedger.aggregate({ where: { user_id: inactive.id }, _sum: { amount: true } }))._sum.amount, 7)
  const failed = await db.learningOutbox.findUniqueOrThrow({ where: { id: badEvent.id } })
  assert.ok(failed.last_error)
  assert.equal(failed.processed_at, null)
  await db.learningOutbox.update({ where: { id: failed.id }, data: { user_id: member.id, available_at: new Date(Date.now() + 86_400_000) } })
  assert.equal((await call('/api/v1/admin/learning-policy', memberToken, 'PUT', { retryOutboxIds: [failed.id] })).status, 403)
  assert.equal((await call('/api/v1/admin/learning-policy', adminToken, 'PUT', { retryOutboxIds: [failed.id] })).status, 200)
  assert.ok((await db.learningOutbox.findUniqueOrThrow({ where: { id: failed.id } })).available_at <= new Date())
  assert.equal((await call('/api/internal/organization/reorganizations/apply', process.env.CRON_SECRET)).status, 200)
  assert.ok((await db.learningOutbox.findUniqueOrThrow({ where: { id: failed.id } })).processed_at)
  assert.equal((await call(`/api/v1/users/${inactive.id}`, adminToken, 'PATCH', { status: 'ACTIVE' })).status, 409)
  console.log('PASS: cross-Chapter apply/cancel/department denial, target membership checks, read-only GETs, Admin mapping authorization, protected cron, no leaderboard email, retirement preserving history and durable job retry.')
} finally { await db.$disconnect() }
