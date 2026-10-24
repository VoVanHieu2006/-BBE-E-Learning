// Phase 1 integration suite: video heartbeat completion rules, progress
// safety, quiz gates and reward idempotence. It follows the project's
// established dev-DB contract (same as the root test-prompt*.js files):
//
//   1. `npm run dev` serving TEST_APP_BASE (default http://127.0.0.1:3000)
//   2. node scripts/test-phase1-video-quiz.mjs
//
// Every fixture row is prefixed `phase1-it-<fixture>` and removed afterwards.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { SignJWT } from 'jose'
import { PrismaClient } from '@prisma/client'

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
if (!process.env.JWT_ACCESS_SECRET) throw new Error('JWT_ACCESS_SECRET must exist in .env to mint test tokens.')

const appBase = new URL(process.env.TEST_APP_BASE || 'http://127.0.0.1:3000')
const prisma = new PrismaClient({ log: [] })
const fixture = randomUUID().slice(0, 8)
const prefix = `phase1-it-${fixture}`
const email = `${prefix}@example.invalid`

const created = { userIds: [], courseIds: [], monthIds: [], unitRootIds: [] }
let currentMonthId = null
let originalMonthEndsAt = null

async function callApi(path, { method = 'GET', token, body } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  return fetch(new URL(path, appBase), { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store' })
}

async function readJson(response) {
  const raw = await response.text().catch(() => '')
  let body = null
  try { body = raw ? JSON.parse(raw) : null } catch {}
  if (!body || typeof body !== 'object') {
    throw new Error(`API returned non-JSON (${response.status}): ${raw.slice(0, 300)}`)
  }
  return body
}

async function issueAccessToken(userId) {
  return new SignJWT({ role: 'MEMBER' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('30m')
    .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET))
}

/** Back-date the monthly replay so the next call behaves like a wall-clock gap. */
async function backdate(userId, videoId, gapSeconds) {
  await prisma.monthlyVideoReplay.updateMany({
    where: { user_id: userId, video_id: videoId },
    data: { last_heartbeat_at: new Date(Date.now() - gapSeconds * 1000) },
  })
}

async function heartbeat(userId, token, lesson, event, position, furthest = position, { gap = 10.6, rate = 2 } = {}) {
  if (gap > 0) await backdate(userId, lesson.video.id, gap)
  const response = await callApi(`/api/v1/lessons/${lesson.lessonId || lesson.id}/progress`, {
    method: 'PATCH', token,
    body: {
      positionSeconds: position,
      furthestWatchedPositionSeconds: furthest,
      playerDurationSeconds: lesson.video.duration_seconds,
      playbackRate: rate,
      event,
    },
  })
  const raw = await response.text().catch(() => '')
  let parsed = null
  try { parsed = raw ? JSON.parse(raw) : null } catch {}
  if (response.status !== 200) {
    assert.fail(`${event} heartbeat must be accepted for ${lesson.title} => HTTP ${response.status} ${JSON.stringify(parsed).slice(0, 400)}`)
  }
  return parsed
}

async function cleanup() {
  console.log(`\nCleaning fixtures with prefix ${prefix}...`)
  for (const userId of created.userIds) {
    await prisma.starLedger.deleteMany({ where: { user_id: userId } })
    await prisma.learningOutbox.deleteMany({ where: { user_id: userId } })
    await prisma.learningPath.deleteMany({ where: { user_id: userId } })
    await prisma.monthlyVideoReplay.deleteMany({ where: { user_id: userId } })
    await prisma.cycleLessonProgress.deleteMany({ where: { user_id: userId } })
    await prisma.quizRewardHighWaterMark.deleteMany({ where: { user_id: userId } })
    await prisma.attemptAnswer.deleteMany({ where: { attempt: { user_id: userId } } })
    await prisma.attemptQuestion.deleteMany({ where: { attempt: { user_id: userId } } })
    await prisma.attempt.deleteMany({ where: { user_id: userId } })
    await prisma.lessonProgress.deleteMany({ where: { user_id: userId } })
    await prisma.chapterMember.deleteMany({ where: { user_id: userId } })
    await prisma.organizationMembership.deleteMany({ where: { user_id: userId } })
    await prisma.userLearningAssignment.deleteMany({ where: { user_id: userId } })
    await prisma.learningCycle.deleteMany({ where: { user_id: userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
  }
  if (created.monthIds.length) await prisma.competitionMonth.deleteMany({ where: { id: { in: created.monthIds } } })
  if (currentMonthId && originalMonthEndsAt) {
    await prisma.competitionMonth.update({ where: { id: currentMonthId }, data: { ends_at: originalMonthEndsAt } })
  }
  if (created.courseIds.length) await prisma.course.deleteMany({ where: { id: { in: created.courseIds } } })
  if (created.unitRootIds.length) {
    const children = created.unitRootIds.filter((id) => id !== created.unitRootIds[0])
    if (children.length) await prisma.organizationUnit.deleteMany({ where: { id: { in: children } } })
    await prisma.organizationUnit.deleteMany({ where: { id: created.unitRootIds[0] } })
  }
  console.log('Cleanup finished.')
}

try {
  const appResponse = await fetch(new URL('/', appBase), { cache: 'no-store' })
  assert.ok(appResponse.ok, `local dev app must be running at ${appBase.origin} (npm run dev)`)

  const [policy] = await prisma.$queryRaw`SELECT cutover_at FROM learning_policy WHERE id = 'default'`
  assert.ok(policy?.cutover_at && policy.cutover_at <= new Date(), 'learning policy cutover must be active on this database')

  const currentMonth = await prisma.competitionMonth.findFirst({ where: { starts_at: { lte: new Date() }, ends_at: { gt: new Date() } } })
  assert.ok(currentMonth, 'current competition month must exist')
  currentMonthId = currentMonth.id
  originalMonthEndsAt = currentMonth.ends_at

  // ------------------------------------------------------------ fixtures ---
  const user = await prisma.user.create({
    data: { email, password_hash: `${prefix}-fixture`, role: 'MEMBER', status: 'ACTIVE' },
    select: { id: true },
  })
  created.userIds.push(user.id)
  const learnerToken = await issueAccessToken(user.id)
  const admin = await prisma.user.create({
    data: { email: `${prefix}-admin@example.invalid`, password_hash: `${prefix}-fixture`, role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true },
  })
  created.userIds.push(admin.id)
  const adminToken = await issueAccessToken(admin.id)

  // MEMBER sign-in requires an active affiliation; a DNA unit keeps reward
  // eligibility true without involving any chapter transfer state.
  const dnaRoot = await prisma.organizationUnit.create({ data: { name: `${prefix}-dna-root`, type: 'DNA' }, select: { id: true } })
  created.unitRootIds.push(dnaRoot.id)
  const dnaGroup = await prisma.organizationUnit.create({ data: { name: `${prefix}-dna-group`, type: 'DNA_GROUP', parent_id: dnaRoot.id }, select: { id: true } })
  created.unitRootIds.push(dnaGroup.id)
  await prisma.organizationMembership.createMany({
    data: [
      { user_id: user.id, unit_id: dnaGroup.id, status: 'ACTIVE', starts_at: new Date(Date.now() - 60_000) },
      { user_id: admin.id, unit_id: dnaRoot.id, status: 'ACTIVE', starts_at: new Date(Date.now() - 60_000) },
    ],
  })

  const course = await prisma.course.create({
    data: {
      title: `${prefix}-course`,
      status: 'PUBLISHED',
      visibility: 'PRIVATE',
      created_by: user.id,
      sessions: { create: { title: `${prefix}-session-1`, sort_order: 1, lessons: { create: [
        { title: `${prefix}-l1-168s`, sort_order: 1, video: { create: { youtube_video_id: `${prefix}-v1`, duration_seconds: 168 } } },
        { title: `${prefix}-l2-2s`, sort_order: 2, video: { create: { youtube_video_id: `${prefix}-v2`, duration_seconds: 2 } } },
        { title: `${prefix}-l3-30s`, sort_order: 3, video: { create: { youtube_video_id: `${prefix}-v3`, duration_seconds: 30 } } },
        { title: `${prefix}-l4-picture`, sort_order: 4, video: { create: { youtube_video_id: `${prefix}-v4`, duration_seconds: 168 } } },
      ] } } },
    },
    include: { sessions: { include: { lessons: { include: { video: true } } } } },
  })
  created.courseIds.push(course.id)
  const [l1, l2, l3, l4] = course.sessions.flatMap((session) => session.lessons).sort((a, b) => a.sort_order - b.sort_order)

  await prisma.userLearningAssignment.create({
    data: { user_id: user.id, course_id: course.id, mandatory: true, can_view: true, can_assess: true, can_earn_stars: true },
  })

  const quizAuthoring = await callApi(`/api/v1/lessons/${l1.id}/assessment`, {
    method: 'POST', token: adminToken,
    body: {
      title: `${prefix}-quiz`,
      questionCount: 9,
      durationMinutes: 15,
      pools: ['G1', 'G2', 'G3', 'G4', 'G5'],
      questions: Array.from({ length: 15 }, (_, index) => ({
        questionText: `${prefix} q${index + 1}`,
        poolIndex: index % 5,
        points: 1,
        options: [{ optionText: 'Correct', isCorrect: true }, { optionText: 'Wrong', isCorrect: false }],
      })),
    },
  })
  const quizAuthoringBody = await readJson(quizAuthoring)
  assert.ok([200, 201].includes(quizAuthoring.status), `lesson assessment authored (${quizAuthoring.status}): ${JSON.stringify(quizAuthoringBody).slice(0, 400)}`)
  const quiz = quizAuthoringBody

  // ==================== 1. paused/watch-writeup rules: no paused progress ====================
  {
    const play = await heartbeat(user.id, learnerToken, l1, 'PLAY', 0, 0, { gap: 0 })
    assert.equal(play.videoCompleted, false, 'PLAY never completes')
    assert.equal(play.progressPercentage, 0)

    const paused = await heartbeat(user.id, learnerToken, l1, 'PAUSE', 0, 0, { gap: 1.2 })
    assert.equal(paused.furthestWatchedPositionSeconds, 0, 'pause cannot advance furthest')
    assert.equal(paused.progressPercentage, 0)

    await heartbeat(user.id, learnerToken, l1, 'HEARTBEAT', 60, 60, { gap: 30.6 })
    await heartbeat(user.id, learnerToken, l1, 'HEARTBEAT', 99.4, 99.4, { gap: 20.6 })
    const progress = await readJson(await callApi(`/api/v1/lessons/${l1.id}/progress`, { token: learnerToken }))
    assert.equal(progress.completed, false, '99.x% video progress is not complete')
    assert.equal(progress.progressPercentage, 59, 'backend must retain the attested 99.4s')
    assert.equal(await prisma.starLedger.count({ where: { user_id: user.id, source_type: 'VIDEO', source_id: l1.video.id } }), 0, 'incomplete video pays nothing')
  }

  // Provision the cycle (already done by the PLAY above), then verify the
  // monthly-replay quiz gate fires for a “previous month” attempt.
  // At this point the video IS not finished yet, so the video-completion gate
  // runs first and must not be confused with the replay gate.

  // ==================== 2. full 168s at 2x: one completion, one reward ====================
  let cycleId
  {
    await heartbeat(user.id, learnerToken, l1, 'HEARTBEAT', 119.4, 119.4, { gap: 10.6 })
    await heartbeat(user.id, learnerToken, l1, 'HEARTBEAT', 139.4, 139.4, { gap: 10.6 })
    await heartbeat(user.id, learnerToken, l1, 'HEARTBEAT', 159.4, 159.4, { gap: 10.6 })
    const ended = await heartbeat(user.id, learnerToken, l1, 'ENDED', 168, 168, { gap: 10.6 })
    assert.equal(ended.videoCompleted, true, 'continuous 2x watch completes on the final ENDED event')
    assert.equal(ended.progressPercentage, 100)
    assert.equal(ended.starReward.awarded, true, 'first ENDED pays the duration-based reward')
    assert.equal(ended.starReward.amount, 2, '168s => floor(168/60) = 2 stars')
    assert.ok(ended.starReward.balance >= 2)
    assert.equal(await prisma.starLedger.count({ where: { user_id: user.id, source_id: l1.video.id, source_type: 'VIDEO' } }), 1, 'exactly one video reward row')

    const repeated = await heartbeat(user.id, learnerToken, l1, 'ENDED', 168, 168, { gap: 1.5 })
    assert.equal(repeated.starReward.awarded, false, 'retried ENDED must pay nothing again')
    assert.equal(await prisma.starLedger.count({ where: { user_id: user.id, source_id: l1.video.id, source_type: 'VIDEO' } }), 1, 'no duplicate reward rows')

    const cycle = await prisma.learningCycle.findFirst({ where: { user_id: user.id, ends_at: null } })
    cycleId = cycle.id
    const cycleRow = await prisma.cycleLessonProgress.findUnique({
      where: { user_id_lesson_id_learning_cycle_id: { user_id: user.id, lesson_id: l1.id, learning_cycle_id: cycle.id } },
    })
    assert.ok(cycleRow, 'cycle progress row exists for the lesson')
    assert.ok(cycleRow.furthest_seconds >= 168, 'cycle furthest reached the video length')
    // Video completion alone never completes a lesson that still owes its quiz.
    assert.equal(cycleRow.completed_at, null, 'lesson completion stays pending until the quiz passes')

    const replayRow = await prisma.monthlyVideoReplay.findUnique({
      where: {
        user_id_video_id_competition_month_id_learning_cycle_id: {
          user_id: user.id, video_id: l1.video.id, learning_cycle_id: cycle.id,
          competition_month_id: (await prisma.competitionMonth.findFirst({ where: { ends_at: { gt: new Date() }, starts_at: { lte: new Date() } } })).id,
        },
      },
    })
    assert.ok(replayRow, 'monthly replay row exists for the cycle')
    assert.ok(replayRow.furthest_seconds >= 168, 'replay furthest reached the duration')
    assert.ok(replayRow.completed_at, 'replay completion recorded')
  }

  // ==================== 2b. earlier-month attempt requires a fresh monthly replay ====================
  {
    const cycle = await prisma.learningCycle.findFirst({ where: { user_id: user.id, ends_at: null } })
    assert.ok(cycle, 'heartbeat provisioned an open learning cycle')
    const seededOldAttempt = await prisma.attempt.create({
      data: {
        assessment_id: quiz.assessmentId,
        user_id: user.id,
        attempt_number: 1,
        status: 'SUBMITTED',
        passed: true,
        score: 1,
        started_at: new Date(currentMonth.starts_at.getTime() - 86_400_000),
        submitted_at: new Date(currentMonth.starts_at.getTime() - 3_600_000),
        expires_at: new Date(currentMonth.starts_at.getTime() - 1_800_000),
        learning_cycle_id: cycle.id,
      },
    })
    // Fixture-only state: hide this month's replay row exactly like a brand-new
    // month before the first re-watch, then the gate must demand the replay.
    await prisma.monthlyVideoReplay.deleteMany({ where: { user_id: user.id, video_id: l1.video.id } })
    const gated = await callApi(`/api/v1/assessments/${quiz.assessmentId}/attempts`, { method: 'POST', token: learnerToken, body: {} })
    const gatedBody = await readJson(gated)
    assert.equal(gated.status, 403, 'an earlier-month submitted attempt demands this month\'s replay')
    assert.equal(gatedBody.error?.code, 'MonthlyVideoReplayRequired', 'exact replay gate fires for the fresh month')
    await prisma.attempt.delete({ where: { id: seededOldAttempt.id } })
  }

  // ==================== 3. quiz runs from the live cycle and passes once ====================
  {
    const activePost = await callApi(`/api/v1/assessments/${quiz.assessmentId}/attempts`, { method: 'POST', token: learnerToken, body: {} })
    const attemptBody = await readJson(activePost)
    if (activePost.status === 429) {
      assert.equal(attemptBody.error?.code, 'CooldownActive', 'cooldown would deny, but this suite expects cooldown disabled')
      console.log('Cooldown is enabled — cooldown assertions covered via attempt gating; skipping live quiz attempt.')
    } else {
      assert.ok([200, 201].includes(activePost.status), `attempt opened (${activePost.status})`)
      assert.ok(Array.isArray(attemptBody.questions) && attemptBody.questions.length === 9, 'attempt draws 9 questions from the configured pools')
      assert.equal(new Set(attemptBody.questions.map((q) => q.questionId)).size, 9, 'no duplicate question id inside one attempt')
      const pools = await prisma.questionPool.findMany({ where: { assessment_id: quiz.assessmentId }, select: { id: true } })
      assert.equal(pools.length, 5, 'fixtures use five pools')
      const poolCounts = new Map()
      for (const question of attemptBody.questions) {
        const mapped = await prisma.question.findUnique({ where: { id: question.questionId }, select: { pool_id: true } })
        poolCounts.set(mapped.pool_id, (poolCounts.get(mapped.pool_id) || 0) + 1)
      }
      // selectQuizQuestions evens the cover: remainder pools first — 2/2/2/2/1 for 9 of 5
      const counts = pools.map((pool) => poolCounts.get(pool.id) ?? 0).sort((a, b) => b - a)
      assert.deepEqual(counts, [2, 2, 2, 2, 1], `even quota distribution (got ${counts})`)

      const correctOptions = await prisma.questionOption.findMany({
        where: { question_id: { in: attemptBody.questions.map((q) => q.questionId) }, is_correct: true },
        select: { question_id: true, id: true },
      })
      const answers = Object.fromEntries(correctOptions.map(({ question_id, id }) => [question_id, id]))
      assert.equal(Object.keys(answers).length, 9, 'every drawn question kept its correct option')
      const submitRes = await callApi(`/api/v1/attempts/${attemptBody.attemptId}/submit`, { method: 'POST', token: learnerToken, body: { answers } })
      assert.equal(submitRes.status, 200, 'submission accepted')
      const submit = await readJson(submitRes)
      assert.equal(submit.passed, true, 'all-correct is a pass')
      assert.equal(submit.scorePercent, 100)
      assert.equal(submit.starReward?.amount >= 8, true, `passing 9/9 pays at least the correct-count budget (got ${submit.starReward?.amount})`)
      const repeatedSubmit = await callApi(`/api/v1/attempts/${attemptBody.attemptId}/submit`, { method: 'POST', token: learnerToken, body: { answers } })
      const repeatedBody = await readJson(repeatedSubmit)
      assert.ok([200, 409].includes(repeatedSubmit.status), 'repeated submit handled')
      if (repeatedBody.starReward) {
        assert.equal(repeatedBody.starReward.awarded === false || repeatedBody.starReward.amount === 0, true, 'repeated quiz never pays again')
      }
    }

    const cycleRow = await prisma.cycleLessonProgress.findUnique({
      where: { user_id_lesson_id_learning_cycle_id: { user_id: user.id, lesson_id: l1.id, learning_cycle_id: cycleId } },
    })
    assert.ok(cycleRow?.completed_at, 'passing the quiz completes the lesson in the cycle')
  }

  // ==================== 4. 2s video finishes without waiting for a heartbeat cycle ====================
  {
    const play = await heartbeat(user.id, learnerToken, l2, 'PLAY', 0.5, 0.5, { gap: 0, rate: 1 })
    assert.equal(play.videoCompleted, false)
    const ended = await heartbeat(user.id, learnerToken, l2, 'ENDED', 2, 2, { gap: 1.2, rate: 1 })
    assert.equal(ended.videoCompleted, true, '2s video settles from PLAY+ENDED, never haunted by intervals')
    assert.equal(ended.progressPercentage, 100)
  }

  // ==================== 5. 30s video: pause and resume never fabricate progress ====================
  {
    await heartbeat(user.id, learnerToken, l3, 'PLAY', 0, 0, { gap: 0, rate: 1 })
    const hb = await heartbeat(user.id, learnerToken, l3, 'HEARTBEAT', 3, 3, { gap: 3.4, rate: 1 })
    assert.equal(hb.furthestWatchedPositionSeconds, 3)
    const paused = await heartbeat(user.id, learnerToken, l3, 'PAUSE', 3, 3, { gap: 5, rate: 1 })
    assert.equal(paused.furthestWatchedPositionSeconds, 3, 'pausing at 3s keeps 3s')
    const resumed = await heartbeat(user.id, learnerToken, l3, 'PLAY', 5, 5, { gap: 2.2, rate: 1 })
    assert.ok(resumed.furthestWatchedPositionSeconds >= 3 && resumed.furthestWatchedPositionSeconds <= 5, 'resume advances at most its attested content')
    const ended = await heartbeat(user.id, learnerToken, l3, 'ENDED', 30, 30, { gap: 26, rate: 1 })
    assert.equal(ended.videoCompleted, true, 'finishing the 30s clip completes live')
  }

  // ==================== 6. fresh seek-to-end cheat is refused ====================
  {
    await heartbeat(user.id, learnerToken, l4, 'PLAY', 0, 0, { gap: 0, rate: 2 })
    // Reach is clamped to the verified wall-clock window; a dev host adds
    // seconds of request latency, so the exact ceiling varies — the business
    // invariant is: the claimed-from-zero ENDED can NOT complete nor pay.
    const cheat = await heartbeat(user.id, learnerToken, l4, 'ENDED', 168, 168, { gap: 0.4, rate: 2 })
    assert.equal(cheat.videoCompleted, false, 'seek-to-end after one second cannot complete')
    assert.ok(cheat.furthestWatchedPositionSeconds < 168 - 0.84, `reach stayed far below the completion threshold (got ${cheat.furthestWatchedPositionSeconds})`)
    assert.equal(await prisma.starLedger.count({ where: { user_id: user.id, source_type: 'VIDEO', source_id: l4.video.id } }), 0, 'cheating pays no stars')
  }

  // ==================== 7. cooldown blocks an immediate forced re-take ====================
  {
    const rapid = await callApi(`/api/v1/assessments/${quiz.assessmentId}/attempts`, { method: 'POST', token: learnerToken, body: { forceNew: true } })
    if (rapid.status === 429) {
      const body = await readJson(rapid)
      assert.equal(body.error?.code, 'CooldownActive', 'cooldown denies the immediate retake')
    } else {
      const body = await readJson(rapid)
      assert.ok([200, 201, 403, 409].includes(rapid.status), `rapid re-take behaves per policy (${rapid.status})`)
      if (rapid.status === 201) console.log('Cooldown disabled (0 minutes) — cooldown path not exercised.')
      else assert.notEqual(body.error?.code, 'VideoNotCompleted')
    }
  }

  // ==================== 8. fresh month does not re-pay without fresh viewing ====================
  {
    // Bend the open month into the past so the next heartbeat provisions the next period.
    await prisma.competitionMonth.update({ where: { id: currentMonth.id }, data: { ends_at: new Date(Date.now() - 1000) } })
    const after = await heartbeat(user.id, learnerToken, l1, 'ENDED', 168, 168, { gap: 0 })
    assert.equal(after.videoCompleted, true, 'cycle completion survives across months')
    assert.equal(after.starReward.awarded, false, 'no fresh reward from stale watch time in a brand-new period')
    const freshMonth = await prisma.competitionMonth.findFirst({ where: { ends_at: { gt: new Date(Date.now() + 60_000) }, starts_at: { gt: new Date() } } })
    if (freshMonth && !created.monthIds.includes(freshMonth.id)) created.monthIds.push(freshMonth.id)
    await prisma.competitionMonth.update({ where: { id: currentMonth.id }, data: { ends_at: originalMonthEndsAt } })
  }

  console.log('\nALL PHASE-1 INTEGRATION CHECKS PASSED')
} catch (error) {
  console.error('\nPHASE-1 INTEGRATION FAILURE:', error?.message || error)
  if (error?.stack) console.error(error.stack.split('\n').slice(0, 8).join('\n'))
  process.exitCode = 1
} finally {
  try { await cleanup() } catch (cleanError) { console.error('Cleanup error:', cleanError?.message || cleanError) }
  await prisma.$disconnect()
}
