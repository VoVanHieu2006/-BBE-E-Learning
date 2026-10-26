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
const { prisma } = require('../src/lib/prisma')
const { submitQuiz } = require('../src/lib/quiz-submission')
const { recordVideoHeartbeat } = require('../src/lib/video-heartbeat')
const { reconcileLearningAssignmentsForUser } = require('../src/lib/learning-assignments')
const { applyDueChapterReorganizations } = require('../src/lib/chapter-reorganizations')
const { processLearningOutbox } = require('../src/lib/learning-outbox')
const { prepareOrganizationTransition } = require('../src/lib/organization-transition')
const { publishCourseRequirements, captureCourseRequirementVersion } = require('../src/lib/course-requirements')
const { closeCompetitionMonths, completePendingCompetitionKpis, closeCompetitionTerms } = require('../src/lib/competition-snapshots')
const { initializeLearningCutover } = require('../src/lib/learning-cutover')
const { chapterRewardBoundary } = require('../src/lib/chapter-reward-gate')

async function main() {
  // A repeated run uses unique fixtures. Policy is test-only and explicitly reset.
  // Expired artificial periods from an interrupted run are not acceptance fixtures.
  await prisma.competitionMonth.updateMany({ where: { state: 'OPEN', ends_at: { lt: new Date() } }, data: { state: 'CLOSED' } })
  const interruptedCourses = await prisma.course.findMany({ where: { status: 'PUBLISHED', program: { is_core: true } }, select: { id: true } })
  for (const row of interruptedCourses) if (!await prisma.courseRequirementVersion.count({ where: { course_id: row.id } })) await prisma.$transaction((tx) => captureCourseRequirementVersion(tx, row.id, new Date()))
  const suffix = randomUUID()
  const admin = await prisma.user.create({ data: { email: `admin-${suffix}@example.invalid`, password_hash: '-', role: 'ADMIN' } })
  const user = await prisma.user.create({ data: { email: `member-${suffix}@example.invalid`, password_hash: '-', role: 'MEMBER', created_at: new Date(Date.now() - 86_400_000) } })
  const omitted = await prisma.user.create({ data: { email: `omitted-${suffix}@example.invalid`, password_hash: '-', role: 'MEMBER', created_at: new Date(Date.now() - 86_400_000) } })
  const root = await prisma.organizationUnit.create({ data: { name: suffix, type: 'ROOT' } })
  const chapterUnit = await prisma.organizationUnit.create({ data: { name: 'Chapter', type: 'CHAPTER', parent_id: root.id } })
  const chapter = await prisma.chapter.create({ data: { name: suffix, organization_unit_id: chapterUnit.id } })
  const dept = await prisma.organizationUnit.create({ data: { name: 'Department', type: 'DEPARTMENT', parent_id: chapterUnit.id } })
  const dna = await prisma.organizationUnit.create({ data: { name: 'DNA', type: 'DNA', parent_id: root.id } })
  for (const member of [user, omitted]) {
    await prisma.chapterMember.create({ data: { chapter_id: chapter.id, user_id: member.id } })
    await prisma.organizationMembership.createMany({ data: [chapterUnit.id, dept.id].map((id) => ({ user_id: member.id, unit_id: id })) })
  }
  const program = await prisma.learningProgram.upsert({ where: { code: 'CORE_MEMBER' }, update: {}, create: { code: 'CORE_MEMBER', name: 'Thành viên', is_core: true, sort_order: 0 } })
  const course = await prisma.course.create({ data: { program_id: program.id, title: suffix, created_by: admin.id, status: 'PUBLISHED', mandatory_default_due_days: 10 } })
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
  assert.equal((await recordVideoHeartbeat(user.id, lesson.id, 10, 10)).replay.watchedSeconds, 0, 'disconnected time is not watched time')
  await prisma.monthlyVideoReplay.updateMany({ where: { user_id: user.id, video_id: video.id }, data: { last_heartbeat_at: new Date(Date.now() - 6000), view_session_id: 'first-view' } })
  assert.equal((await recordVideoHeartbeat(user.id, lesson.id, 10, 10, false, 'new-view')).replay.watchedSeconds, 0, 'a new viewing session cannot claim time elapsed in an earlier tab')
  await prisma.monthlyVideoReplay.updateMany({ where: { user_id: user.id, video_id: video.id }, data: { last_heartbeat_at: new Date(Date.now() - 6000), view_session_id: 'COMPAT' } })
  const heartbeats = await Promise.all([recordVideoHeartbeat(user.id, lesson.id, 10, 10), recordVideoHeartbeat(user.id, lesson.id, 10, 10)])
  assert.equal(heartbeats.reduce((sum, result) => sum + result.starReward.amount, 0), 1)

  await publishCourseRequirements(course.id)
  const oldDeadline = (await prisma.userLearningAssignment.findFirstOrThrow({ where: { user_id: user.id, ended_at: null } })).due_at
  await prisma.lesson.createMany({ data: [1, 2].map((index) => ({ session_id: session.id, title: `New ${index}`, sort_order: index })) })
  await publishCourseRequirements(course.id)
  const supplement = await prisma.supplementalLearningRequirement.findFirstOrThrow({ where: { user_id: user.id } })
  assert.equal(supplement.added_days, 8, '2 lessons * max(ceil(10/3),3) = 8 days')
  assert.equal(supplement.due_at.getTime(), oldDeadline.getTime() + 8 * 86_400_000)
  await publishCourseRequirements(course.id)
  assert.equal(await prisma.courseRequirementVersion.count({ where: { course_id: course.id } }), 2)
  assert.equal(await prisma.supplementalLearningRequirement.count({ where: { user_id: user.id } }), 1, 'publish retry must not create a second obligation')
  assert.deepEqual((await prisma.userLearningAssignment.findFirstOrThrow({ where: { user_id: user.id, ended_at: null } })).due_at, oldDeadline, 'supplemental obligations preserve the old deadline')

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
  const allCore = await prisma.course.findMany({ where: { status: 'PUBLISHED', program: { is_core: true } }, select: { id: true } })
  for (const courseRow of allCore) await prisma.$transaction((tx) => captureCourseRequirementVersion(tx, courseRow.id, new Date()))
  const testMonthKey = `${6000 + Math.floor(Math.random() * 3000)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}`
  const periodEnd = new Date(Date.now() + 200)
  const testMonth = await prisma.competitionMonth.create({ data: { key: testMonthKey, starts_at: new Date(Date.now() - 60_000), ends_at: periodEnd } })
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
  await prisma.chapterMonthlyKpi.updateMany({ where: { month_start: new Date(`${testMonth.key}-01T00:00:00Z`) }, data: { status: 'RED' } })
  await completePendingCompetitionKpis()
  assert.equal(JSON.stringify((await prisma.learningSnapshot.findUniqueOrThrow({ where: { id: chapterBoard.id } })).payload), finalized, 'finalized results are immutable')
  const closedTerm = await prisma.chapterCompetitionTerm.create({ data: { chapter_id: chapter.id, starts_at: testMonth.starts_at, ends_at: periodEnd } })
  await closeCompetitionTerms()
  assert.equal((await prisma.learningSnapshot.findUniqueOrThrow({ where: { key: `ranking:MEMBER:${closedTerm.id}` } })).payload.state, 'FINALIZED')

  // A legacy ChapterMember may exist without a matching organization membership.
  await prisma.learningPolicy.update({ where: { id: 'default' }, data: { cutover_at: null } })
  const dual = await prisma.user.create({ data: { email: `legacy-dual-${suffix}@example.invalid`, password_hash: '-', role: 'MEMBER' } })
  await prisma.chapterMember.create({ data: { user_id: dual.id, chapter_id: chapter.id } })
  await prisma.organizationMembership.create({ data: { user_id: dual.id, unit_id: dna.id } })
  await prisma.starLedger.create({ data: { user_id: dual.id, amount: 9, reason: 'ADMIN_ADJUSTMENT', source_type: 'USER', source_id: dual.id, reward_key: `legacy-dual:${suffix}` } })
  await prisma.learningPolicy.update({ where: { id: 'default' }, data: { cutover_at: new Date(Date.now() - 1_000), mapping_approved_at: new Date() } })
  assert.equal(await initializeLearningCutover(), true)
  assert.equal(await prisma.chapterMember.count({ where: { user_id: dual.id } }), 0, 'cutover atomically converts legacy dual affiliation to DNA')
  assert.equal(await prisma.organizationMembership.count({ where: { user_id: dual.id, unit_id: dna.id, status: 'ACTIVE' } }), 1)
  assert.equal((await prisma.starLedger.aggregate({ where: { user_id: dual.id }, _sum: { amount: true } }))._sum.amount, 9)
  assert.equal(await initializeLearningCutover(), false, 'cutover retry is a no-op')
  console.log('PASS: legacy import, stable deadlines, concurrent submissions, frozen questions, monthly replay, disconnected heartbeat, atomic transfer, retry, omitted roster, outbox exclusive DNA membership, supplemental publish retries, delayed month close, historical roles, KPI completion, immutable term/month snapshots and atomic legacy dual-affiliation cutover.')
}
main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
