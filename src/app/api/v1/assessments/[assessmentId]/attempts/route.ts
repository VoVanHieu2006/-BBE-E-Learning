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
      course: {
        select: {
          sessions: {
            select: {
              lessons: { select: { id: true } },
            },
          },
        },
      },
    },
  })
  if (!assessment) return NextResponse.json({ error: { code: 'AssessmentNotFound' } }, { status: 404 })

  // For members, verify all lessons are completed
  if (role === 'MEMBER') {
    const allLessonIds = assessment.course.sessions.flatMap((s) => s.lessons.map((l) => l.id))
    if (allLessonIds.length > 0) {
      const completed = await prisma.lessonProgress.findMany({
        where: { user_id: userId, lesson_id: { in: allLessonIds }, completed: true },
        select: { id: true },
      })
      if (completed.length < allLessonIds.length) {
        return NextResponse.json({ error: { code: 'LessonsNotCompleted', message: 'Chưa hoàn thành tất cả bài học' } }, { status: 403 })
      }
    }

    // 24h cooldown check (BR-04: applies to SUBMITTED, AUTO_SUBMITTED, and CANCELLED)
    const lastSubmitted = await prisma.attempt.findFirst({
      where: { assessment_id: assessmentId, user_id: userId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED', 'CANCELLED'] } },
      orderBy: { submitted_at: 'desc' },
      select: { score: true, submitted_at: true },
    })
    if (lastSubmitted && lastSubmitted.submitted_at) {
      const hours = (Date.now() - lastSubmitted.submitted_at.getTime()) / (1000 * 60 * 60)
      if (hours < 24) {
        const scoreVal = lastSubmitted.score != null ? Number(lastSubmitted.score) : 0
        const perfect = scoreVal >= 1 || scoreVal >= 100
        if (!perfect) {
          return NextResponse.json({ error: { code: 'CooldownActive', message: 'Còn thời gian chờ 24h kể từ lần nộp/hủy gần nhất' } }, { status: 403 })
        }
      }
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
