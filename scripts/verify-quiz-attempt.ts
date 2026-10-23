import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/prisma'

const BASE = 'http://127.0.0.1:3001'
const EMAIL = 'quizcheck@test.local'
const PASSWORD = 'Bbe@123456'
const LESSON_ID = '7dc02b5b-c390-4b1d-a6e4-03c00be11d95'
const ASSESSMENT_ID = '855b9cbc-3155-40e2-b3cd-79ee98fa6920'

async function cleanup() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } })
  if (!user) return
  await prisma.attempt.deleteMany({ where: { user_id: user.id } })
  await prisma.quizRewardHighWaterMark.deleteMany({ where: { user_id: user.id } })
  await prisma.starLedger.deleteMany({ where: { user_id: user.id } })
  await prisma.monthlyVideoReplay.deleteMany({ where: { user_id: user.id } })
  await prisma.cycleLessonProgress.deleteMany({ where: { user_id: user.id } })
  await prisma.lessonProgress.deleteMany({ where: { user_id: user.id } })
  await prisma.learningPath.deleteMany({ where: { user_id: user.id } })
  await prisma.learningCycle.deleteMany({ where: { user_id: user.id } })
  await prisma.organizationMembership.deleteMany({ where: { user_id: user.id } })
  await prisma.accountStateInterval.deleteMany({ where: { user_id: user.id } })
  await prisma.user.delete({ where: { id: user.id } })
}

async function main() {
  await cleanup()
  const lesson = await prisma.lesson.findUniqueOrThrow({ where: { id: LESSON_ID }, include: { video: true } })
  if (!lesson.video) throw new Error('Lesson video missing')
  const hash = await bcrypt.hash(PASSWORD, 10)
  const user = await prisma.user.create({
    data: { email: EMAIL, display_name: 'Quiz Count Verify', role: 'MEMBER', status: 'ACTIVE', password_hash: hash },
  })
  const unit = await prisma.organizationUnit.findFirstOrThrow({ where: { type: 'DEPARTMENT' } })
  await prisma.organizationMembership.create({ data: { user_id: user.id, unit_id: unit.id } })
  if (!await prisma.accountStateInterval.findFirst({ where: { user_id: user.id, ends_at: null } })) {
    await prisma.accountStateInterval.create({ data: { user_id: user.id, role: 'MEMBER', status: 'ACTIVE', starts_at: new Date('2026-09-01T00:00:00Z') } })
  }
  const cycle = await prisma.learningCycle.create({
    data: { user_id: user.id, trigger_key: `quizcheck:${user.id}`, starts_at: new Date('2026-09-01T00:00:00Z'), provenance: 'LEGACY' },
  })
  await prisma.learningPath.create({ data: { user_id: user.id, learning_cycle_id: cycle.id, starts_at: new Date('2026-09-01T00:00:00Z') } })
  const now = new Date()
  await prisma.lessonProgress.create({
    data: { user_id: user.id, lesson_id: LESSON_ID, completed: false, furthest_watched_position_seconds: lesson.video.duration_seconds, last_position_seconds: lesson.video.duration_seconds, last_watched_at: now },
  })
  await prisma.cycleLessonProgress.create({
    data: { user_id: user.id, lesson_id: LESSON_ID, learning_cycle_id: cycle.id, furthest_seconds: lesson.video.duration_seconds, provenance: 'LEGACY' },
  })

  const login = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const loginData = await login.json()
  if (!login.ok) throw new Error(`Login failed: ${login.status} ${JSON.stringify(loginData)}`)
  const headers = { Authorization: `Bearer ${loginData.accessToken}`, 'content-type': 'application/json' }
  const started = Date.now()
  const response = await fetch(`${BASE}/api/v1/assessments/${ASSESSMENT_ID}/attempts`, {
    method: 'POST', headers, body: JSON.stringify({ forceNew: true }),
  })
  const data = await response.json()
  console.log(JSON.stringify({
    status: response.status,
    elapsedMs: Date.now() - started,
    questionCount: data.questionCount,
    questionsReturned: data.questions?.length,
    durationMinutes: data.durationMinutes,
    expiresInSeconds: data.expiresAt ? Math.round((new Date(data.expiresAt).getTime() - Date.now()) / 1000) : null,
    error: data.error,
  }, null, 2))
  if (data.attemptId) {
    const cancel = await fetch(`${BASE}/api/v1/attempts/${data.attemptId}/cancel`, { method: 'POST', headers, body: '{}' })
    console.log('cancelStatus', cancel.status)
  }
  await cleanup()
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
