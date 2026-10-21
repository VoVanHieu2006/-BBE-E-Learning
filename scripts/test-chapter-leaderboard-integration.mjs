import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import nextEnv from '@next/env'
import { SignJWT } from 'jose'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required; this test never falls back to DATABASE_URL.')

const databaseUrl = new URL(testDatabaseUrl)
if (databaseUrl.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost', '::1'].includes(databaseUrl.hostname)) {
  throw new Error('TEST_DATABASE_URL must point to a local PostgreSQL test database (loopback only).')
}
if (databaseUrl.pathname !== '/bbe_test_leaderboard') {
  throw new Error('The test database name must be bbe_test_leaderboard.')
}

const appUrl = new URL(process.env.TEST_APP_URL || 'http://127.0.0.1:3111')
if (!['127.0.0.1', 'localhost', '::1'].includes(appUrl.hostname)) {
  throw new Error('TEST_APP_URL must point to the local test application (loopback only).')
}

// Load application signing keys, then force Prisma to use only the guarded local URL.
nextEnv.loadEnvConfig(process.cwd())
process.env.DATABASE_URL = testDatabaseUrl
process.env.DIRECT_URL = testDatabaseUrl

if (!process.env.JWT_ACCESS_SECRET) throw new Error('JWT_ACCESS_SECRET is required in the local .env for authenticated route tests.')

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()
const fixtureId = randomUUID().replaceAll('-', '')
const emailPrefix = `lb-it-${fixtureId}`
const now = new Date()
const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
let adminId = null
let chapterId = null
let courseId = null
let rootUnitId = null
let chapterUnitId = null
let departmentUnitId = null
const userIds = []

async function issueAccessToken(userId, role) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET))
}

async function putKpi(chapterIdValue, payload, token) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  return fetch(`${appUrl.origin}/api/v1/chapters/${chapterIdValue}/kpi`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  })
}

async function getChapterLeaderboard() {
  const response = await fetch(`${appUrl.origin}/api/v1/leaderboard/chapters`, { cache: 'no-store' })
  assert.equal(response.status, 200, 'public Chapter leaderboard endpoint should respond successfully')
  return response.json()
}

async function cleanupFixtures() {
  if (userIds.length) await prisma.starLedger.deleteMany({ where: { user_id: { in: userIds } } })
  if (chapterId) await prisma.chapter.deleteMany({ where: { id: chapterId } })
  if (courseId) await prisma.course.deleteMany({ where: { id: courseId } })
  if (departmentUnitId) await prisma.organizationUnit.deleteMany({ where: { id: departmentUnitId } })
  if (chapterUnitId) await prisma.organizationUnit.deleteMany({ where: { id: chapterUnitId } })
  if (rootUnitId) await prisma.organizationUnit.deleteMany({ where: { id: rootUnitId } })
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  if (adminId) await prisma.user.deleteMany({ where: { id: adminId } })
}

try {
  const [databaseInfo] = await prisma.$queryRaw`SELECT current_database() AS name, inet_server_addr()::text AS address`
  assert.equal(databaseInfo.name, 'bbe_test_leaderboard', 'Prisma must be connected to the dedicated test database')
  const databaseAddress = databaseInfo.address ? databaseInfo.address.split('/')[0] : null
  assert.ok(['127.0.0.1', '::1', null].includes(databaseAddress), 'PostgreSQL must be bound to loopback')

  const appResponse = await fetch(`${appUrl.origin}/`, { cache: 'no-store' })
  assert.ok(appResponse.ok, `local test app must be running at ${appUrl.origin}`)

  const admin = await prisma.user.create({
    data: { email: `${emailPrefix}-admin@example.invalid`, password_hash: 'integration-only', role: 'ADMIN' },
    select: { id: true },
  })
  adminId = admin.id
  const members = await Promise.all(Array.from({ length: 20 }, (_, index) => prisma.user.create({
    data: { email: `${emailPrefix}-${index}@example.invalid`, password_hash: 'integration-only', role: 'MEMBER' },
    select: { id: true },
  })))
  userIds.push(...members.map(({ id }) => id))

  const root = await prisma.organizationUnit.create({ data: { name: `${emailPrefix}-root`, type: 'ROOT' }, select: { id: true } })
  rootUnitId = root.id
  const chapterUnit = await prisma.organizationUnit.create({
    data: { name: `${emailPrefix}-chapter-unit`, type: 'CHAPTER', parent_id: root.id },
    select: { id: true },
  })
  chapterUnitId = chapterUnit.id
  const department = await prisma.organizationUnit.create({
    data: { name: `${emailPrefix}-department`, type: 'DEPARTMENT', parent_id: chapterUnit.id },
    select: { id: true },
  })
  departmentUnitId = department.id
  const chapter = await prisma.chapter.create({
    data: { name: `${emailPrefix}-chapter`, organization_unit_id: chapterUnit.id },
    select: { id: true },
  })
  chapterId = chapter.id
  const lead = await prisma.user.create({ data: { email: `${emailPrefix}-lead@example.invalid`, password_hash: 'integration-only', role: 'CHAPTER_LEADER' } })
  userIds.push(lead.id)
  await prisma.chapterMember.create({ data: { chapter_id: chapter.id, user_id: lead.id } })

  // Ten legacy members, ten organization-tree members, and one overlap ensure the union is deduplicated.
  await prisma.chapterMember.createMany({ data: members.slice(0, 10).map(({ id }) => ({ chapter_id: chapter.id, user_id: id })) })
  await prisma.organizationMembership.createMany({
    data: members.slice(0, 1).concat(members.slice(10)).map(({ id }, index) => ({
      user_id: id,
      unit_id: index % 2 === 0 ? chapterUnit.id : department.id,
      status: 'ACTIVE',
    })),
  })

  const course = await prisma.course.create({
    data: {
      title: `${emailPrefix}-mandatory-course`,
      status: 'PUBLISHED',
      visibility: 'PRIVATE',
      created_by: admin.id,
      sessions: {
        create: {
          title: 'Integration module',
          sort_order: 1,
          lessons: { create: [{ title: 'Lesson 1', sort_order: 1 }, { title: 'Lesson 2', sort_order: 2 }] },
        },
      },
    },
    include: { sessions: { include: { lessons: true } } },
  })
  courseId = course.id
  const lessons = course.sessions.flatMap((session) => session.lessons)
  const lessonAssessments = await Promise.all(lessons.map((lesson, index) => prisma.assessment.create({
    data: { lesson_id: lesson.id, title: `Lesson quiz ${index + 1}`, created_by: admin.id },
    select: { id: true },
  })))
  const finalAssessment = await prisma.assessment.create({
    data: { type: 'COURSE_FINAL', course_id: course.id, title: 'Final exam', created_by: admin.id },
    select: { id: true },
  })

  await prisma.userLearningAssignment.createMany({
    data: members.map(({ id }) => ({ user_id: id, course_id: course.id, mandatory: true, can_view: true, can_assess: true })),
  })
  await prisma.lessonProgress.createMany({
    data: members.flatMap(({ id }) => lessons.map((lesson) => ({ user_id: id, lesson_id: lesson.id, completed: true, completed_at: now }))),
  })
  await prisma.attempt.createMany({
    data: members.flatMap(({ id }, index) => {
      const passedLessonAssessments = index < 10 ? lessonAssessments : lessonAssessments.slice(0, 1)
      return passedLessonAssessments.map(({ id: assessmentId }, attemptIndex) => ({
        user_id: id,
        assessment_id: assessmentId,
        attempt_number: attemptIndex + 1,
        status: 'SUBMITTED',
        started_at: now,
        expires_at: new Date(now.getTime() + 60 * 60 * 1000),
        submitted_at: now,
        score: 90,
        passed: true,
      }))
    }),
  })
  await prisma.starLedger.createMany({
    data: members.map(({ id }, index) => ({
      user_id: id,
      amount: 1,
      reason: 'VIDEO_COMPLETION',
      reward_key: `${emailPrefix}:star:${index}`,
      source_type: 'INTEGRATION_TEST',
      source_id: lessons[0].id,
    })),
  })

  const adminToken = await issueAccessToken(admin.id, 'ADMIN')
  const memberToken = await issueAccessToken(members[0].id, 'MEMBER')
  assert.equal((await putKpi(chapter.id, { month, status: 'GREEN' })).status, 401, 'KPI writes must require authentication')
  assert.equal((await putKpi(chapter.id, { month, status: 'GREEN' }, memberToken)).status, 403, 'only Admin may configure KPI')
  assert.equal((await putKpi(chapter.id, { status: 'GREEN' }, adminToken)).status, 400, 'missing KPI month must be rejected')
  assert.equal((await putKpi(chapter.id, { month: `${month}-15`, status: 'GREEN' }, adminToken)).status, 400, 'non-month date format must be rejected')
  assert.equal((await putKpi(chapter.id, { month, status: 'GREEN', note: 'x'.repeat(501) }, adminToken)).status, 400, 'oversized KPI note must be rejected')

  const savedKpi = await putKpi(chapter.id, { month, status: 'YELLOW', note: 'test fixture' }, adminToken)
  assert.equal(savedKpi.status, 200, 'Admin should be able to configure the selected KPI month')
  const yellow = await getChapterLeaderboard()
  assert.equal(yellow.items.length, 1)
  assert.equal(yellow.items[0].memberCount, 20, 'legacy plus organization membership overlap should count only once')
  assert.equal(yellow.items[0].completion.averagePercent, 70)
  assert.equal(yellow.items[0].completion.atLeast70Percent, 50)
  assert.equal(yellow.items[0].kpi.status, 'YELLOW')
  assert.equal(yellow.items[0].score, 29.1)

  await putKpi(chapter.id, { month, status: 'GREEN' }, adminToken)
  const green = await getChapterLeaderboard()
  assert.equal(green.items[0].kpi.status, 'GREEN', 'KPI changes should invalidate the leaderboard cache immediately')
  assert.equal(green.items[0].score, 49.1)

  await putKpi(chapter.id, { month, status: 'RED' }, adminToken)
  const red = await getChapterLeaderboard()
  assert.equal(red.items.length, 0, 'RED KPI Chapters must not enter the ranking')
  assert.ok(red.excluded.find((item) => item.chapterId === chapter.id)?.reasons.includes('KPI_RED'))

  console.log('Chapter leaderboard integration passed: local DB isolation, membership union/dedupe, mandatory video+quiz completion, KPI authorization/validation/month, cache invalidation, and RED exclusion.')
} catch (error) {
  console.error('Chapter leaderboard integration failed. Fixture data is local-only and will be cleaned up.')
  console.error(error instanceof Error ? error.stack : 'Unknown test error')
  process.exitCode = 1
} finally {
  try {
    await cleanupFixtures()
  } catch {
    console.error('Fixture cleanup failed. Delete only records with this test email prefix from bbe_test_leaderboard before rerunning.')
    process.exitCode = 1
  }
  await prisma.$disconnect()
}
