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
const memberCount = 22 // Current Chapter v8 eligibility is strictly greater than 20.
const halfMemberCount = memberCount / 2
let competitionMonthId = null
let createdCompetitionMonth = false
let createdCoreProgramId = null
let createdLeadPositionId = null
const cycleIdsByUser = new Map()

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
  if (userIds.length) {
    await prisma.starLedger.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.cycleLessonProgress.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.learningCycle.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.positionAssignment.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.chapterLeadBinding.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.organizationMembership.deleteMany({ where: { user_id: { in: userIds } } })
  }
  if (chapterId) {
    await prisma.learningSnapshot.deleteMany({ where: { kind: 'CHAPTER_KPI_HISTORY', payload: { path: ['chapterId'], equals: chapterId } } })
    await prisma.chapter.deleteMany({ where: { id: chapterId } })
  }
  if (courseId) {
    await prisma.course.deleteMany({ where: { id: courseId } })
    await prisma.coursePublicationEvent.deleteMany({ where: { course_id: courseId } })
    await prisma.courseRequirementVersion.deleteMany({ where: { course_id: courseId } })
  }
  if (departmentUnitId) await prisma.organizationUnit.deleteMany({ where: { id: departmentUnitId } })
  if (chapterUnitId) await prisma.organizationUnit.deleteMany({ where: { id: chapterUnitId } })
  if (rootUnitId) await prisma.organizationUnit.deleteMany({ where: { id: rootUnitId } })
  const ownedUserIds = [...userIds, ...(adminId ? [adminId] : [])]
  if (ownedUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: ownedUserIds } } })
    await prisma.accountStateInterval.deleteMany({ where: { user_id: { in: ownedUserIds } } })
    await prisma.chapterAffiliationInterval.deleteMany({ where: { user_id: { in: ownedUserIds } } })
  }
  if (createdCoreProgramId) await prisma.learningProgram.deleteMany({ where: { id: createdCoreProgramId } })
  if (createdLeadPositionId) await prisma.position.deleteMany({ where: { id: createdLeadPositionId } })
  if (createdCompetitionMonth) await prisma.competitionMonth.deleteMany({ where: { id: competitionMonthId } })
}

try {
  const [databaseInfo] = await prisma.$queryRaw`SELECT current_database() AS name, inet_server_addr()::text AS address`
  assert.equal(databaseInfo.name, 'bbe_test_leaderboard', 'Prisma must be connected to the dedicated test database')
  const databaseAddress = databaseInfo.address ? databaseInfo.address.split('/')[0] : null
  assert.ok(['127.0.0.1', '::1', null].includes(databaseAddress), 'PostgreSQL must be bound to loopback')

  const appResponse = await fetch(`${appUrl.origin}/`, { cache: 'no-store' })
  assert.ok(appResponse.ok, `local test app must be running at ${appUrl.origin}`)

  let competitionMonth = await prisma.competitionMonth.findUnique({ where: { key: month } })
  if (!competitionMonth) {
    competitionMonth = await prisma.competitionMonth.create({ data: {
      key: month, starts_at: monthStart, ends_at: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    } })
    createdCompetitionMonth = true
  }
  competitionMonthId = competitionMonth.id
  let coreProgram = await prisma.learningProgram.findUnique({ where: { code: 'CORE_MEMBER' } })
  if (!coreProgram) {
    coreProgram = await prisma.learningProgram.create({ data: { code: 'CORE_MEMBER', name: 'Member core fixture', is_core: true, sort_order: 0 } })
    createdCoreProgramId = coreProgram.id
  }

  const admin = await prisma.user.create({
    data: { email: `${emailPrefix}-admin@example.invalid`, password_hash: 'integration-only', role: 'ADMIN' },
    select: { id: true },
  })
  adminId = admin.id
  const members = Array.from({ length: memberCount }, () => ({ id: randomUUID() }))
  userIds.push(...members.map(({ id }) => id))
  await prisma.user.createMany({ data: members.map(({ id }, index) => ({
    id, email: `${emailPrefix}-${index}@example.invalid`, password_hash: 'integration-only', role: 'MEMBER',
  })) })

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

  let leadPosition = await prisma.position.findUnique({ where: { code: 'CHAPTER_LEAD' } })
  if (!leadPosition) {
    leadPosition = await prisma.position.create({ data: { code: 'CHAPTER_LEAD', name: 'Chapter Lead fixture', scope: 'CHAPTER', is_manager: true } })
    createdLeadPositionId = leadPosition.id
  }
  await prisma.positionAssignment.create({ data: { user_id: lead.id, unit_id: chapterUnit.id, position_id: leadPosition.id, appointed_by: admin.id } })

  // Eleven legacy members, eleven organization-tree members, and one overlap.
  // Historical ranking reads affiliation evidence, not the live organization union.
  await prisma.chapterMember.createMany({ data: members.slice(0, halfMemberCount).map(({ id }) => ({ chapter_id: chapter.id, user_id: id })) })
  await prisma.organizationMembership.createMany({
    data: members.slice(0, 1).concat(members.slice(halfMemberCount)).map(({ id }, index) => ({
      user_id: id,
      unit_id: index % 2 === 0 ? chapterUnit.id : department.id,
      status: 'ACTIVE',
    })),
  })

  // Imported organization-tree members need their own historical Chapter evidence.
  await prisma.chapterAffiliationInterval.createMany({ data: members.slice(halfMemberCount).map(({ id }) => ({
    user_id: id, chapter_id: chapter.id, starts_at: now,
  })) })
  await prisma.learningCycle.createMany({ data: members.map(({ id }) => ({
    id: randomUUID(), user_id: id, chapter_id: chapter.id,
    trigger_key: `${emailPrefix}:cycle:${id}`, starts_at: now, provenance: 'NATIVE',
  })) })
  for (const cycle of await prisma.learningCycle.findMany({ where: { user_id: { in: members.map(member => member.id) } } })) {
    cycleIdsByUser.set(cycle.user_id, cycle.id)
  }

  const course = await prisma.course.create({
    data: {
      title: `${emailPrefix}-mandatory-course`,
      program_id: coreProgram.id,
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
  // Chapter v8 uses completed core lessons in the active cycle. Legacy video/quiz
  // milestones above are deliberately complete for everyone, so they cannot mask
  // missing current-cycle core completion: half have 100%, half have only 50%.
  await prisma.cycleLessonProgress.createMany({ data: members.flatMap(({ id }, index) =>
    (index < halfMemberCount ? lessons : lessons.slice(0, 1)).map(lesson => ({
      user_id: id, lesson_id: lesson.id, learning_cycle_id: cycleIdsByUser.get(id), completed_at: now,
    })),
  ) })
  await prisma.attempt.createMany({
    data: members.flatMap(({ id }, index) => {
      const passedLessonAssessments = index < halfMemberCount ? lessonAssessments : lessonAssessments.slice(0, 1)
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
      competition_month_id: competitionMonthId,
      learning_cycle_id: cycleIdsByUser.get(id),
      chapter_at_award_id: chapter.id,
      provenance: 'NATIVE',
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
  assert.equal(yellow.formulaVersion, 'chapter-v8-a-over-n')
  const yellowItem = yellow.items.find(item => item.chapterId === chapter.id)
  assert.ok(yellowItem, JSON.stringify(yellow.excluded.find(item => item.chapterId === chapter.id)))
  assert.equal(yellow.items.filter(item => item.chapterId === chapter.id).length, 1, 'the Chapter must not be duplicated')
  assert.equal(yellowItem.memberCount, memberCount, 'overlapping legacy and organization histories must count once')
  assert.equal(yellowItem.completion.averagePercent, 50, 'the compatibility field reports the current qualified-member rate')
  assert.equal(yellowItem.completion.atLeast70Percent, 50)
  assert.equal(yellowItem.kpi.status, 'YELLOW')
  assert.equal(yellowItem.totalStars, memberCount)
  assert.equal(yellowItem.score, 1, 'Chapter v8 scores native allocated stars / valid members')

  assert.equal((await putKpi(chapter.id, { month, status: 'GREEN' }, adminToken)).status, 200)
  const green = await getChapterLeaderboard()
  const greenItem = green.items.find(item => item.chapterId === chapter.id)
  assert.equal(greenItem?.kpi.status, 'GREEN', 'KPI changes should invalidate the leaderboard cache immediately')
  assert.equal(greenItem.score, 1, 'GREEN is an eligibility condition; Chapter v8 has no legacy 20-point bonus')

  // Falling below 50% qualified members excludes the Chapter even though every
  // legacy LessonProgress row remains completed and lesson quiz attempts passed.
  await prisma.cycleLessonProgress.deleteMany({ where: { user_id: members[0].id, lesson_id: lessons[1].id } })
  await putKpi(chapter.id, { month, status: 'GREEN' }, adminToken)
  const insufficientProgress = await getChapterLeaderboard()
  assert.ok(!insufficientProgress.items.some(item => item.chapterId === chapter.id))
  assert.ok(insufficientProgress.excluded.find(item => item.chapterId === chapter.id)?.reasons.includes('CORE_COMPLETION_BELOW_50_PERCENT'))
  await prisma.cycleLessonProgress.create({ data: {
    user_id: members[0].id, lesson_id: lessons[1].id, learning_cycle_id: cycleIdsByUser.get(members[0].id), completed_at: now,
  } })

  assert.equal((await putKpi(chapter.id, { month, status: 'RED' }, adminToken)).status, 200)
  const red = await getChapterLeaderboard()
  assert.ok(!red.items.some(item => item.chapterId === chapter.id), 'RED KPI Chapters must not enter the ranking')
  assert.ok(red.excluded.find(item => item.chapterId === chapter.id)?.reasons.includes('KPI_NOT_ELIGIBLE'))

  console.log('Chapter leaderboard integration passed: local DB isolation, historical membership dedupe (>20), current-cycle core completion and v8 A/N scoring, KPI authorization/validation/month, cache invalidation, and RED exclusion.')
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
