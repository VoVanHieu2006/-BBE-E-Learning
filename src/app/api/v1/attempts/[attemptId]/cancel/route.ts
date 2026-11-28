import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { lockLearningUser } from '@/lib/learning-periods'
import { QUIZ_COOLDOWN_MS, QUIZ_COOLDOWN_MINUTES } from '@/lib/config/quiz'

/**
 * POST /api/v1/attempts/[attemptId]/cancel
 * Hủy lượt làm bài đang tiến hành (status -> CANCELLED).
 * Không tính điểm, kích hoạt thời gian chờ Cooldown (mặc định 24h).
 */
export async function POST(request: NextRequest, { params }: { params: { attemptId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const userId = (auth as any).context!.userId

  return prisma.$transaction(async (tx) => {
    // Match submitQuiz: user first, then attempt. Read state only after both locks.
    await lockLearningUser(tx, userId)
    await tx.$queryRaw`SELECT id FROM attempts WHERE id = ${params.attemptId}::uuid FOR UPDATE`
    const attempt = await tx.attempt.findUnique({
      where: { id: params.attemptId },
      select: { id: true, user_id: true, status: true, submitted_at: true },
    })

    if (!attempt) {
      return NextResponse.json({ error: { code: 'AttemptNotFound', message: 'Lượt làm bài không tồn tại' } }, { status: 404 })
    }

    // Nếu có xác thực, kiểm tra quyền sở hữu bài thi
    if (attempt.user_id !== userId) {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'Bạn không có quyền hủy bài thi này' } }, { status: 403 })
    }

    if (attempt.status !== 'IN_PROGRESS' && attempt.status !== 'CANCELLED') {
      return NextResponse.json({ error: { code: 'AttemptAlreadySubmitted', message: 'Lượt làm bài đã được nộp, không thể hủy.' }, status: attempt.status }, { status: 409 })
    }

    const now = attempt.status === 'CANCELLED' && attempt.submitted_at ? attempt.submitted_at : new Date()

    // Cập nhật status thành CANCELLED và đặt submitted_at để làm mốc tính cooldown
    if (attempt.status === 'IN_PROGRESS') {
      const updated = await tx.attempt.updateMany({
        where: { id: params.attemptId, user_id: userId, status: 'IN_PROGRESS' },
        data: {
          status: 'CANCELLED',
          submitted_at: now,
          score: null,
          passed: null,
        },
      })
      if (updated.count === 0) {
        return NextResponse.json({ error: { code: 'AttemptNotInProgress', message: 'Lượt làm bài không còn trong tiến trình.' } }, { status: 409 })
      }
    }

    return NextResponse.json({
      success: true,
      message: `Đã hủy bài kiểm tra. Bạn cần đợi ${QUIZ_COOLDOWN_MINUTES} phút mới có thể làm lại.`,
      status: 'CANCELLED',
      cancelledAt: now.toISOString(),
      cooldownMinutes: QUIZ_COOLDOWN_MINUTES,
      cooldownUntil: new Date(now.getTime() + QUIZ_COOLDOWN_MS).toISOString(),
    })
  }, { timeout: 30_000 })
}
