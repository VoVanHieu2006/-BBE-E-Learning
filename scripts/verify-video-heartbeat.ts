/**
 * Real database verification of the server-side heartbeat rule.
 * It deliberately manipulates only a disposable test user and cleans up.
 */
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/prisma'
import { recordVideoHeartbeat } from '../src/lib/video-heartbeat'

const HOUR = 3_600_000
const TEST_EMAILS = ['heartbeat-2x@test.local', 'heartbeat-1x@test.local', 'heartbeat-seek@test.local']

async function cleanup(email: string) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (!user) return
  await prisma.starLedger.deleteMany({ where: { user_id: user.id } })
  await prisma.monthlyVideoReplay.deleteMany({ where: { user_id: user.id } })
  await prisma.quizRewardHighWaterMark.deleteMany({ where: { user_id: user.id } })
  await prisma.cycleLessonProgress.deleteMany({ where: { user_id: user.id } })
  await prisma.lessonProgress.deleteMany({ where: { user_id: user.id } })
  await prisma.attempt.deleteMany({ where: { user_id: user.id } })
  await prisma.learningPath.deleteMany({ where: { user_id: user.id } })
  await prisma.learningCycle.deleteMany({ where: { user_id: user.id } })
  await prisma.accountStateInterval.deleteMany({ where: { user_id: user.id } })
  await prisma.user.delete({ where: { id: user.id } })
}

async function firstLesson() {
  const course = await prisma.course.findFirst({
    where: { status: 'PUBLISHED', sessions: { some: { lessons: { some: { video: { isNot: null } } } } } },
    include: { sessions: { orderBy: { sort_order: 'asc' }, include: { lessons: { orderBy: { sort_order: 'asc' }, include: { video: true } } } } },
    orderBy: { created_at: 'asc' },
  })
  const lesson = course?.sessions[0]?.lessons[0]
  if (!lesson?.video) throw new Error('No published lesson with video')
  return lesson
}

async function run(rate: number, email: string) {
  await cleanup(email)
  const lesson = await firstLesson()
  const user = await prisma.user.create({ data: { email, display_name: `Heartbeat ${rate}x`, role: 'MEMBER' as const, status: 'ACTIVE' as const, password_hash: 'test' } })
  const duration = lesson.video!.duration_seconds
  const step = 10 * rate
  let position = 0
  let last: any = null
  const session = `verify-${rate}x-${Date.now()}`
  last = await recordVideoHeartbeat(user.id, lesson.id, 0, 0, false, session, { playbackRate: rate, event: 'PLAY' })
  for (let i = 0; i < Math.ceil(duration / step) + 2; i++) {
    position = Math.min(duration, position + step)
    await prisma.monthlyVideoReplay.updateMany({
      where: { user_id: user.id },
      data: { last_heartbeat_at: new Date(Date.now() - 10_000) },
    })
    last = await recordVideoHeartbeat(user.id, lesson.id, position, position, false, session, {
      playbackRate: rate,
      event: position >= duration ? 'ENDED' : 'HEARTBEAT',
    })
    if (last?.replay?.completed) break
  }
  assert.ok(last?.replay?.completed, `${rate}x should complete the video`)
  assert.ok(last?.starReward?.awarded, `${rate}x should award a Star`)
  const starCount = await prisma.starLedger.count({ where: { user_id: user.id } })
  const replay = await prisma.monthlyVideoReplay.findFirst({ where: { user_id: user.id } })
  assert.equal(starCount, 1)
  assert.ok(replay?.completed_at)
  // Duplicate heartbeat must not pay again.
  const duplicate = await recordVideoHeartbeat(user.id, lesson.id, duration, duration, false, session, { playbackRate: rate, event: 'ENDED' })
  assert.equal(duplicate?.starReward?.awarded, false)
  assert.equal(await prisma.starLedger.count({ where: { user_id: user.id } }), 1)
  await cleanup(email)
  return { rate, duration, watched: last.replay.watchedSeconds, star: last.starReward.amount, duplicateAwarded: duplicate?.starReward?.awarded }
}

async function runSeekCheat() {
  const email = 'heartbeat-seek@test.local'
  await cleanup(email)
  const lesson = await firstLesson()
  const user = await prisma.user.create({ data: { email, display_name: 'Seek Cheat', role: 'MEMBER' as const, status: 'ACTIVE' as const, password_hash: 'test' } })
  const session = `seek-${Date.now()}`
  await recordVideoHeartbeat(user.id, lesson.id, 0, 0, false, session, { playbackRate: 2, event: 'PLAY' })
  await prisma.monthlyVideoReplay.updateMany({ where: { user_id: user.id }, data: { last_heartbeat_at: new Date(Date.now() - 10_000) } })
  const result = await recordVideoHeartbeat(user.id, lesson.id, lesson.video.duration_seconds, lesson.video.duration_seconds, false, session, { playbackRate: 2, event: 'ENDED' })
  assert.equal(result?.replay?.completed, false)
  assert.equal(result?.starReward?.awarded, false)
  await cleanup(email)
  return { watched: result?.replay?.watchedSeconds, completed: result?.replay?.completed }
}

async function main() {
  for (const email of TEST_EMAILS) await cleanup(email)
  const twoX = await run(2, 'heartbeat-2x@test.local')
  const oneX = await run(1, 'heartbeat-1x@test.local')
  const seek = await runSeekCheat()
  console.log(JSON.stringify({ twoX, oneX, seek }, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
