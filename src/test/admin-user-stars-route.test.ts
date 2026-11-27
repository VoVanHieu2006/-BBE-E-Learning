import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const QUIZ = id(50), ATTEMPT = id(51)
const awardedAt = new Date('2026-11-15T03:00:00Z')
const users = new Map([
  [id(1), { id: id(1), display_name: 'Học viên', email: 'member@bbe.vn', role: 'MEMBER', status: 'ACTIVE' }],
  [id(2), { id: id(2), display_name: 'Đã nghỉ', email: 'inactive@bbe.vn', role: 'MEMBER', status: 'INACTIVE' }],
  [id(3), { id: id(3), display_name: 'Khóa quá hạn', email: 'overdue@bbe.vn', role: 'MEMBER', status: 'LOCKED' }],
  [id(4), { id: id(4), display_name: 'Khóa mật khẩu', email: 'password@bbe.vn', role: 'MEMBER', status: 'LOCKED' }],
  [id(5), { id: id(5), display_name: 'Trưởng chapter', email: 'lead@bbe.vn', role: 'LEAD', status: 'ACTIVE' }],
])
const managers = new Set([id(5)]) // promoted lead: displayed balance 0, legacy ledger stays visible
let auth: { ok: boolean; role?: string } = { ok: true, role: 'ADMIN' }
let lastFilterValues: unknown[] = []

const prisma = {
  user: { findUnique: async ({ where }: any) => users.get(where.id) ?? null },
  starLedger: { aggregate: async () => ({ _sum: { amount: 42 } }) },
  $queryRaw: async (strings: TemplateStringsArray, ...values: Prisma.Sql[]) => {
    const query = Prisma.sql(strings, ...values)
    if (query.sql.includes('to_char(')) return [{ key: '2026-11' }, { key: '2026-10' }]
    if (query.sql.includes('count(DISTINCT history_key)')) { lastFilterValues = query.values; return [{ total: 1, amount: 18 }] }
    return [{ id: id(60), amount: 18, reason: 'MODULE_QUIZ_BONUS', awarded_at: awardedAt, source_type: 'ASSESSMENT', source_id: QUIZ, metadata: { attemptId: ATTEMPT } }]
  },
  video: { findMany: async () => [] },
  lesson: { findMany: async () => [] },
  assessment: { findMany: async () => [{ id: QUIZ, title: 'Quiz mở đầu', lesson: { title: 'Bài mở đầu', session: { course: { id: id(70), title: 'Khóa Kỹ năng' } } }, course: null }] },
}
const stub = (path: string, exports: unknown) => { const resolved = require.resolve(path); require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as NodeModule }
stub('../lib/auth', { authenticate: async () => auth.ok
  ? { ok: true, context: { userId: id(99), role: auth.role } }
  : { ok: false, error: { code: 'UNAUTHORIZED', message: 'Phiên đã hết hiệu lực. Vui lòng đăng nhập lại.' } } })
stub('../lib/prisma', { prisma })
stub('../lib/manager-learning-access', { isLearningManager: async (userId: string) => managers.has(userId) })
const route = require('../app/api/v1/admin/users/[userId]/stars/route') as typeof import('../app/api/v1/admin/users/[userId]/stars/route')

const get = (userId: string, search = '') => route.GET(new NextRequest(`http://localhost/api/v1/admin/users/${userId}/stars${search}`), { params: { userId } })

describe('GET /api/v1/admin/users/[userId]/stars', () => {
  it('401 khi chưa đăng nhập', async () => {
    auth = { ok: false }
    const response = await get(id(1))
    assert.equal(response.status, 401)
    assert.equal((await response.json()).error.code, 'UNAUTHORIZED')
  })
  it('403 AccessDenied cho mọi vai trò không phải ADMIN', async () => {
    for (const role of ['MEMBER', 'LEAD', 'DNA_LEAD', 'CHAPTER_MANAGER']) {
      auth = { ok: true, role }
      const response = await get(id(1))
      assert.equal(response.status, 403, role)
      const body = await response.json()
      assert.equal(body.error.code, 'AccessDenied')
      assert.ok(body.error.message.length > 0)
      assert.equal(body.items, undefined, 'no data leaks')
    }
  })
  it('400 ValidationError cho userId, month hoặc source không hợp lệ', async () => {
    auth = { ok: true, role: 'ADMIN' }
    for (const [userId, search] of [['abc', ''], [id(1), '?month=2026-13'], [id(1), '?month=abc'], [id(1), '?source=QUIZ']]) {
      const response = await get(userId, search)
      assert.equal(response.status, 400, `${userId}${search}`)
      assert.equal((await response.json()).error.code, 'ValidationError')
    }
  })
  it('404 UserNotFound khi tài khoản không tồn tại', async () => {
    auth = { ok: true, role: 'ADMIN' }
    const response = await get(id(98))
    assert.equal(response.status, 404)
    assert.equal((await response.json()).error.code, 'UserNotFound')
  })
  it('200 cho tài khoản ACTIVE, INACTIVE, bị khóa và LEAD, không cache, đủ tổng và mục đã gắn tên', async () => {
    auth = { ok: true, role: 'ADMIN' }
    for (const user of Array.from(users.values())) {
      const response = await get(user.id, '?month=2026-11&source=lesson_quiz')
      assert.equal(response.status, 200, user.email)
      assert.equal(response.headers.get('Cache-Control'), 'no-store')
      const body = await response.json()
      assert.deepEqual(body.user, { id: user.id, displayName: user.display_name, email: user.email, role: user.role, status: user.status })
      assert.equal(body.balance, managers.has(user.id) ? 0 : 42)
      assert.equal(body.ledgerTotal, 42)
      assert.equal(body.filteredTotal, 18)
      assert.deepEqual(body.availableMonths, [{ key: '2026-11', label: 'Tháng 11/2026' }, { key: '2026-10', label: 'Tháng 10/2026' }])
      assert.deepEqual(body.filters, { month: '2026-11', source: 'LESSON_QUIZ' })
      assert.deepEqual([body.page, body.limit, body.totalItems, body.totalPages], [1, 20, 1, 1])
      assert.deepEqual(body.items, [{
        id: id(60), amount: 18, reason: 'MODULE_QUIZ_BONUS', awarded_at: awardedAt.toISOString(), source_type: 'ASSESSMENT',
        lessonTitle: 'Bài mở đầu', courseTitle: 'Khóa Kỹ năng', quizTitle: 'Quiz mở đầu', detail: 'Vượt qua bài kiểm tra: Quiz mở đầu · Bài mở đầu',
      }])
      assert.deepEqual(lastFilterValues, [user.id, '2026-11', '2026-10-31T17:00:00.000Z', '2026-11-30T17:00:00.000Z', ['MODULE_QUIZ_PASS', 'MODULE_QUIZ_BONUS']])
    }
  })
})
