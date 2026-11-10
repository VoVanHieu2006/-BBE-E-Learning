const assert = require('node:assert/strict')
const { test } = require('node:test')
require('ts-node').register({ project: 'tsconfig.test.json' })
require('./alias-hook.cjs')
const Module = require('node:module'), load = Module._load
let role = 'ADMIN'
Module._load = function (name, ...args) {
  if (name === '@/lib/auth' || name === './auth') return { authenticate: async () => role ? { ok: true, context: { role, userId: 'admin' } } : { ok: false, error: { code: 'Unauthorized' } } }
  return load.call(this, name, ...args)
}
const { NextRequest } = require('next/server')
const ID = '11111111-1111-1111-1111-111111111111'
const month = { id: 'month', key: '2020-10', starts_at: new Date('2020-10-01'), ends_at: new Date('2020-11-01') }
let snapshot = null, historyCalls = 0, bankCalls = 0
const db = global.prisma = {
  assessment: { findUnique: async () => { bankCalls++; return { id: ID, type: 'LESSON', title: 'Quiz', questions: [{ id: 'q', points: 1, options: [{ id: 'o', is_correct: true }] }], question_pools: [] } } },
  learningPolicy: { findUnique: async () => ({ cutover_at: new Date('2020-01-01'), mapping_approved_at: new Date('2020-01-01') }) },
  competitionMonth: { findFirst: async () => month, findUnique: async () => month, findMany: async () => [{ key: month.key }] },
  learningSnapshot: { findUnique: async () => snapshot },
  chapter: { findMany: async () => [] },
  user: { findMany: async ({ where }) => { assert.equal(where.status, undefined, 'snapshot hydration must never filter current status'); return [{ id: 'left', status: 'INACTIVE', display_name: 'Former member' }] } },
  accountStateInterval: { findMany: async () => { historyCalls++; throw new Error('Closed board must not be rebuilt') } },
}
const bankRoute = require('../../src/app/api/v1/assessments/[assessmentId]/route')
const legacyRoute = require('../../src/app/api/v1/leaderboard/chapters/route')
const { periodLeaderboard } = require('../../src/lib/period-leaderboard')
const reorderRoute = require('../../src/app/api/v1/courses/[courseId]/sessions/reorder/route')
const poolsRoute = require('../../src/app/api/v1/assessments/[assessmentId]/pools/route')
const { ContentDeleteError } = require('../../src/lib/content-deletion')
const courseRoute = require('../../src/app/api/v1/courses/[courseId]/route')

for (const deniedRole of ['CHAPTER_LEADER', 'LEAD', 'MEMBER', null]) test(`question bank denies ${deniedRole} before reading answers`, async () => {
  role = deniedRole; const before = bankCalls
  const response = await bankRoute.GET(new NextRequest('http://localhost/api'), { params: { assessmentId: ID } })
  assert.equal(response.status, deniedRole ? 403 : 401)
  assert.equal(bankCalls, before)
})
test('Admin can read question bank for authoring', async () => {
  role = 'ADMIN'
  const response = await bankRoute.GET(new NextRequest('http://localhost/api'), { params: { assessmentId: ID } })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).questions[0].options[0].isCorrect, true)
})
test('course deletion maps learner history to 409 with guidance and uses SERIALIZABLE', async () => {
  role = 'ADMIN'
  db.$transaction = async (_, options) => { assert.equal(options.isolationLevel, 'Serializable'); throw new ContentDeleteError('CourseHasLearnerHistory', 409, 'Hãy hủy xuất bản để giữ lịch sử.') }
  const response = await courseRoute.DELETE(new NextRequest('http://localhost/api', { method: 'DELETE' }), { params: { courseId: ID } })
  assert.equal(response.status, 409)
  assert.match((await response.json()).error.message, /hủy xuất bản/)
})
test('course deletion cleans assets only after the transaction commits, never on rollback', async () => {
  const assets = require('../../src/lib/deleted-content-assets'), cleanup = assets.cleanupDeletedContentAssets
  let committed = false, calls = 0
  assets.cleanupDeletedContentAssets = async () => { assert.equal(committed, true); calls++ }
  try {
    db.$transaction = async () => { committed = true; return { storageKeys: ['document'], coverPublicId: 'cover' } }
    const response = await courseRoute.DELETE(new NextRequest('http://localhost/api'), { params: { courseId: ID } })
    assert.equal(response.status, 200); assert.equal(calls, 1)
    committed = false
    db.$transaction = async () => { throw new ContentDeleteError('CourseHasLearnerHistory', 409, 'Giữ lịch sử.') }
    assert.equal((await courseRoute.DELETE(new NextRequest('http://localhost/api'), { params: { courseId: ID } })).status, 409)
    assert.equal(calls, 1)
  } finally { assets.cleanupDeletedContentAssets = cleanup }
})
test('course update and unpublish write audits through their transaction', async () => {
  const actions = []
  db.course = { findUnique: async () => ({ status: 'DRAFT' }), update: async ({ data }) => ({ id: ID, ...data, program: null }) }
  db.auditLog = { create: async ({ data }) => { actions.push(data.action); assert.equal(data.actor_user_id, 'admin') } }
  let transactionCalls = 0
  db.$transaction = async callback => { transactionCalls++; return callback(db) }
  const update = await courseRoute.PATCH(new NextRequest('http://localhost/api', { method: 'PATCH', body: JSON.stringify({ visibility: 'PUBLIC' }) }), { params: { courseId: ID } })
  assert.equal(update.status, 200)
  db.course.findUnique = async () => ({ status: 'PUBLISHED' })
  db.attempt = { count: async () => 0 }; db.lessonProgress = { findMany: async () => [] }
  db.userLearningAssignment = { findMany: async () => [] }
  const unpublishRoute = require('../../src/app/api/v1/courses/[courseId]/unpublish/route')
  const unpublish = await unpublishRoute.POST(new NextRequest('http://localhost/api', { method: 'POST' }), { params: { courseId: ID } })
  assert.equal(unpublish.status, 200)
  assert.equal(transactionCalls, 2)
  assert.deepEqual(actions, ['UPDATE_COURSE', 'UNPUBLISH_COURSE'])
})
test('reorder rejects malformed JSON and null without opening a transaction', async () => {
  db.$transaction = async () => { throw new Error('Unexpected transaction') }
  for (const body of ['{', 'null', '{"sessions":[null]}']) {
    const response = await reorderRoute.PATCH(new NextRequest('http://localhost/api', { method: 'PATCH', body }), { params: { courseId: ID } })
    assert.equal(response.status, 400)
  }
})
test('pools PUT rejects zero/21 pools and invalid JSON before DB writes', async () => {
  for (const body of ['{', 'null', JSON.stringify({ pools: [] }), JSON.stringify({ pools: Array.from({ length: 21 }, () => ({ name: 'Pool' })) })]) {
    const response = await poolsRoute.PUT(new NextRequest('http://localhost/api', { method: 'PUT', body }), { params: { assessmentId: ID } })
    assert.equal(response.status, 400)
  }
})
test('closed individual snapshot retains inactive and departed users', async () => {
  role = 'ADMIN'
  snapshot = { payload: { group: 'MEMBER', state: 'FINALIZED', items: [{ userId: 'left', stars: 9, chapterName: 'Old chapter', departmentName: 'Old department', positionName: 'Member' }] } }
  const before = JSON.stringify(snapshot)
  const response = await periodLeaderboard(new NextRequest('http://localhost/api/v1/leaderboard?group=MEMBER&periodType=MONTH&periodId=2020-10'))
  const data = await response.json()
  assert.equal(data.items.length, 1)
  assert.equal(data.items[0].userId, 'left')
  assert.equal(data.items[0].stars, 9)
  assert.equal(JSON.stringify(snapshot), before)
  assert.equal(historyCalls, 0)
})
test('legacy closed Chapter board uses immutable saved result and never reconstructs cohort', async () => {
  snapshot = { payload: { state: 'FINALIZED', items: [{ chapterId: 'old', chapterName: 'Old chapter', averageMemberCount: 25, score: 4, eligible: true, at70Rate: .8, rank: 1 }] } }
  const response = await legacyRoute.GET(new NextRequest('http://localhost/api/v1/leaderboard/chapters?month=2020-10'))
  const data = await response.json()
  assert.equal(data.state, 'FINALIZED')
  assert.equal(data.items[0].score, 4)
  assert.equal(data.items[0].memberCount, 25)
  assert.deepEqual(data.availableMonths, ['2020-10'])
  assert.equal(historyCalls, 0)
})
test('legacy closed Chapter board reports missing snapshot instead of rebuilding history', async () => {
  snapshot = null
  const response = await legacyRoute.GET(new NextRequest('http://localhost/api/v1/leaderboard/chapters?month=2020-10'))
  const data = await response.json()
  assert.equal(data.state, 'AWAITING_SNAPSHOT')
  assert.equal(data.reasonCode, 'SNAPSHOT_MISSING')
  assert.deepEqual(data.availableMonths, ['2020-10'])
  assert.equal(data.month, month.starts_at.toISOString())
  assert.equal(historyCalls, 0)
})

test('legacy closed Chapter board retains month choices when snapshot data is incomplete', async () => {
  snapshot = { payload: { items: [{ chapterId: 'old', score: 5 }] } }
  const response = await legacyRoute.GET(new NextRequest('http://localhost/api/v1/leaderboard/chapters?month=2020-10'))
  const data = await response.json()
  assert.equal(data.state, 'AWAITING_SNAPSHOT')
  assert.equal(data.reasonCode, 'SNAPSHOT_DATA_MISSING')
  assert.deepEqual(data.availableMonths, ['2020-10'])
  assert.deepEqual(data.items, [])
  assert.equal(historyCalls, 0)
})

test('legacy Chapter board retains available months even if current period is unavailable', async () => {
  const findFirst = db.competitionMonth.findFirst
  db.competitionMonth.findFirst = async () => null
  try {
    const response = await legacyRoute.GET(new NextRequest('http://localhost/api/v1/leaderboard/chapters'))
    const data = await response.json()
    assert.equal(data.state, 'PERIOD_UNAVAILABLE')
    assert.deepEqual(data.availableMonths, ['2020-10'])
  } finally { db.competitionMonth.findFirst = findFirst }
})

test('cached live Chapter board still returns fresh available months', async () => {
  const findFirst = db.competitionMonth.findFirst
  const { setCachedChapterLeaderboard, invalidateChapterLeaderboardCache } = require('../../src/lib/chapter-leaderboard-cache')
  db.competitionMonth.findFirst = async () => ({ ...month, ends_at: new Date('2999-01-01') })
  setCachedChapterLeaderboard({ items: [], state: 'OPEN', availableMonths: [] }, 'legacy-chapter:2020-10')
  try {
    const response = await legacyRoute.GET(new NextRequest('http://localhost/api/v1/leaderboard/chapters'))
    const data = await response.json()
    assert.equal(data.state, 'OPEN')
    assert.deepEqual(data.availableMonths, ['2020-10'])
  } finally { db.competitionMonth.findFirst = findFirst; invalidateChapterLeaderboardCache() }
})

for (const deniedRole of ['CHAPTER_LEADER', 'LEAD', 'MEMBER', null]) test(`pools GET denies ${deniedRole} before reading the DB`, async () => {
  role = deniedRole
  db.questionPool = { findMany: async () => { throw new Error('Must not read pools') } }
  const response = await poolsRoute.GET(new NextRequest('http://localhost/api'), { params: { assessmentId: ID } })
  assert.equal(response.status, deniedRole ? 403 : 401)
})

test('Admin pools GET returns ordered groups with question counts in the existing contract', async () => {
  role = 'ADMIN'
  db.questionPool = { findMany: async ({ where, include, orderBy }) => {
    assert.equal(where.assessment_id, ID)
    assert.deepEqual(orderBy, { sort_order: 'asc' })
    assert.equal(include._count.select.questions, true)
    return [{ id: 'pool-1', name: 'Nhóm 1', sort_order: 0, _count: { questions: 3 } }, { id: 'pool-2', name: 'Nhóm 2', sort_order: 1, _count: { questions: 0 } }]
  } }
  const response = await poolsRoute.GET(new NextRequest('http://localhost/api'), { params: { assessmentId: ID } })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { items: [{ poolId: 'pool-1', name: 'Nhóm 1', sortOrder: 0, questionCount: 3 }, { poolId: 'pool-2', name: 'Nhóm 2', sortOrder: 1, questionCount: 0 }] })
})

test('Admin pools GET returns an empty list if no groups exist', async () => {
  role = 'ADMIN'
  db.questionPool = { findMany: async () => [] }
  const response = await poolsRoute.GET(new NextRequest('http://localhost/api'), { params: { assessmentId: ID } })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { items: [] })
})
