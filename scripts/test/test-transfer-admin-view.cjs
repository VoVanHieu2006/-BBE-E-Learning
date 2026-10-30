const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
require('ts-node').register({ project: 'tsconfig.test.json', transpileOnly: true })
const Module = require('node:module'), resolve = Module._resolveFilename
Module._resolveFilename = function (name, ...args) { return resolve.call(this, name.startsWith('@/') ? path.resolve('src', name.slice(2)) : name, ...args) }
const stub = (file, exports) => { const id = require.resolve(file); require.cache[id] = { id, filename: id, loaded: true, exports } }

let authContext = { userId: 'admin', role: 'ADMIN' }
stub('../../src/lib/auth', { authenticate: async () => ({ ok: true, context: authContext }) })

const { windowOf, windowOfAnchor } = require('../../src/lib/transfer-windows')

// Fixed past windows keep overdue/late calculations deterministic.
const current = windowOfAnchor(new Date('2025-04-01T00:00:00+07:00'))
const previous = windowOf(new Date(current.startsAt.getTime() - 1000))
const previousNext = windowOf(new Date(current.endsAt.getTime() - 1000))
assert.equal(previousNext.startsAt.getTime(), current.startsAt.getTime())

const CHAPTER_A = '11111111-1111-4111-8111-111111111111'
const CHAPTER_B = '22222222-2222-4222-8222-222222222222'
const CHAPTER_C = '33333333-3333-4333-8333-333333333333'
const CHAPTER_D = '44444444-4444-4444-8444-444444444444'
const SEASON_H1 = 'season-2025-h1'
const CREATED_AT = new Date('2024-01-01T00:00:00.000Z')

const chapters = [
  { id: CHAPTER_A, name: 'Alpha', status: 'ACTIVE', current_term_number: 2, created_at: CREATED_AT },
  { id: CHAPTER_B, name: 'Beta', status: 'ACTIVE', current_term_number: 2, created_at: CREATED_AT },
  { id: CHAPTER_C, name: 'Gamma', status: 'ACTIVE', current_term_number: 1, created_at: CREATED_AT },
  { id: CHAPTER_D, name: 'Delta', status: 'INACTIVE', current_term_number: 1, created_at: CREATED_AT },
]

const seasons = [
  { id: SEASON_H1, code: 'SEASON_2025_H1', starts_at: current.startsAt, ends_at: current.endsAt, reward_boundary_at: current.anchor },
]

const fiveMinutes = 5 * 60_000
const batches = [
  { id: 'batch-a-previous', chapter_id: CHAPTER_A, effective_at: previous.anchor, applied_at: new Date(previous.anchor.getTime() + 2 * 60_000), status: 'APPLIED', term_number: 1, transfer_season_id: null, last_error: null, apply_attempts: 1 },
  { id: 'batch-a-current', chapter_id: CHAPTER_A, effective_at: current.anchor, applied_at: new Date(current.anchor.getTime() + fiveMinutes), status: 'APPLIED', term_number: 2, transfer_season_id: SEASON_H1, last_error: null, apply_attempts: 2 },
  { id: 'batch-b-current', chapter_id: CHAPTER_B, effective_at: new Date('2025-05-01T00:00:00+07:00'), applied_at: null, status: 'SCHEDULED', term_number: 2, transfer_season_id: SEASON_H1, last_error: null, apply_attempts: 0 },
  { id: 'batch-a-cancelled', chapter_id: CHAPTER_A, effective_at: new Date('2025-03-01T00:00:00+07:00'), applied_at: null, status: 'CANCELLED', term_number: 2, transfer_season_id: SEASON_H1, last_error: null, apply_attempts: 0 },
]

const db = {
  chapter: {
    findMany: async () => chapters,
    findUnique: async ({ where }) => chapters.find((chapter) => chapter.id === where.id) || null,
  },
  transferSeason: { findMany: async () => seasons },
  chapterReorganization: {
    findMany: async ({ where }) => {
      const statuses = where?.status?.in
      let rows = where?.chapter_id ? batches.filter((batch) => batch.chapter_id === where.chapter_id) : batches
      if (statuses) rows = rows.filter((batch) => statuses.includes(batch.status))
      return [...rows].sort((a, b) => b.effective_at.getTime() - a.effective_at.getTime())
    },
    groupBy: async ({ where }) => {
      const counts = new Map()
      for (const batch of batches) {
        if (batch.chapter_id !== where.chapter_id) continue
        counts.set(batch.status, (counts.get(batch.status) || 0) + 1)
      }
      return Array.from(counts, ([status, count]) => ({ status, _count: { _all: count } }))
    },
    findFirst: async ({ where }) => {
      const applied = batches
        .filter((batch) => batch.chapter_id === where.chapter_id && batch.status === 'APPLIED' && batch.applied_at)
        .sort((a, b) => b.applied_at.getTime() - a.applied_at.getTime())[0]
      return applied ? { effective_at: applied.effective_at, applied_at: applied.applied_at } : null
    },
  },
}
stub('../../src/lib/prisma', { prisma: db })

const progressRoute = require('../../src/app/api/v1/admin/transfer-seasons/progress/route')
const historyRoute = require('../../src/app/api/v1/admin/transfer-seasons/chapters/[chapterId]/route')

const BASE = 'http://localhost/api/v1/admin/transfer-seasons/progress'

async function getProgress(query = '') {
  const response = await progressRoute.GET({ url: `${BASE}${query}` })
  return { status: response.status, body: await response.json() }
}

async function getHistory(chapterId) {
  const response = await historyRoute.GET(
    { url: `http://localhost/api/v1/admin/transfer-seasons/chapters/${chapterId}` },
    { params: { chapterId } },
  )
  return { status: response.status, body: await response.json() }
}

test('progress view returns one selected window with paginated chapter rows', async () => {
  const { status, body } = await getProgress()
  assert.equal(status, 200)
  assert.equal(body.selectedWindowKey, current.startsAt.toISOString())
  assert.equal(body.windows.length, 2)
  assert.equal(body.windows[0].status, 'OK')
  assert.equal(body.windows[1].status, 'SEASON_NOT_CONFIGURED')
  assert.equal(body.windowsTruncated, false)
  assert.equal(body.items.length, 1)
  assert.deepEqual(body.items[0].pagination, { page: 1, pageSize: 20, total: 3, totalPages: 1 })
  assert.deepEqual(body.items[0].chapters.map((row) => row.status), ['APPLIED', 'SCHEDULED', 'NONE'])

  const alpha = body.items[0].chapters[0]
  assert.equal(alpha.id, CHAPTER_A)
  assert.equal(alpha.totalAppliedCount, 2)
  assert.equal(new Date(alpha.lastAppliedAt).toISOString(), current.anchor.toISOString())
  assert.equal(alpha.lateApplication, true)
  assert.equal(alpha.appliedDelayMinutes, 5)

  const beta = body.items[0].chapters[1]
  assert.equal(beta.id, CHAPTER_B)
  assert.equal(beta.pendingOverdue, true)
  assert.equal(beta.totalAppliedCount, 0)
  assert.equal(body.items[0].counts.overdue, 1)
})

test('progress filters by chapter name, status and overdue flag', async () => {
  const byName = await getProgress('?q=alpha&status=APPLIED')
  assert.equal(byName.body.items[0].pagination.total, 1)
  assert.equal(byName.body.items[0].chapters[0].id, CHAPTER_A)

  const overdue = await getProgress('?status=OVERDUE')
  assert.equal(overdue.body.items[0].pagination.total, 1)
  assert.equal(overdue.body.items[0].chapters[0].id, CHAPTER_B)

  const none = await getProgress('?status=NONE')
  assert.equal(none.body.items[0].pagination.total, 1)
  assert.equal(none.body.items[0].chapters[0].id, CHAPTER_C)
})

test('progress clamps pages, page size and rejects unknown window keys', async () => {
  const pages = await getProgress('?page=99&pageSize=2')
  assert.deepEqual(pages.body.items[0].pagination, { page: 2, pageSize: 2, total: 3, totalPages: 2 })
  assert.equal(pages.body.items[0].chapters.length, 1)

  const big = await getProgress('?pageSize=1000')
  assert.equal(big.body.items[0].pagination.pageSize, 100)

  const unknown = await getProgress('?window=1999-01-01T00:00:00.000Z')
  assert.equal(unknown.body.selectedWindowKey, current.startsAt.toISOString())
})

test('progress can select an older window from the summary list', async () => {
  const { body } = await getProgress(`?window=${encodeURIComponent(previous.startsAt.toISOString())}`)
  assert.equal(body.selectedWindowKey, previous.startsAt.toISOString())
  assert.equal(body.items[0].status, 'SEASON_NOT_CONFIGURED')
  assert.equal(body.items[0].counts.transferred, 1)
  assert.equal(body.items[0].chapters[0].id, CHAPTER_A)
  assert.equal(body.items[0].chapters[0].totalAppliedCount, 2)
})

test('chapter history exposes lifetime counts and every status entry', async () => {
  const { status, body } = await getHistory(CHAPTER_A)
  assert.equal(status, 200)
  assert.equal(body.chapter.id, CHAPTER_A)
  assert.deepEqual(body.summary, {
    appliedCount: 2,
    scheduledCount: 0,
    cancelledCount: 1,
    lastAppliedAt: current.anchor.toISOString(),
  })
  assert.equal(body.entries.length, 3)
  assert.equal(body.entriesTruncated, false)
  const applied = body.entries.find((entry) => entry.id === 'batch-a-current')
  assert.equal(applied.windowKey, current.startsAt.toISOString())
  assert.equal(applied.seasonCode, 'SEASON_2025_H1')
  assert.equal(new Date(applied.actualTransferAt).toISOString(), current.anchor.toISOString())
  assert.equal(new Date(applied.appliedAt).getTime(), current.anchor.getTime() + fiveMinutes)
  const cancelled = body.entries.find((entry) => entry.id === 'batch-a-cancelled')
  assert.equal(cancelled.statusLabel, 'Đã hủy')
  assert.equal(cancelled.actualTransferAt, null)
})

test('history rejects invalid or unknown chapters', async () => {
  const invalid = await getHistory('not-a-uuid')
  assert.equal(invalid.status, 404)
  assert.equal(invalid.body.error.code, 'ChapterNotFound')

  const missing = await getHistory('99999999-9999-4999-8999-999999999999')
  assert.equal(missing.status, 404)
  assert.equal(missing.body.error.code, 'ChapterNotFound')
})

test('non-admin cannot read transfer progress or chapter history', async () => {
  authContext = { userId: 'leader', role: 'CHAPTER_LEADER' }
  const progress = await getProgress()
  assert.equal(progress.status, 403)
  assert.equal(progress.body.error.code, 'AccessDenied')
  const history = await getHistory(CHAPTER_A)
  assert.equal(history.status, 403)
  assert.equal(history.body.error.code, 'AccessDenied')
  authContext = { userId: 'admin', role: 'ADMIN' }
})
