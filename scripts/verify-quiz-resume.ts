import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/prisma'

const BASE = 'http://127.0.0.1:3001'
const EMAIL = 'quizresume@test.local'
const PASSWORD = 'Bbe@123456'
const LESSON_ID = '7dc02b5b-c390-4b1d-a6e4-03c00be11d95'
const ASSESSMENT_ID = '855b9cbc-3155-40e2-b3cd-79ee98fa6920'

async function cleanup() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } })
  if (!user) return
  await prisma.attempt.deleteMany({ where: { user_id: user.id } })
  await prisma.quizRewardHighWaterMark.deleteMany({ where: { user_id: user.id } })
  await prisma.starLedger.deleteMany({ where: { user_id: user.id } })
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
  const user = await prisma.user.create({ data: { email: EMAIL, display_name: 'Quiz Resume Verify', role: 'MEMBER', status: 'ACTIVE', password_hash: await bcrypt.hash(PASSWORD, 10) } })
  const unit = await prisma.organizationUnit.findFirstOrThrow({ where: { type: 'DEPARTMENT' } })
  await prisma.organizationMembership.create({ data: { user_id: user.id, unit_id: unit.id } })
  const cycle = await prisma.learningCycle.create({ data: { user_id: user.id, trigger_key: `quizresume:${user.id}`, starts_at: new Date('2026-09-01T00:00:00Z'), provenance: 'LEGACY' } })
  await prisma.learningPath.create({ data: { user_id: user.id, learning_cycle_id: cycle.id, starts_at: new Date('2026-09-01T00:00:00Z') } })
  await prisma.lessonProgress.create({ data: { user_id: user.id, lesson_id: LESSON_ID, completed: false, furthest_watched_position_seconds: lesson.video!.duration_seconds, last_position_seconds: lesson.video!.duration_seconds, last_watched_at: new Date() } })
  await prisma.cycleLessonProgress.create({ data: { user_id: user.id, lesson_id: LESSON_ID, learning_cycle_id: cycle.id, furthest_seconds: lesson.video!.duration_seconds, provenance: 'LEGACY' } })

  const login = await fetch(`${BASE}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })
  const token = (await login.json()).accessToken
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const first = await (await fetch(`${BASE}/api/v1/assessments/${ASSESSMENT_ID}/attempts`, { method: 'POST', headers, body: JSON.stringify({ forceNew: true }) })).json()
  const resume = await (await fetch(`${BASE}/api/v1/assessments/${ASSESSMENT_ID}/attempts`, { method: 'POST', headers, body: JSON.stringify({ forceNew: false }) })).json()
  const shape = (data: any) => ({
    attemptId: data.attemptId,
    questions: (data.questions || []).map((q: any) => [q.questionId, ...(q.options || []).map((o: any) => o.optionId)]),
  })
  const a = shape(first)
  const b = shape(resume)
  console.log(JSON.stringify({
    firstStatus: first.attemptId ? 201 : first,
    resumed: resume.isResumed,
    sameAttempt: a.attemptId === b.attemptId,
    sameQuestionOrder: JSON.stringify(a.questions.map((row: any) => row[0])) === JSON.stringify(b.questions.map((row: any) => row[0])),
    sameOptionOrder: JSON.stringify(a.questions) === JSON.stringify(b.questions),
    questionCount: resume.questionCount,
    durationMinutes: resume.durationMinutes,
    expiresAt: resume.expiresAt,
  }, null, 2))
  if (a.attemptId) await fetch(`${BASE}/api/v1/attempts/${a.attemptId}/cancel`, { method: 'POST', headers, body: '{}' })
  await cleanup()
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
