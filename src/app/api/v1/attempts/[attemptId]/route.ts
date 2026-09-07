import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: { attemptId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const attempt = await prisma.attempt.findUnique({ where: { id: params.attemptId } })
  if (!attempt) return NextResponse.json({ error: { code: 'AttemptNotFound' } }, { status: 404 })
  if (attempt.user_id !== (auth as any).context!.userId) return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })

  const status = attempt.status
  if (status !== 'SUBMITTED' && status !== 'AUTO_SUBMITTED') return NextResponse.json({ error: { code: 'AttemptNotSubmitted', message: 'Chưa nộp bài' } }, { status: 400 })

  const answers = await prisma.attemptAnswer.findMany({
    where: { attempt_id: params.attemptId },
    include: { question: true, selected_option: true },
  })

  const passed = attempt.passed || false

  const answerResults = await Promise.all(
    answers.map(async (ans) => {
      const isCorrect = ans.is_correct || (ans.selected_option?.is_correct || false)
      return {
        questionId: ans.question_id,
        isCorrect,
        selectedOptionId: ans.selected_option_id,
        ...(passed ? {
          correctOptionId: (await prisma.questionOption.findFirst({ where: { question_id: ans.question_id, is_correct: true } }))?.id || null,
          explanation: ans.question.explanation || null,
        } : {}),
      }
    })
  )

  return NextResponse.json({
    attemptId: attempt.id,
    score: attempt.score ? Number(attempt.score) * 100 : 0,
    passed,
    answers: answerResults,
  })
}

/**
 * DELETE /api/v1/attempts/{attemptId}
 * Cancel an in-progress attempt (BR-04: không tính vào lịch sử điểm, sau 24h mới được làm lại)
 */
export async function DELETE(request: NextRequest, { params }: { params: { attemptId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const attempt = await prisma.attempt.findUnique({ where: { id: params.attemptId } })
  if (!attempt) return NextResponse.json({ error: { code: 'AttemptNotFound' } }, { status: 404 })
  if (attempt.user_id !== (auth as any).context!.userId) return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  if (attempt.status !== 'IN_PROGRESS') return NextResponse.json({ error: { code: 'AttemptNotInProgress', message: 'Chỉ có thể hủy bài đang trong tiến trình' } }, { status: 400 })

  const updated = await prisma.attempt.update({
    where: { id: params.attemptId },
    data: {
      status: 'CANCELLED',
      submitted_at: new Date(),
    },
  })

  return NextResponse.json({
    attemptId: updated.id,
    status: 'CANCELLED',
    message: 'Đã hủy bài làm thành công. Bạn cần đợi 24 giờ để bắt đầu lượt mới.',
  }, { status: 200 })
}

