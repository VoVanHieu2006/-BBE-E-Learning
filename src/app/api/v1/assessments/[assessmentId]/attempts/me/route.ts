import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { QUIZ_COOLDOWN_MS, QUIZ_COOLDOWN_HOURS } from '@/lib/config/quiz'

export async function GET(request: NextRequest, { params }: { params: { assessmentId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'MEMBER') return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })

  const userId = (auth as any).context!.userId

  // Tự động chuyển các bài IN_PROGRESS đã hết hạn sang CANCELLED
  await prisma.attempt.updateMany({
    where: {
      assessment_id: params.assessmentId,
      user_id: userId,
      status: 'IN_PROGRESS',
      expires_at: { lt: new Date() },
    },
    data: {
      status: 'CANCELLED',
      submitted_at: new Date(),
    },
  })

  const attempts: any[] = await prisma.attempt.findMany({
    where: { assessment_id: params.assessmentId, user_id: userId },
    orderBy: { started_at: 'desc' },
    select: { id: true, attempt_number: true, status: true, score: true, passed: true, submitted_at: true, created_at: true },
  })

  // Tính thời gian Cooldown từ lượt làm bài gần nhất (Nộp hoặc Hủy)
  let cooldownUntil: string | null = null
  let remainingMs = 0

  if (QUIZ_COOLDOWN_MS > 0) {
    const lastAttempt = attempts.find((a) =>
      a.status === 'SUBMITTED' || a.status === 'AUTO_SUBMITTED' || a.status === 'CANCELLED'
    )
    if (lastAttempt) {
      const lastTime = lastAttempt.submitted_at || lastAttempt.created_at
      const elapsed = Date.now() - new Date(lastTime).getTime()
      if (elapsed < QUIZ_COOLDOWN_MS) {
        remainingMs = QUIZ_COOLDOWN_MS - elapsed
        cooldownUntil = new Date(Date.now() + remainingMs).toISOString()
      }
    }
  }

  return NextResponse.json({
    cooldownHours: QUIZ_COOLDOWN_HOURS,
    cooldownUntil,
    remainingMs,
    items: attempts.map((a: any) => ({
      attemptId: a.id,
      attemptNumber: a.attempt_number,
      status: a.status,
      score: a.score ? Number(a.score) * 100 : null,
      passed: a.passed,
      submittedAt: a.submitted_at || a.created_at,
    })),
  })
}
