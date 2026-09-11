import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/v1/assessments/{assessmentId}/attempts
 * Start attempt — BR-04 rules
 */
export async function POST(request: NextRequest, { params }: { params: { assessmentId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const role = (auth as any).context!.role
  const userId = (auth as any).context!.userId
  const assessmentId = params.assessmentId

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || user.status !== 'ACTIVE') {
    return NextResponse.json({ error: { code: 'AccountInactive', message: 'Tài khoản phải Active' } }, { status: 403 })
  }

  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      lesson_id: true,
      lesson: {
        select: {
          id: true,
          video: { select: { duration_seconds: true } },
        },
      },
    },
  })
  if (!assessment) return NextResponse.json({ error: { code: 'AssessmentNotFound' } }, { status: 404 })

  // For members, verify video of this lesson has been watched
  if (role === 'MEMBER') {
    const prog = await prisma.lessonProgress.findUnique({
      where: {
        user_id_lesson_id: {
          user_id: userId,
          lesson_id: assessment.lesson_id,
        },
      },
    })
    const videoDuration = assessment.lesson.video?.duration_seconds || 0
    const furthest = prog?.furthest_watched_position_seconds || 0
    const watchedEnough = prog?.completed || (videoDuration > 0 && furthest >= videoDuration * 0.8) || videoDuration === 0
    if (!watchedEnough) {
      return NextResponse.json({
        error: { code: 'VideoNotWatched', message: 'Bạn cần xem video bài giảng trước khi làm bài kiểm tra' },
      }, { status: 403 })
    }
  }

  // Check if attempt already in progress
  const active = await prisma.attempt.findFirst({
    where: { assessment_id: assessmentId, user_id: userId, status: 'IN_PROGRESS' },
  })
  if (active) {
    // If not expired, return active attempt questions
    if (new Date() < active.expires_at) {
      const activeQuestions = await prisma.attemptQuestion.findMany({
        where: { attempt_id: active.id },
        include: { question: { include: { options: true } } },
        orderBy: { display_order: 'asc' },
      })

      return NextResponse.json({
        attemptId: active.id,
        id: active.id,
        attemptNumber: active.attempt_number,
        expiresAt: active.expires_at,
        questions: activeQuestions.map((aq) => ({
          questionId: aq.question.id,
          id: aq.question.id,
          questionText: aq.question.question_text,
          points: aq.question.points,
          options: aq.question.options.map((o) => ({
            optionId: o.id,
            id: o.id,
            optionText: o.option_text,
          })),
        })),
      }, { status: 200 })
    }
  }

  const questions = await prisma.question.findMany({
    where: { assessment_id: assessmentId },
    include: { options: true },
    orderBy: { sort_order: 'asc' },
  })
  if (questions.length === 0) {
    return NextResponse.json({ error: { code: 'AssessmentNotFound', message: 'Assessment chưa có câu hỏi' } }, { status: 404 })
  }

  const expiresAt = new Date(Date.now() + Math.max(5, questions.length * 2) * 60 * 1000)

  const attempt = await prisma.$transaction(async (tx) => {
    const a = await tx.attempt.create({
      data: {
        assessment_id: assessmentId,
        user_id: userId,
        status: 'IN_PROGRESS',
        started_at: new Date(),
        expires_at: expiresAt,
        attempt_number: (await tx.attempt.count({ where: { assessment_id: assessmentId, user_id: userId } })) + 1,
      },
    })

    const shuffledQuestions = [...questions].sort(() => Math.random() - 0.5)
    await tx.attemptQuestion.createMany({
      data: shuffledQuestions.map((q, idx) => ({
        attempt_id: a.id,
        question_id: q.id,
        display_order: idx,
      })),
    })

    return a
  })

  const shuffledQs = [...questions].sort(() => Math.random() - 0.5).map((q) => ({
    questionId: q.id,
    id: q.id,
    questionText: q.question_text,
    points: q.points,
    options: [...q.options].sort(() => Math.random() - 0.5).map((o) => ({
      optionId: o.id,
      id: o.id,
      optionText: o.option_text,
    })),
  }))

  return NextResponse.json({
    attemptId: attempt.id,
    id: attempt.id,
    attemptNumber: attempt.attempt_number,
    expiresAt: attempt.expires_at,
    questions: shuffledQs,
  }, { status: 201 })
}
