/* Real transactions only on a dedicated loopback database; no environment-file fallback. */
const assert = require('node:assert/strict')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const target = process.env.TEST_DATABASE_URL
if (!target) throw new Error('TEST_DATABASE_URL is required; never falls back to the application database.')
const url = new URL(target)
if (url.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/bbe_test_learning_cycles') {
  throw new Error('Only loopback database bbe_test_learning_cycles is allowed.')
}
process.env.DATABASE_URL = target
process.env.DIRECT_URL = target
require('ts-node').register({ project: 'tsconfig.test.json' })
const Module = require('node:module')
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  return originalResolve.call(this, request.startsWith('@/') ? path.resolve('src', request.slice(2)) : request, ...args)
}
const { prisma } = require('../../src/lib/prisma')
const { submitQuiz } = require('../../src/lib/quiz-submission')
const { recordVideoHeartbeat } = require('../../src/lib/video-heartbeat')
const { reconcileLearningAssignmentsForUser } = require('../../src/lib/learning-assignments')
const { applyDueChapterReorganizations } = require('../../src/lib/chapter-reorganizations')
const { processLearningOutbox } = require('../../src/lib/learning-outbox')
const { prepareOrganizationTransition } = require('../../src/lib/organization-transition')
const { publishCourseRequirements, captureCourseRequirementVersion } = require('../../src/lib/course-requirements')
const { closeCompetitionMonths, completePendingCompetitionKpis, closeCompetitionTerms } = require('../../src/lib/competition-snapshots')
const { initializeLearningCutover } = require('../../src/lib/learning-cutover')
const { chapterRewardBoundary } = require('../../src/lib/chapter-reward-gate')

const owned = { userIds: [] }
let originalPolicy
async function createOwnedUser(input) {
  const row = await prisma.user.create(input)
  owned.userIds.push(row.id)
  return row
}
async function cleanupOwnedFixtures() {
  const userIds = owned.userIds
  if (userIds.length) {
    await prisma.starLedger.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.attempt.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.userLearningAssignment.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.supplementalLearningRequirement.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.cycleLessonProgress.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.monthlyVideoReplay.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.quizRewardHighWaterMark.deleteMany({ where: { user_id: { in: userIds } } })
    const paths = await prisma.learningPath.findMany({ where: { user_id: { in: userIds } }, select: { id: true } })
    await prisma.learningPathChange.deleteMany({ where: { path_id: { in: paths.map(row => row.id) } } })
    await prisma.learningPath.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.learningCycle.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.learningNotice.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.learningOutbox.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.positionAssignment.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.chapterLeadBinding.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.organizationMembership.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.accountStateInterval.deleteMany({ where: { user_id: { in: userIds } } })
    await prisma.chapterAffiliationInterval.deleteMany({ where: { user_id: { in: userIds } } })
  }
  if (owned.courseId) {
    await prisma.course.deleteMany({ where: { id: owned.courseId } })
    await prisma.courseRequirementVersion.deleteMany({ where: { course_id: owned.courseId } })
    await prisma.coursePublicationEvent.deleteMany({ where: { course_id: owned.courseId } })
  }
  const keys = owned.cutoverKey ? [owned.cutoverKey] : []
  if (owned.monthId) for (const group of ['MEMBER', 'LT', 'DNA', 'CHAPTER']) keys.push(`ranking:${group}:${owned.monthId}`)
  if (owned.chapterId) {
    const transfers = await prisma.chapterReorganization.findMany({ where: { chapter_id: owned.chapterId }, select: { id: true } })
    keys.push(...transfers.map(row => `transfer:${row.id}`))
    const terms = await prisma.chapterCompetitionTerm.findMany({ where: { chapter_id: owned.chapterId }, select: { id: true } })
    for (const term of terms) {
      keys.push(`statistics:CHAPTER:${term.id}`)
      for (const group of ['MEMBER', 'LT', 'CHAPTER']) keys.push(`ranking:${group}:${term.id}`)
    }
    await prisma.learningSnapshot.deleteMany({ where: { payload: { path: ['chapterId'], equals: owned.chapterId } } })
    await prisma.chapterReorganization.deleteMany({ where: { chapter_id: owned.chapterId } })
    await prisma.chapterCompetitionTerm.deleteMany({ where: { chapter_id: owned.chapterId } })
    await prisma.chapter.deleteMany({ where: { id: owned.chapterId } })
  }
  await prisma.learningSnapshot.deleteMany({ where: { key: { in: keys } } })
  if (owned.monthId) await prisma.competitionMonth.deleteMany({ where: { id: owned.monthId } })
  if (owned.rootId) {
    const chapters = await prisma.organizationUnit.findMany({ where: { parent_id: owned.rootId, type: 'CHAPTER' }, select: { id: true } })
    await prisma.organizationUnit.deleteMany({ where: { parent_id: { in: chapters.map(row => row.id) } } })
    await prisma.organizationUnit.deleteMany({ where: { parent_id: owned.rootId } })
    await prisma.organizationUnit.deleteMany({ where: { id: owned.rootId } })
  }
  // Authored course/KPI/reorganization rows use RESTRICT actor references.
  // Remove their owned containers before removing the fixture actors.
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } })
}

async function main() {
  originalPolicy = await prisma.learningPolicy.findUnique({ where: { id: 'default' } })
  const suffix = randomUUID()
  owned.suffix = suffix
  const admin = await createOwnedUser({ data: { email: `admin-${suffix}@example.invalid`, password_hash: '-', role: 'ADMIN' } })
  const user = await createOwnedUser({ data: { email: `member-${suffix}@example.invalid`, password_hash: '-', role: 'MEMBER', created_at: new Date(Date.now() - 86_400_000) } })
  const omitted = await createOwnedUser({ data: { email: `omitted-${suffix}@example.invalid`, password_hash: '-', role: 'MEMBER', created_at: new Date(Date.now() - 86_400_000) } })
  const root = await prisma.organizationUnit.create({ data: { name: suffix, type: 'ROOT' } })
  owned.rootId = root.id
  const chapterUnit = await prisma.organizationUnit.create({ data: { name: 'Chapter', type: 'CHAPTER', parent_id: root.id } })
  const chapter = await prisma.chapter.create({ data: { name: suffix, organization_unit_id: chapterUnit.id } })
  owned.chapterId = chapter.id
  const dept = await prisma.organizationUnit.create({ data: { name: 'Department', type: 'DEPARTMENT', parent_id: chapterUnit.id } })
  const dna = await prisma.organizationUnit.create({ data: { name: 'DNA', type: 'DNA', parent_id: root.id } })
  for (const member of [user, omitted]) {
    await prisma.chapterMember.create({ data: { chapter_id: chapter.id, user_id: member.id } })
    await prisma.organizationMembership.createMany({ data: [chapterUnit.id, dept.id].map((id) => ({ user_id: member.id, unit_id: id })) })
  }
  const program = await prisma.learningProgram.upsert({ where: { code: 'CORE_MEMBER' }, update: {}, create: { code: 'CORE_MEMBER', name: 'Thành viên', is_core: true, sort_order: 0 } })
  const course = await prisma.course.create({ data: { program_id: program.id, title: suffix, created_by: admin.id, status: 'PUBLISHED', mandatory_default_due_days: 10 } })
  owned.courseId = course.id
  const session = await prisma.session.create({ data: { course_id: course.id, title: 'Session', sort_order: 0 } })
  const lesson = await prisma.lesson.create({ data: { session_id: session.id, title: 'Lesson', sort_order: 0 } })
  const video = await prisma.video.create({ data: { lesson_id: lesson.id, youtube_video_id: suffix, duration_seconds: 10 } })
  const assessment = await prisma.assessment.create({ data: { lesson_id: lesson.id, created_by: admin.id, title: 'Quiz', question_count: 2 } })
  const questions = []
  for (let index = 0; index < 2; index++) questions.push(await prisma.question.create({ data: {
    assessment_id: assessment.id, question_text: 'Question', sort_order: index,
    options: { create: [{ option_text: 'Correct', is_correct: true, sort_order: 0 }, { option_text: 'Wrong', sort_order: 1 }] },
  }, include: { options: true } }))
  await prisma.$transaction((tx) => captureCourseRequirementVersion(tx, course.id, new Date()))
  const rule = await prisma.learningRule.create({ data: { course_id: course.id, organization_unit_id: chapterUnit.id, due_days: 10 } })
  await prisma.userLearningAssignment.create({ data: { user_id: user.id, course_id: course.id, rule_id: rule.id, assigned_at: new Date(Date.now() - 86_400_000), due_at: new Date(Date.now() + 20 * 86_400_000) } })
  await prisma.lessonProgress.create({ data: { user_id: user.id, lesson_id: lesson.id, completed: true, completed_at: new Date(), furthest_watched_position_seconds: 10 } })
  await prisma.starLedger.create({ data: { user_id: user.id, amount: 99, reason: 'ADMIN_ADJUSTMENT', reward_key: suffix, source_type: 'USER', source_id: user.id } })
  await prisma.learningPolicy.upsert({ where: { id: 'default' }, update: { cutover_at: new Date(Date.now() - 60_000), mapping_approved_at: new Date() }, create: { cutover_at: new Date(Date.now() - 60_000), mapping_approved_at: new Date() } })
  const boundary = chapterRewardBoundary(new Date())
  const season = await prisma.transferSeason.upsert({ where: { reward_boundary_at: boundary }, update: {}, create: { code: `IT_${boundary.toISOString()}`, reward_boundary_at: boundary, starts_at: new Date(boundary.getTime() - 30 * 86_400_000), ends_at: new Date(boundary.getTime() + 150 * 86_400_000) } })
  const earlyFixture = await prisma.chapterReorganization.create({ data: { transfer_season_id: season.id, chapter_id: chapter.id, created_by_user_id: admin.id, status: 'APPLIED', effective_at: new Date(Date.now() - 86_400_000), applied_at: new Date(Date.now() - 86_400_000) } })
  await reconcileLearningAssignmentsForUser(user.id)
  const cycle = await prisma.learningCycle.findFirstOrThrow({ where: { user_id: user.id, ends_at: null } })
  assert.equal(cycle.provenance, 'LEGACY')
  assert.equal((await prisma.cycleLessonProgress.findFirstOrThrow({ where: { user_id: user.id } })).provenance, 'LEGACY')
  const pathBefore = await prisma.learningPath.findUniqueOrThrow({ where: { learning_cycle_id: cycle.id } })
  await reconcileLearningAssignmentsForUser(user.id)
  assert.deepEqual((await prisma.learningPath.findUniqueOrThrow({ where: { learning_cycle_id: cycle.id } })).due_at, pathBefore.due_at, 'retry must not move the imported deadline')

  async function makeAttempt(expired = false) {
    const attempt = await prisma.attempt.create({ data: { assessment_id: assessment.id, user_id: user.id, learning_cycle_id: cycle.id, attempt_number: 1, started_at: new Date(), expires_at: new Date(Date.now() + (expired ? -1000 : 60_000)) } })
    for (const [index, question] of questions.entries()) {
      await prisma.attemptQuestion.create({ data: { attempt_id: attempt.id, question_id: question.id, display_order: index, question_snapshot: { id: question.id, points: 1, options: question.options.map((option) => ({ id: option.id, text: option.option_text, correct: option.is_correct })) } } })
      await prisma.attemptAnswer.create({ data: { attempt_id: attempt.id, question_id: question.id, selected_option_id: question.options.find((option) => option.is_correct).id } })
    }
    return attempt
  }
  const manual = await makeAttempt(), auto = await makeAttempt(true)
  const results = await Promise.all([submitQuiz({ attemptId: manual.id, userId: user.id }), submitQuiz({ attemptId: auto.id, auto: true })])
  assert.ok(results.every((result) => !result.error && result.grading.passed))
  assert.equal(results.reduce((sum, result) => sum + result.amount, 0), 2, 'concurrent manual and auto attempts share one reward budget')
  assert.equal((await submitQuiz({ attemptId: manual.id, userId: user.id })).amount, 0)
  assert.equal(await prisma.quizRewardHighWaterMark.count({ where: { user_id: user.id } }), 1)
  await prisma.questionOption.updateMany({ where: { question_id: { in: questions.map((row) => row.id) } }, data: { is_correct: false } })
  const frozen = await makeAttempt()
  assert.equal((await submitQuiz({ attemptId: frozen.id, userId: user.id })).grading.passed, true, 'start snapshots survive later bank edits')

  const first = await recordVideoHeartbeat(user.id, lesson.id, 10, 10)
  assert.equal(first.starReward.amount, 0, 'training completion cannot pay for a new monthly replay')
  await prisma.monthlyVideoReplay.updateMany({ where: { user_id: user.id, video_id: video.id }, data: { last_heartbeat_at: new Date(Date.now() - 301_000) } })
  const disconnected = await recordVideoHeartbeat(user.id, lesson.id, 10, 10)
  assert.ok(disconnected.replay.watchedSeconds <= 4, 'a disconnected gap may receive only the current 4-second jitter allowance, not elapsed watch time')
  assert.equal(disconnected.replay.completed, false)
  assert.equal(disconnected.starReward.amount, 0)
  await prisma.monthlyVideoReplay.updateMany({ where: { user_id: user.id, video_id: video.id }, data: { furthest_seconds: 0, last_heartbeat_at: new Date(Date.now() - 6000), view_session_id: 'first-view' } })
  const switched = await recordVideoHeartbeat(user.id, lesson.id, 10, 10, false, 'new-view')
  assert.ok(switched.replay.watchedSeconds <= 4, 'a new viewing session receives only the jitter allowance, not time elapsed in the previous tab')
  assert.equal(switched.replay.completed, false)
  assert.equal(switched.starReward.amount, 0)
  await prisma.monthlyVideoReplay.updateMany({ where: { user_id: user.id, video_id: video.id }, data: { last_heartbeat_at: new Date(Date.now() - 6000), view_session_id: 'COMPAT' } })
  const heartbeats = await Promise.all([recordVideoHeartbeat(user.id, lesson.id, 10, 10), recordVideoHeartbeat(user.id, lesson.id, 10, 10)])
  assert.equal(heartbeats.reduce((sum, result) => sum + result.starReward.amount, 0), 1)

  await publishCourseRequirements(course.id)
  const oldDeadline = (await prisma.userLearningAssignment.findFirstOrThrow({ where: { user_id: user.id, ended_at: null } })).due_at
  await prisma.lesson.createMany({ data: [1, 2].map((index) => ({ session_id: session.id, title: `New ${index}`, sort_order: index })) })
  await publishCourseRequirements(course.id)
  const extendedPath = await prisma.learningPath.findUniqueOrThrow({ where: { learning_cycle_id: cycle.id } })
  assert.equal(extendedPath.due_at.getTime(), oldDeadline.getTime() + 8 * 86_400_000, '2 added lessons * max(ceil(10/3),3) extends the shared deadline by 8 days')
  assert.deepEqual((await prisma.userLearningAssignment.findFirstOrThrow({ where: { user_id: user.id, ended_at: null } })).due_at, extendedPath.due_at, 'current mandatory assignments use the extended shared deadline')
  assert.equal(await prisma.supplementalLearningRequirement.count({ where: { user_id: user.id } }), 0, 'current publication updates the shared path instead of creating a separate obligation')
  const updatedVersion = await prisma.courseRequirementVersion.findFirstOrThrow({ where: { course_id: course.id }, orderBy: { version: 'desc' } })
  assert.equal(await prisma.learningNotice.count({ where: { event_key: `content:${updatedVersion.id}:${user.id}` } }), 1)
  await publishCourseRequirements(course.id)
  assert.equal(await prisma.courseRequirementVersion.count({ where: { course_id: course.id } }), 2)
  assert.deepEqual((await prisma.learningPath.findUniqueOrThrow({ where: { learning_cycle_id: cycle.id } })).due_at, extendedPath.due_at, 'publish retry must not extend the deadline again')
  assert.equal(await prisma.learningNotice.count({ where: { event_key: `content:${updatedVersion.id}:${user.id}` } }), 1, 'publish retry must not duplicate the content notice')
  // Existing legacy supplemental rows still need to be ended by a cycle reset.
  const supplement = await prisma.supplementalLearningRequirement.create({ data: {
    user_id: user.id, course_id: course.id, learning_cycle_id: cycle.id, requirement_version_id: updatedVersion.id,
    lesson_ids: updatedVersion.lesson_ids.filter(id => id !== lesson.id), added_days: 8, due_at: extendedPath.due_at,
  } })

  const pendingAttempt = await makeAttempt()
  // Replace the synthetic early-transfer evidence to exercise the actual reset path.
  await prisma.chapterReorganization.update({ where: { id: earlyFixture.id }, data: { status: 'CANCELLED' } })
  const presidentPosition = await prisma.position.upsert({ where: { code: 'CHAPTER_PRESIDENT' }, update: {}, create: { code: 'CHAPTER_PRESIDENT', name: 'President', scope: 'CHAPTER' } })
  const transfer = await prisma.chapterReorganization.create({ data: { transfer_season_id: season.id, chapter_id: chapter.id, created_by_user_id: admin.id, status: 'SCHEDULED', effective_at: new Date(Date.now() - 60_000), items: { create: { user_id: user.id, department_unit_id: null, position_id: presidentPosition.id } } } })
  await applyDueChapterReorganizations(new Date(), transfer.id)
  await applyDueChapterReorganizations(new Date(), transfer.id)
  assert.equal(await prisma.learningSnapshot.count({ where: { key: `transfer:${transfer.id}` } }), 1)
  assert.equal(await prisma.learningCycle.count({ where: { user_id: user.id } }), 2, 'retry cannot reset twice')
  assert.equal(await prisma.positionAssignment.count({ where: { user_id: user.id, unit_id: chapterUnit.id, position_id: presidentPosition.id, ends_at: null } }), 1, 'President belongs to the Chapter position, not a Department')
  assert.equal((await prisma.attempt.findUniqueOrThrow({ where: { id: pendingAttempt.id } })).cancellation_reason, 'LEARNING_CYCLE_RESET')
  assert.equal((await prisma.lessonProgress.findUniqueOrThrow({ where: { user_id_lesson_id: { user_id: user.id, lesson_id: lesson.id } } })).completed, false)
  assert.ok((await prisma.supplementalLearningRequirement.findUniqueOrThrow({ where: { id: supplement.id } })).ended_at, 'reset ends the old supplemental obligation without deleting its history')
  assert.equal(await prisma.chapterMember.count({ where: { user_id: omitted.id } }), 1, 'omitted roster names remain in the Chapter')
  assert.equal(await prisma.organizationMembership.count({ where: { user_id: omitted.id, unit_id: dept.id, status: 'ACTIVE' } }), 0)
  await processLearningOutbox(100)
  const newCycle = await prisma.learningCycle.findFirstOrThrow({ where: { user_id: user.id, ends_at: null } })
  await prisma.$transaction(async (tx) => {
    const effectiveAt = await prepareOrganizationTransition(tx, user.id, dna.id, admin.id)
    await tx.organizationMembership.create({ data: { user_id: user.id, unit_id: dna.id, starts_at: effectiveAt } })
    await reconcileLearningAssignmentsForUser(user.id, tx)
  })
  assert.equal(await prisma.chapterMember.count({ where: { user_id: user.id } }), 0)
  await assert.rejects(prisma.chapterMember.create({ data: { user_id: user.id, chapter_id: chapter.id } }), /SingleOrganizationAffiliationRequired|constraint/i)
  assert.equal((await prisma.learningCycle.findFirstOrThrow({ where: { user_id: user.id, ends_at: null } })).id, newCycle.id, 'DNA appointment preserves the current training cycle')
  assert.equal((await prisma.starLedger.aggregate({ where: { user_id: user.id }, _sum: { amount: true } }))._sum.amount, 102, 'history and existing rewards survive transfer and DNA appointment')
  assert.equal(await prisma.userLearningAssignment.count({ where: { user_id: user.id, mandatory: true, ended_at: null } }), 0)
  // A deliberately shortened test period lets a delayed closer prove historical state.
  const testMonthKey = `${6000 + Math.floor(Math.random() * 3000)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}`
  const periodEnd = new Date(Date.now() + 200)
  const testMonth = await prisma.competitionMonth.create({ data: { key: testMonthKey, starts_at: new Date(Date.now() - 60_000), ends_at: periodEnd } })
  owned.monthId = testMonth.id
  const omittedCycle = await prisma.learningCycle.findFirstOrThrow({ where: { user_id: omitted.id, ends_at: null } })
  await prisma.starLedger.create({ data: { user_id: omitted.id, amount: 17, reason: 'ADMIN_ADJUSTMENT', source_type: 'USER', source_id: omitted.id, reward_key: `snapshot:${suffix}`, competition_month_id: testMonth.id, learning_cycle_id: omittedCycle.id, chapter_at_award_id: chapter.id, provenance: 'NATIVE', awarded_at: new Date() } })
  await new Promise((resolve) => setTimeout(resolve, 250))
  await prisma.user.update({ where: { id: omitted.id }, data: { status: 'INACTIVE' } })
  await closeCompetitionMonths()
  const board = (await prisma.learningSnapshot.findUniqueOrThrow({ where: { key: `ranking:MEMBER:${testMonth.id}` } })).payload
  assert.equal(board.items.find((row) => row.userId === omitted.id).stars, 17, 'closing late uses the active role at the boundary, even after deactivation')
  assert.equal((await prisma.competitionMonth.findUniqueOrThrow({ where: { id: testMonth.id } })).state, 'CLOSED')
  let chapterBoard = await prisma.learningSnapshot.findUniqueOrThrow({ where: { key: `ranking:CHAPTER:${testMonth.id}` } })
  assert.equal(chapterBoard.payload.state, 'WAITING_KPI')
  chapterBoard = await prisma.learningSnapshot.update({ where: { id: chapterBoard.id }, data: {
    payload: { ...chapterBoard.payload, items: chapterBoard.payload.items.filter(row => row.chapterId === chapter.id) },
  } })
  assert.equal(chapterBoard.payload.items.length, 1, 'KPI finalization fixture must contain its owned Chapter')
  const savedStages = JSON.stringify(chapterBoard.payload.items.map((row) => row.stages))
  for (const row of chapterBoard.payload.items) {
    await prisma.chapterMonthlyKpi.upsert({ where: { chapter_id_month_start: { chapter_id: row.chapterId, month_start: new Date(`${testMonth.key}-01T00:00:00Z`) } }, update: { status: 'YELLOW' }, create: { chapter_id: row.chapterId, month_start: new Date(`${testMonth.key}-01T00:00:00Z`), status: 'YELLOW', configured_by_user_id: admin.id } })
    await prisma.learningSnapshot.create({ data: { key: `kpi-it:${suffix}:${row.chapterId}`, kind: 'CHAPTER_KPI_HISTORY', captured_at: new Date(), payload: { chapterId: row.chapterId, month: testMonth.key, status: 'YELLOW', provenance: 'NATIVE' } } })
  }
  await completePendingCompetitionKpis()
  chapterBoard = await prisma.learningSnapshot.findUniqueOrThrow({ where: { key: `ranking:CHAPTER:${testMonth.id}` } })
  assert.equal(chapterBoard.payload.state, 'FINALIZED')
  assert.equal(JSON.stringify(chapterBoard.payload.items.map((row) => row.stages)), savedStages, 'KPI completion never recomputes saved membership/progress stages')
  const finalized = JSON.stringify(chapterBoard.payload)
  await prisma.chapterMonthlyKpi.updateMany({ where: { chapter_id: chapter.id, month_start: new Date(`${testMonth.key}-01T00:00:00Z`) }, data: { status: 'RED' } })
  await completePendingCompetitionKpis()
  assert.equal(JSON.stringify((await prisma.learningSnapshot.findUniqueOrThrow({ where: { id: chapterBoard.id } })).payload), finalized, 'finalized results are immutable')
  const closedTerm = await prisma.chapterCompetitionTerm.create({ data: { chapter_id: chapter.id, starts_at: testMonth.starts_at, ends_at: periodEnd } })
  await closeCompetitionTerms()
  assert.equal((await prisma.learningSnapshot.findUniqueOrThrow({ where: { key: `ranking:MEMBER:${closedTerm.id}` } })).payload.state, 'FINALIZED')

  // A legacy ChapterMember may exist without a matching organization membership.
  await prisma.learningPolicy.update({ where: { id: 'default' }, data: { cutover_at: null } })
  const dual = await createOwnedUser({ data: { email: `legacy-dual-${suffix}@example.invalid`, password_hash: '-', role: 'MEMBER' } })
  await prisma.chapterMember.create({ data: { user_id: dual.id, chapter_id: chapter.id } })
  await prisma.organizationMembership.create({ data: { user_id: dual.id, unit_id: dna.id } })
  await prisma.starLedger.create({ data: { user_id: dual.id, amount: 9, reason: 'ADMIN_ADJUSTMENT', source_type: 'USER', source_id: dual.id, reward_key: `legacy-dual:${suffix}` } })
  await prisma.learningPolicy.update({ where: { id: 'default' }, data: { cutover_at: new Date(Date.now() - 1_000), mapping_approved_at: new Date() } })
  owned.cutoverKey = `cutover:${(await prisma.learningPolicy.findUniqueOrThrow({ where: { id: 'default' } })).cutover_at.toISOString()}`
  assert.equal(await initializeLearningCutover(), true)
  assert.equal(await prisma.chapterMember.count({ where: { user_id: dual.id } }), 0, 'cutover atomically converts legacy dual affiliation to DNA')
  assert.equal(await prisma.organizationMembership.count({ where: { user_id: dual.id, unit_id: dna.id, status: 'ACTIVE' } }), 1)
  assert.equal((await prisma.starLedger.aggregate({ where: { user_id: dual.id }, _sum: { amount: true } }))._sum.amount, 9)
  assert.equal(await initializeLearningCutover(), false, 'cutover retry is a no-op')
  console.log('PASS: legacy import, stable deadlines, concurrent submissions, frozen questions, monthly replay, disconnected heartbeat, atomic transfer, retry, omitted roster, outbox exclusive DNA membership, shared-deadline publish retries and legacy supplemental reset history, delayed month close, historical roles, KPI completion, immutable term/month snapshots and atomic legacy dual-affiliation cutover.')
}
main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(async () => {
  try { await cleanupOwnedFixtures() }
  catch (error) { console.error('Owned fixture cleanup failed:', error); process.exitCode = 1 }
  finally {
    try {
      if (originalPolicy) await prisma.learningPolicy.update({ where: { id: 'default' }, data: {
        cutover_at: originalPolicy.cutover_at, mapping_approved_at: originalPolicy.mapping_approved_at, updated_at: originalPolicy.updated_at,
      } })
      else if (originalPolicy === null) await prisma.learningPolicy.deleteMany({ where: { id: 'default' } })
    } finally { await prisma.$disconnect() }
  }
})
