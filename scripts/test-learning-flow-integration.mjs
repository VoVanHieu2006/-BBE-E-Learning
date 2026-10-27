import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import nextEnv from '@next/env'
import { SignJWT } from 'jose'
import developmentTarget from './development-integration-target.cjs'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required; this test never falls back to DATABASE_URL.')

const databaseUrl = new URL(testDatabaseUrl)
const devTarget = developmentTarget.loadDevelopmentTarget(testDatabaseUrl,'learning_flow')
if (!devTarget && (databaseUrl.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost', '::1'].includes(databaseUrl.hostname))) {
  throw new Error('TEST_DATABASE_URL must point to a local PostgreSQL test database (loopback only).')
}
if (!devTarget && databaseUrl.pathname !== '/bbe_test_learning_flow') {
  throw new Error('The test database name must be bbe_test_learning_flow.')
}

const appUrl = new URL(process.env.TEST_APP_URL || 'http://127.0.0.1:3112')
if (!['127.0.0.1', 'localhost', '::1'].includes(appUrl.hostname)) {
  throw new Error('TEST_APP_URL must point to the local test application (loopback only).')
}

nextEnv.loadEnvConfig(process.cwd())
process.env.DATABASE_URL = testDatabaseUrl
process.env.DIRECT_URL = testDatabaseUrl
if (!process.env.JWT_ACCESS_SECRET) throw new Error('JWT_ACCESS_SECRET is required for authenticated route tests.')

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()
const fixtureId = randomUUID().replaceAll('-', '')
const prefix = `learning-it-${fixtureId}`
const users = []
const chapters = []
const units = []
const unitRootIds = []
const courseIds = []
const positionIds = []
const permissionIds = []

async function issueAccessToken(userId, role) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET))
}

async function createUser(role, suffix) {
  const user = await prisma.user.create({
    data: { email: `${prefix}-${suffix}@example.invalid`, password_hash: 'integration-only', role },
    select: { id: true },
  })
  users.push(user.id)
  return user.id
}

async function callApi(path, { method = 'GET', token, body } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  return fetch(new URL(path, appUrl), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
  })
}

async function readJson(response) {
  const body = await response.json().catch(() => null)
  assert.ok(body && typeof body === 'object', `API returned non-JSON response (${response.status})`)
  return body
}

async function markVideoAsPreviouslyWatched(lessonId, userId) {
  const video = await prisma.video.findUniqueOrThrow({ where: { lesson_id: lessonId } })
  const watched = video.duration_seconds - 2
  const lastWatchedAt = new Date(Date.now() - 2_000)
  await prisma.lessonProgress.upsert({
    where: { user_id_lesson_id: { user_id: userId, lesson_id: lessonId } },
    create: {
      user_id: userId,
      lesson_id: lessonId,
      last_position_seconds: watched,
      furthest_watched_position_seconds: watched,
      last_watched_at: lastWatchedAt,
    },
    update: {
      last_position_seconds: watched,
      furthest_watched_position_seconds: watched,
      last_watched_at: lastWatchedAt,
      completed: false,
      completed_at: null,
    },
  })
}

async function finishVideoViaApi(lesson, userId, token) {
  await markVideoAsPreviouslyWatched(lesson.id, userId)
  const ninetyNinePercent = await callApi(`/api/v1/lessons/${lesson.id}/progress`, {
    method: 'PATCH', token,
    body: { positionSeconds: lesson.video.duration_seconds - 1, furthestWatchedPositionSeconds: lesson.video.duration_seconds - 1 },
  })
  assert.equal(ninetyNinePercent.status, 200)
  const partial = await readJson(ninetyNinePercent)
  assert.ok(Math.abs(partial.progressPercentage - 100 * (lesson.video.duration_seconds - 1) / lesson.video.duration_seconds) < 1e-6, 'partial progress retains its fractional value below 100%')
  assert.equal(partial.completed, false, '99% video progress is not complete')
  assert.equal(await prisma.starLedger.count({ where: { user_id: userId, source_type: 'VIDEO', source_id: lesson.video.id } }), 0, 'partial video progress earns no Stars')
  await prisma.lessonProgress.update({
    where: { user_id_lesson_id: { user_id: userId, lesson_id: lesson.id } },
    data: { last_watched_at: new Date(Date.now() - 2_000) },
  })
  const response = await callApi(`/api/v1/lessons/${lesson.id}/progress`, {
    method: 'PATCH', token,
    body: { positionSeconds: lesson.video.duration_seconds, furthestWatchedPositionSeconds: lesson.video.duration_seconds },
  })
  assert.equal(response.status, 200, 'full-duration heartbeat should be accepted after sufficient elapsed time')
  const result = await readJson(response)
  assert.equal(result.completed, false, 'a lesson with a quiz is not complete until its quiz is passed')
  assert.equal(result.starReward.awarded, true, 'exactly 100% video progress awards the one-time video Star')
  assert.equal(result.starReward.amount, 3, 'the 180-second fixture receives the duration-based video reward')
  return result
}

async function startAttempt(assessmentId, token) {
  const response = await callApi(`/api/v1/assessments/${assessmentId}/attempts`, { method: 'POST', token, body: {} })
  return { response, data: await readJson(response) }
}

async function submitWithCorrectAnswers(attempt, token) {
  const questionIds = attempt.questions.map((question) => question.questionId)
  const correctOptions = await prisma.questionOption.findMany({
    where: { question_id: { in: questionIds }, is_correct: true },
    select: { question_id: true, id: true },
  })
  const byQuestion = new Map(correctOptions.map(({ question_id, id }) => [question_id, id]))
  const answers = Object.fromEntries(attempt.questions.map((question) => {
    const optionId = byQuestion.get(question.questionId)
    assert.ok(optionId, `question ${question.questionId} needs a correct option`)
    return [question.questionId, optionId]
  }))
  return callApi(`/api/v1/attempts/${attempt.attemptId}/submit`, { method: 'POST', token, body: { answers } })
}

async function cleanupFixtures() {
  if (chapters.length) await prisma.chapter.deleteMany({ where: { id: { in: chapters } } })
  if (courseIds.length) await prisma.course.deleteMany({ where: { id: { in: courseIds } } })
  if (users.length) {
    await prisma.starLedger.deleteMany({ where: { user_id: { in: users } } })
    await prisma.positionAssignment.deleteMany({ where: { user_id: { in: users } } })
    await prisma.organizationMembership.deleteMany({ where: { user_id: { in: users } } })
    await prisma.chapterMember.deleteMany({ where: { user_id: { in: users } } })
  }
  if (positionIds.length) await prisma.positionPermission.deleteMany({ where: { position_id: { in: positionIds } } })
  if (positionIds.length) await prisma.position.deleteMany({ where: { id: { in: positionIds } } })
  if (permissionIds.length) await prisma.permission.deleteMany({ where: { id: { in: permissionIds } } })
  const nonRootUnits = units.filter((unitId) => !unitRootIds.includes(unitId))
  if (nonRootUnits.length) await prisma.organizationUnit.deleteMany({ where: { id: { in: nonRootUnits } } })
  if (unitRootIds.length) await prisma.organizationUnit.deleteMany({ where: { id: { in: unitRootIds } } })
  if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } })
}

try {
  if(devTarget){
    await developmentTarget.assertPrismaIsolation(prisma,devTarget)
    developmentTarget.assertServerAttestation(devTarget,appUrl)
    console.log(`Development isolation verified: ${devTarget.projectRef}/${devTarget.database}, schema ${devTarget.schema}`)
  }
  const [databaseInfo] = await prisma.$queryRaw`SELECT current_database() AS name, inet_server_addr()::text AS address`
  if (!devTarget) assert.equal(databaseInfo.name, 'bbe_test_learning_flow', 'Prisma must be connected to the dedicated learning-flow test database')
  const databaseAddress = databaseInfo.address ? databaseInfo.address.split('/')[0] : null
  if (!devTarget) assert.ok(['127.0.0.1', '::1', null].includes(databaseAddress), 'PostgreSQL must be bound to loopback')

  const appResponse = await fetch(`${appUrl.origin}/`, { cache: 'no-store' })
  assert.ok(appResponse.ok, `local test app must be running at ${appUrl.origin}`)

  const adminId = await createUser('ADMIN', 'admin')
  const learnerId = await createUser('MEMBER', 'learner')
  const viewerId = await createUser('MEMBER', 'viewer')
  const chapterLeaderId = await createUser('CHAPTER_LEADER', 'chapter-leader')
  const chapterOutsiderId = await createUser('CHAPTER_LEADER', 'chapter-outsider')
  const dnaManagerId = await createUser('MEMBER', 'dna-manager')
  const dnaLearnerId = await createUser('MEMBER', 'dna-learner')
  const dnaOutsiderId = await createUser('MEMBER', 'dna-outsider')
  const deadlineUserId = await createUser('MEMBER', 'deadline-user')
  const adminToken = await issueAccessToken(adminId, 'ADMIN')
  const learnerToken = await issueAccessToken(learnerId, 'MEMBER')
  const viewerToken = await issueAccessToken(viewerId, 'MEMBER')
  const chapterLeaderToken = await issueAccessToken(chapterLeaderId, 'CHAPTER_LEADER')
  const dnaManagerToken = await issueAccessToken(dnaManagerId, 'MEMBER')

  const chapterRoot = await prisma.organizationUnit.create({ data: { name: `${prefix}-chapter-root`, type: 'ROOT' }, select: { id: true } })
  unitRootIds.push(chapterRoot.id)
  const [chapterUnitA, chapterUnitB] = await Promise.all([
    prisma.organizationUnit.create({ data: { name: `${prefix}-chapter-unit-a`, type: 'CHAPTER', parent_id: chapterRoot.id }, select: { id: true } }),
    prisma.organizationUnit.create({ data: { name: `${prefix}-chapter-unit-b`, type: 'CHAPTER', parent_id: chapterRoot.id }, select: { id: true } }),
  ])
  units.push(chapterRoot.id, chapterUnitA.id, chapterUnitB.id)
  const [chapterA, chapterB] = await Promise.all([
    prisma.chapter.create({ data: { name: `${prefix}-chapter-a`, organization_unit_id: chapterUnitA.id }, select: { id: true } }),
    prisma.chapter.create({ data: { name: `${prefix}-chapter-b`, organization_unit_id: chapterUnitB.id }, select: { id: true } }),
  ])
  chapters.push(chapterA.id, chapterB.id)
  await prisma.chapterMember.createMany({ data: [
    { chapter_id: chapterA.id, user_id: chapterLeaderId },
    { chapter_id: chapterA.id, user_id: learnerId },
    { chapter_id: chapterA.id, user_id: viewerId },
    { chapter_id: chapterB.id, user_id: chapterOutsiderId },
  ] })

  const [dnaA, dnaB] = await Promise.all([
    prisma.organizationUnit.create({ data: { name: `${prefix}-dna-a`, type: 'DNA' }, select: { id: true } }),
    prisma.organizationUnit.create({ data: { name: `${prefix}-dna-b`, type: 'DNA' }, select: { id: true } }),
  ])
  units.push(dnaA.id, dnaB.id)
  await prisma.organizationMembership.createMany({ data: [
    { user_id: dnaManagerId, unit_id: dnaA.id, status: 'ACTIVE' },
    // Current integrity rules prohibit simultaneous Chapter/DNA affiliation.
    { user_id: dnaLearnerId, unit_id: dnaA.id, status: 'ACTIVE' },
    { user_id: dnaOutsiderId, unit_id: dnaB.id, status: 'ACTIVE' },
  ] })
  const existingProgressPermission = await prisma.permission.findUnique({ where: { code: 'VIEW_MEMBER_PROGRESS' }, select: { id: true } })
  const permission = existingProgressPermission || await prisma.permission.create({
    data: { code: 'VIEW_MEMBER_PROGRESS', description: 'Integration-only progress visibility permission' },
    select: { id: true },
  })
  if (!existingProgressPermission) permissionIds.push(permission.id)
  const position = await prisma.position.create({ data: { code: `${prefix}-DNA-MANAGER`, name: `${prefix} DNA Manager`, scope: 'DNA', is_manager: true }, select: { id: true } })
  positionIds.push(position.id)
  await prisma.positionPermission.create({ data: { position_id: position.id, permission_id: permission.id } })
  await prisma.positionAssignment.create({ data: { user_id: dnaManagerId, position_id: position.id, unit_id: dnaA.id, is_primary: true } })

  const course = await prisma.course.create({
    data: {
      title: `${prefix}-strict-progression`,
      status: 'PUBLISHED',
      visibility: 'PRIVATE',
      created_by: adminId,
      sessions: { create: { title: `${prefix}-module`, sort_order: 1, lessons: { create: [
        { title: `${prefix}-lesson-1`, sort_order: 1, video: { create: { youtube_video_id: `${prefix}-video-1`, duration_seconds: 180 } } },
        { title: `${prefix}-lesson-2`, sort_order: 2, video: { create: { youtube_video_id: `${prefix}-video-2`, duration_seconds: 180 } } },
      ] } } },
    },
    include: { sessions: { include: { lessons: { include: { video: true } } } } },
  })
  courseIds.push(course.id)
  const lessons = course.sessions.flatMap((session) => session.lessons).sort((a, b) => a.sort_order - b.sort_order)
  await prisma.userLearningAssignment.createMany({ data: [
    { user_id: learnerId, course_id: course.id, mandatory: true, can_view: true, can_assess: true, can_earn_stars: true },
    { user_id: viewerId, course_id: course.id, mandatory: true, can_view: true, can_assess: false, can_earn_stars: false },
  ] })

  const lessonQuizBodies = lessons.map((lesson, index) => callApi(`/api/v1/lessons/${lesson.id}/assessment`, {
    method: 'POST', token: adminToken,
    body: { title: `${prefix}-lesson-quiz-${index + 1}`, durationMinutes: 10, questions: [{
      questionText: `Question ${index + 1}`,
      points: 10,
      options: [{ optionText: 'Correct', isCorrect: true }, { optionText: 'Incorrect', isCorrect: false }],
    }] },
  }))
  const lessonQuizResponses = await Promise.all(lessonQuizBodies)
  assert.ok(lessonQuizResponses.every((response) => response.status === 201), 'Admin can author both lesson quizzes through the API')
  const lessonQuizzes = await Promise.all(lessonQuizResponses.map(readJson))
  const lessonAssessmentIds = lessonQuizzes.map((quiz) => quiz.assessmentId)
  const lessonQuestionIds = lessonQuizzes.map((quiz) => quiz.questions[0].questionId)

  const finalQuestions = Array.from({ length: 15 }, (_, index) => ({
    questionText: `${prefix} final question ${index + 1}`,
    poolIndex: index % 5,
    points: 10,
    options: [{ optionText: 'Correct', isCorrect: true }, { optionText: 'Incorrect', isCorrect: false }],
  }))
  const memberFinalAuthoring = await callApi(`/api/v1/courses/${course.id}/final-assessment`, {
    method: 'POST', token: learnerToken, body: { title: 'Unauthorized final', pools: ['A', 'B', 'C', 'D', 'E'], questions: finalQuestions },
  })
  assert.equal(memberFinalAuthoring.status, 403, 'non-Admin must not author the course-final assessment')
  const finalAuthoring = await callApi(`/api/v1/courses/${course.id}/final-assessment`, {
    method: 'POST', token: adminToken,
    body: { title: `${prefix}-final-exam`, description: 'Integration final', questionCount: 2 },
  })
  assert.equal(finalAuthoring.status, 200, 'Admin can capture a final-exam version from the lesson question bank')
  const finalAssessment = await readJson(finalAuthoring)

  const draftCoverCourse = await prisma.course.create({
    data: { title: `${prefix}-cover-validation`, status: 'DRAFT', visibility: 'PRIVATE', created_by: adminId },
    select: { id: true },
  })
  courseIds.push(draftCoverCourse.id)
  const invalidCoverForm = new FormData()
  invalidCoverForm.set('file', new File(['not an image'], 'invalid-cover.txt', { type: 'text/plain' }))
  const rejectedCoverUpload = await fetch(new URL(`/api/v1/courses/${draftCoverCourse.id}/cover`, appUrl), {
    method: 'POST', headers: { authorization: `Bearer ${adminToken}` }, body: invalidCoverForm,
  })
  assert.equal(rejectedCoverUpload.status, 400, 'configured Cloudinary route rejects invalid media before any outbound upload')
  assert.equal((await readJson(rejectedCoverUpload)).error.code, 'InvalidImage')

  const firstLessonEarlyQuiz = await startAttempt(lessonAssessmentIds[0], learnerToken)
  assert.equal(firstLessonEarlyQuiz.response.status, 403, 'quiz remains locked until every video in the module is complete')
  assert.equal(firstLessonEarlyQuiz.data.error.code, 'LessonVideoIncomplete')

  const immediateSeek = await callApi(`/api/v1/lessons/${lessons[0].id}/progress`, {
    method: 'PATCH', token: learnerToken,
    body: { positionSeconds: 180, furthestWatchedPositionSeconds: 180 },
  })
  assert.equal(immediateSeek.status, 200)
  const immediateSeekData = await readJson(immediateSeek)
  assert.equal(immediateSeekData.furthestWatchedPositionSeconds, 0, 'instant seek-to-end is capped by elapsed server time')
  assert.equal(immediateSeekData.completed, false, 'a client seek does not complete the required video')

  const lockedSecondVideo = await callApi(`/api/v1/lessons/${lessons[1].id}/progress`, {
    method: 'PATCH', token: learnerToken,
    body: { positionSeconds: 180, furthestWatchedPositionSeconds: 180 },
  })
  assert.equal(lockedSecondVideo.status, 403, 'the next video remains locked until the preceding video is fully watched')
  assert.equal((await readJson(lockedSecondVideo)).error.code, 'PreviousLessonIncomplete')

  const firstVideoFinish = await finishVideoViaApi(lessons[0], learnerId, learnerToken)
  assert.equal(firstVideoFinish.progressPercentage, 100)
  const duplicateHeartbeat = await callApi(`/api/v1/lessons/${lessons[0].id}/progress`, {
    method: 'PATCH', token: learnerToken,
    body: { positionSeconds: 180, furthestWatchedPositionSeconds: 180 },
  })
  const duplicateHeartbeatData = await readJson(duplicateHeartbeat)
  assert.equal(duplicateHeartbeatData.starReward?.awarded, false, 'repeated completed heartbeat cannot re-award video Stars')
  assert.equal(await prisma.starLedger.count({ where: { user_id: learnerId, source_type: 'VIDEO', source_id: lessons[0].video.id } }), 1)

  const quizAfterVideos = await startAttempt(lessonAssessmentIds[0], learnerToken)
  assert.equal(quizAfterVideos.response.status, 201)
  assert.ok(quizAfterVideos.data.questions.every((question) => question.options.every((option) => !('isCorrect' in option))), 'attempt payload must not expose the answer key')

  const firstQuestion = quizAfterVideos.data.questions[0]
  const firstQuestionOptions = await prisma.questionOption.findMany({
    where: { question_id: firstQuestion.questionId }, select: { id: true, is_correct: true },
  })
  const correctOption = firstQuestionOptions.find((option) => option.is_correct)
  const incorrectOption = firstQuestionOptions.find((option) => !option.is_correct)
  assert.ok(correctOption && incorrectOption, 'lesson quiz needs one correct and one incorrect answer')
  const crossQuestionAnswer = await callApi(`/api/v1/attempts/${quizAfterVideos.data.attemptId}/answers`, {
    method: 'POST', token: learnerToken,
    body: { answers: { [lessonQuestionIds[1]]: (await prisma.questionOption.findFirst({ where: { question_id: lessonQuestionIds[1], is_correct: true }, select: { id: true } })).id } },
  })
  assert.equal(crossQuestionAnswer.status, 400, 'an answer from another quiz cannot be attached to this attempt')

  const savedWrongAnswer = await callApi(`/api/v1/attempts/${quizAfterVideos.data.attemptId}/answers`, {
    method: 'POST', token: learnerToken, body: { questionId: firstQuestion.questionId, selectedOptionId: incorrectOption.id },
  })
  assert.equal(savedWrongAnswer.status, 200)
  const resultBeforeSubmit = await callApi(`/api/v1/attempts/${quizAfterVideos.data.attemptId}`, { token: learnerToken })
  assert.equal(resultBeforeSubmit.status, 400, 'an in-progress attempt has no final result yet')
  const failedSubmit = await callApi(`/api/v1/attempts/${quizAfterVideos.data.attemptId}/submit`, { method: 'POST', token: learnerToken, body: {} })
  assert.equal(failedSubmit.status, 200)
  const failedResult = await readJson(failedSubmit)
  assert.equal(failedResult.passed, false, 'server grades the persisted wrong selection as failed')
  assert.equal(failedResult.starReward.amount, 0, 'failed attempts earn no Stars')
  const failedResultView = await callApi(`/api/v1/attempts/${quizAfterVideos.data.attemptId}`, { token: learnerToken })
  assert.equal(failedResultView.status, 200)
  const failedResultViewData = await readJson(failedResultView)
  assert.equal(failedResultViewData.passed, false)
  assert.equal('correctOptionId' in failedResultViewData.answers[0], false, 'failed results do not reveal the answer key')
  const otherUserResult = await callApi(`/api/v1/attempts/${quizAfterVideos.data.attemptId}`, { token: viewerToken })
  assert.equal(otherUserResult.status, 403, 'attempt results are private to their owner')
  const savedAfterSubmit = await callApi(`/api/v1/attempts/${quizAfterVideos.data.attemptId}/answers`, {
    method: 'POST', token: learnerToken, body: { questionId: firstQuestion.questionId, selectedOptionId: correctOption.id },
  })
  assert.equal(savedAfterSubmit.status, 400, 'submitted attempts are immutable')
  const repeatedSubmit = await callApi(`/api/v1/attempts/${quizAfterVideos.data.attemptId}/submit`, { method: 'POST', token: learnerToken, body: {} })
  assert.equal(repeatedSubmit.status, 200, 'a repeated submission returns the immutable result idempotently')
  assert.equal((await readJson(repeatedSubmit)).starReward.amount, 0)

  const cooldown = await startAttempt(lessonAssessmentIds[0], learnerToken)
  assert.equal(cooldown.response.status, 429, 'the configured cooldown prevents immediate retries')
  assert.equal(cooldown.data.error.code, 'CooldownActive')

  await prisma.attempt.update({ where: { id: quizAfterVideos.data.attemptId }, data: { submitted_at: new Date(Date.now() - 25 * 60 * 60 * 1000) } })
  const retry = await startAttempt(lessonAssessmentIds[0], learnerToken)
  assert.equal(retry.response.status, 201)
  assert.equal(retry.data.attemptNumber, 2, 'retry numbering counts submitted attempts')
  assert.deepEqual(retry.data.existingAnswers, {}, 'a new attempt starts with no answers from the previous attempt')
  const correctRetry = await submitWithCorrectAnswers(retry.data, learnerToken)
  assert.equal(correctRetry.status, 200)
  const passedRetry = await readJson(correctRetry)
  assert.equal(passedRetry.passed, true)
  assert.equal(passedRetry.starReward.amount, 1, 'one correct answer earns one Star')
  const passedResultView = await callApi(`/api/v1/attempts/${retry.data.attemptId}`, { token: learnerToken })
  assert.equal(passedResultView.status, 200)
  assert.equal((await readJson(passedResultView)).score, 100, 'the result endpoint returns the persisted weighted score')
  const ownAttemptHistory = await callApi(`/api/v1/assessments/${lessonAssessmentIds[0]}/attempts/me`, { token: learnerToken })
  assert.equal(ownAttemptHistory.status, 200)
  const ownAttemptHistoryData = await readJson(ownAttemptHistory)
  assert.equal(ownAttemptHistoryData.items.length, 2)
  assert.equal(ownAttemptHistoryData.items.find((item) => item.attemptId === retry.data.attemptId)?.passed, true)
  const retrySubmitAgain = await callApi(`/api/v1/attempts/${retry.data.attemptId}/submit`, { method: 'POST', token: learnerToken, body: {} })
  assert.equal(retrySubmitAgain.status, 200)
  assert.equal(await prisma.starLedger.aggregate({ where: { user_id: learnerId, source_type: 'ASSESSMENT', source_id: lessonAssessmentIds[0] }, _sum: { amount: true } }).then((row) => row._sum.amount), 1, 'duplicate submits cannot award the quiz twice')

  await finishVideoViaApi(lessons[1], learnerId, learnerToken)

  const blockedFinal = await callApi(`/api/v1/courses/${course.id}/final-assessment`, { token: learnerToken })
  assert.equal(blockedFinal.status, 200)
  const blockedFinalData = await readJson(blockedFinal)
  assert.equal(blockedFinalData.canStart, false, 'course final is locked until all lesson quizzes pass')
  assert.equal(blockedFinalData.gateCode, 'LessonAssessmentsIncomplete')
  assert.ok(blockedFinalData.assessment.questionCount === 2)
  assert.equal(JSON.stringify(blockedFinalData).includes('isCorrect'), false, 'learner final-assessment metadata never exposes answer keys')

  const lessonTwoAttempt = await startAttempt(lessonAssessmentIds[1], learnerToken)
  assert.equal(lessonTwoAttempt.response.status, 201)
  const lessonTwoSubmit = await submitWithCorrectAnswers(lessonTwoAttempt.data, learnerToken)
  assert.equal(lessonTwoSubmit.status, 200)
  assert.equal((await readJson(lessonTwoSubmit)).passed, true)

  const finalReady = await callApi(`/api/v1/courses/${course.id}/final-assessment`, { token: learnerToken })
  assert.equal(finalReady.status, 200)
  assert.equal((await readJson(finalReady)).canStart, true, 'final exam unlocks after required videos and lesson quizzes pass')
  const finalAttempt = await startAttempt(finalAssessment.assessmentId, learnerToken)
  assert.equal(finalAttempt.response.status, 201)
  assert.equal(finalAttempt.data.attemptNumber, 1)
  assert.equal(finalAttempt.data.questions.length, 2, 'final exam draws the configured question count from its immutable version')
  assert.ok(finalAttempt.data.questions.every((question) => question.options.every((option) => !('isCorrect' in option))))
  const finalSubmit = await submitWithCorrectAnswers(finalAttempt.data, learnerToken)
  assert.equal(finalSubmit.status, 200)
  const finalResult = await readJson(finalSubmit)
  assert.equal(finalResult.passed, true)
  assert.equal(finalResult.starReward.amount, 2, 'the two correct final answers earn two Stars')
  const finalRetry = await startAttempt(finalAssessment.assessmentId, learnerToken)
  assert.equal(finalRetry.response.status, 429, 'the final exam also enforces its retry cooldown')
  await prisma.attempt.update({ where: { id: finalAttempt.data.attemptId }, data: { submitted_at: new Date(Date.now() - 25 * 60 * 60 * 1000) } })
  const passedFinalRetry = await startAttempt(finalAssessment.assessmentId, learnerToken)
  assert.equal(passedFinalRetry.response.status, 409, 'before cutover a passed final remains closed after cooldown')
  assert.equal(passedFinalRetry.data.error.code, 'FinalExamAlreadyPassed')
  assert.equal(await prisma.starLedger.aggregate({ where: { user_id: learnerId, source_type: 'ASSESSMENT', source_id: finalAssessment.assessmentId }, _sum: { amount: true } }).then((row) => row._sum.amount), 2)
  const assignment = await prisma.userLearningAssignment.findFirst({ where: { user_id: learnerId, course_id: course.id, ended_at: null } })
  assert.equal(assignment.status, 'COMPLETED', 'passing the final exam materializes course assignment completion')

  const deadlineCourse = await prisma.course.create({
    data: { title: `${prefix}-deadline-course`, status: 'PUBLISHED', visibility: 'PRIVATE', created_by: adminId },
    select: { id: true },
  })
  courseIds.push(deadlineCourse.id)
  const deadlineAssignment = await prisma.userLearningAssignment.create({
    data: {
      user_id: deadlineUserId,
      course_id: deadlineCourse.id,
      mandatory: true,
      due_at: new Date(Date.now() - 60_000),
      status: 'ASSIGNED',
    },
    select: { id: true },
  })

  const viewerAttempt = await startAttempt(lessonAssessmentIds[0], viewerToken)
  assert.equal(viewerAttempt.response.status, 403, 'every learner must complete the videos before starting a quiz')
  assert.equal(viewerAttempt.data.error.code, 'LessonVideoIncomplete')
  await prisma.lessonProgress.upsert({
    where: { user_id_lesson_id: { user_id: viewerId, lesson_id: lessons[0].id } },
    create: { user_id: viewerId, lesson_id: lessons[0].id, last_position_seconds: 0, furthest_watched_position_seconds: 0, last_watched_at: new Date(Date.now() - 120_000) },
    update: { last_position_seconds: 0, furthest_watched_position_seconds: 0, last_watched_at: new Date(Date.now() - 120_000) },
  })
  const viewerVideo = await callApi(`/api/v1/lessons/${lessons[0].id}/progress`, {
    method: 'PATCH', token: viewerToken,
    body: { positionSeconds: 180, furthestWatchedPositionSeconds: 180 },
  })
  assert.equal(viewerVideo.status, 200, 'viewer-only assignment allows video consumption')
  assert.equal((await readJson(viewerVideo)).completed, false, 'video completion still requires its quiz')
  assert.equal(await prisma.starLedger.count({ where: { user_id: viewerId } }), 0, 'a disconnected heartbeat earns no Stars')
  await finishVideoViaApi(lessons[0], viewerId, viewerToken)
  const voluntaryQuiz = await startAttempt(lessonAssessmentIds[0], viewerToken)
  assert.equal(voluntaryQuiz.response.status, 201, 'published courses allow assessment even when a legacy assignment flag is view-only')
  const voluntaryResult = await readJson(await submitWithCorrectAnswers(voluntaryQuiz.data, viewerToken))
  assert.equal(voluntaryResult.starReward.amount, 1, 'the matrix does not remove reward eligibility on published courses')

  const chapterOwnScope = await callApi(`/api/v1/chapters/${chapterA.id}/members/${learnerId}/course-progress`, { token: chapterLeaderToken })
  assert.equal(chapterOwnScope.status, 200, 'Chapter manager can inspect a member inside the managed Chapter')
  const chapterCrossScope = await callApi(`/api/v1/chapters/${chapterB.id}/members/${chapterOutsiderId}/course-progress`, { token: chapterLeaderToken })
  assert.equal(chapterCrossScope.status, 403, 'Chapter manager cannot inspect a different Chapter')
  const dnaOwnScope = await callApi(`/api/v1/organization/units/${dnaA.id}/members/${dnaLearnerId}/progress`, { token: dnaManagerToken })
  assert.equal(dnaOwnScope.status, 200, 'an active DNA position permission grants progress visibility within its unit')
  const dnaCrossScope = await callApi(`/api/v1/organization/units/${dnaB.id}/members/${dnaOutsiderId}/progress`, { token: dnaManagerToken })
  assert.equal(dnaCrossScope.status, 403, 'DNA manager cannot inspect a peer DNA unit')

  const adminCannotLockSelf = await callApi('/api/v1/admin/restrictions', {
    method: 'POST', token: adminToken, body: { action: 'LOCK', targetType: 'USER', targetId: adminId, reason: 'must be protected' },
  })
  assert.equal(adminCannotLockSelf.status, 403, 'the lock API protects Admin accounts')
  const chapterLeaderLock = await callApi('/api/v1/admin/restrictions', {
    method: 'POST', token: adminToken,
    body: { action: 'LOCK', targetType: 'USER', targetId: chapterLeaderId, reason: 'Integration: Chapter manager disabled' },
  })
  assert.equal(chapterLeaderLock.status, 201, 'Admin can lock a Chapter manager with an audit reason')
  const chapterLeaderLockData = await readJson(chapterLeaderLock)
  assert.equal(chapterLeaderLockData.lockedUsers, 3, 'disabling a Chapter manager cascades to all accounts in that Chapter')
  assert.deepEqual(chapterLeaderLockData.cascadedChapterIds, [chapterA.id])
  assert.equal((await prisma.user.findUnique({ where: { id: learnerId }, select: { status: true } })).status, 'LOCKED')
  assert.equal((await prisma.user.findUnique({ where: { id: chapterLeaderId }, select: { status: true } })).status, 'LOCKED')
  const lockedLearnerRequest = await callApi(`/api/v1/lessons/${lessons[0].id}/progress`, { token: learnerToken })
  assert.equal(lockedLearnerRequest.status, 401, 'locked accounts cannot continue using authenticated learning APIs')

  const outsiderManagerCannotUnlock = await callApi('/api/v1/admin/restrictions', {
    method: 'POST', token: await issueAccessToken(chapterOutsiderId, 'CHAPTER_LEADER'),
    body: { action: 'LIFT', targetType: 'CHAPTER', targetId: chapterA.id },
  })
  assert.equal(outsiderManagerCannotUnlock.status, 403, 'Chapter managers cannot lift restrictions')

  const overlappingDirectLock = await callApi('/api/v1/admin/restrictions', {
    method: 'POST', token: adminToken,
    body: { action: 'LOCK', targetType: 'USER', targetId: learnerId, reason: 'Integration: independent direct lock' },
  })
  assert.equal(overlappingDirectLock.status, 201, 'an independent direct restriction can coexist with the Chapter cascade')
  const chapterLift = await callApi('/api/v1/admin/restrictions', {
    method: 'POST', token: adminToken, body: { action: 'LIFT', targetType: 'CHAPTER', targetId: chapterA.id },
  })
  assert.equal(chapterLift.status, 200)
  const chapterLiftData = await readJson(chapterLift)
  assert.equal(chapterLiftData.unlocked, false, 'lifting a Chapter cause does not erase other direct account locks')
  assert.equal((await prisma.user.findUnique({ where: { id: learnerId }, select: { status: true } })).status, 'LOCKED')

  for (const userId of [learnerId, chapterLeaderId]) {
    const userLift = await callApi('/api/v1/admin/restrictions', {
      method: 'POST', token: adminToken, body: { action: 'LIFT', targetType: 'USER', targetId: userId },
    })
    assert.equal(userLift.status, 200)
    assert.equal((await readJson(userLift)).unlocked, true, 'Admin lift reactivates only after every active cause is removed')
  }
  const lockAudit = await prisma.accessRestriction.findFirst({
    where: { user_id: learnerId, type: 'DIRECT_ADMIN' },
    orderBy: { created_at: 'desc' },
  })
  assert.ok(lockAudit?.lifted_at && lockAudit.lifted_by_user_id === adminId, 'lock audit records the Admin and time of unlock')

  const enforceDeadline = await callApi('/api/internal/learning/deadlines/enforce', { method: 'POST', token: adminToken })
  assert.equal(enforceDeadline.status, 200, 'Admin can run the deadline enforcer')
  const deadlineResult = await readJson(enforceDeadline)
  assert.ok(deadlineResult.lockedUsers.includes(deadlineUserId), 'an overdue required assignment locks its member account')
  const deadlineState = await prisma.userLearningAssignment.findUnique({ where: { id: deadlineAssignment.id }, select: { status: true } })
  assert.equal(deadlineState.status, 'OVERDUE')
  assert.equal((await prisma.user.findUnique({ where: { id: deadlineUserId }, select: { status: true } })).status, 'LOCKED')
  const deadlineRestriction = await prisma.accessRestriction.findFirst({ where: { user_id: deadlineUserId, type: 'DEADLINE', lifted_at: null } })
  assert.ok(deadlineRestriction?.source_reference === `learning-assignment:${deadlineAssignment.id}`, 'deadline lock is tied to the exact overdue assignment')
  const managerCannotUnlockDeadline = await callApi('/api/v1/admin/restrictions', {
    method: 'POST', token: await issueAccessToken(chapterOutsiderId, 'CHAPTER_LEADER'),
    body: { action: 'LIFT', targetType: 'USER', targetId: deadlineUserId },
  })
  assert.equal(managerCannotUnlockDeadline.status, 403, 'only Admin may reopen a deadline-locked account')
  const adminLiftDeadline = await callApi('/api/v1/admin/restrictions', {
    method: 'POST', token: adminToken, body: { action: 'LIFT', targetType: 'USER', targetId: deadlineUserId },
  })
  assert.equal(adminLiftDeadline.status, 200)
  assert.equal((await readJson(adminLiftDeadline)).unlocked, true)
  const deadlineAuditAfterLift = await prisma.accessRestriction.findUnique({ where: { id: deadlineRestriction.id }, select: { lifted_at: true, lifted_by_user_id: true } })
  assert.ok(deadlineAuditAfterLift.lifted_at && deadlineAuditAfterLift.lifted_by_user_id === adminId, 'deadline audit records Admin lift actor and time')

  console.log('Learning-flow API integration passed: guarded database isolation; Admin-only exam authoring and cover-upload validation; 100% video and anti-seek cap; sequential video and quiz gates; answer validation/reset; immutable submit, grading, retry cooldown/numbering/results; lesson/final Stars idempotency; course completion; view-only assignment; Chapter/DNA scope enforcement; Admin-only direct, Chapter-cascade, and deadline lock/unlock with overlapping-cause audit.')
} catch (error) {
  console.error('Learning-flow integration failed. Only guarded fixture data is used; development namespaces are retained.')
  console.error(error instanceof Error ? error.stack || error.message : 'Unknown test error')
  process.exitCode = 1
} finally {
  try {
    if(devTarget)console.log(`Fixture namespace retained for inspection: ${devTarget.schema}; prefix ${prefix}`)
    else await cleanupFixtures()
  } catch (error) {
    console.error(`Fixture cleanup failed for prefix ${prefix}; inspect only bbe_test_learning_flow records with this prefix before rerunning.`)
    console.error(error instanceof Error ? error.message : 'Unknown cleanup error')
    process.exitCode = 1
  }
  await prisma.$disconnect()
}
