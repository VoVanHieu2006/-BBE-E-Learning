import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { QUIZ_COOLDOWN_MS, QUIZ_COOLDOWN_HOURS } from '@/lib/config/quiz'

/**
 * POST /api/v1/attempts/[attemptId]/cancel
 * Hủy lượt làm bài đang tiến hành (status -> CANCELLED).
 * Không tính điểm, kích hoạt thời gian chờ Cooldown (mặc định 24h).
 */
export async function POST(request: NextRequest, { params }: { params: { attemptId: string } }) {
  const auth = await authenticate(request)
  const userId = auth.ok ? (auth as any).context?.userId : null

  const attempt = await prisma.attempt.findUnique({
    where: { id: params.attemptId },
    select: { id: true, user_id: true, status: true, assessment_id: true },
  })

  if (!attempt) {
    return NextResponse.json({ error: { code: 'AttemptNotFound', message: 'Lượt làm bài không tồn tại' } }, { status: 404 })
  }

  // Nếu có xác thực, kiểm tra quyền sở hữu bài thi
  if (userId && attempt.user_id !== userId) {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Bạn không có quyền hủy bài thi này' } }, { status: 403 })
  }

  const now = new Date()

  // Cập nhật status thành CANCELLED và đặt submitted_at để làm mốc tính cooldown
  if (attempt.status === 'IN_PROGRESS') {
    await prisma.attempt.update({
      where: { id: params.attemptId },
      data: {
        status: 'CANCELLED',
        submitted_at: now,
        score: null,
        passed: null,
      },
    })
  }

  return NextResponse.json({
    success: true,
    message: `Đã hủy bài kiểm tra. Bạn cần đợi ${QUIZ_COOLDOWN_HOURS} giờ mới có thể làm lại.`,
    status: 'CANCELLED',
    cancelledAt: now.toISOString(),
    cooldownHours: QUIZ_COOLDOWN_HOURS,
    cooldownUntil: new Date(now.getTime() + QUIZ_COOLDOWN_MS).toISOString(),
  })
}
