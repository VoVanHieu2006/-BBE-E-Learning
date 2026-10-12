import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkCourseFinalProgression, checkLessonProgression } from '@/lib/progression'
import { hasWatchedFullVideo } from '@/lib/video-progress-rules'
import { selectQuizQuestions } from '@/lib/quiz-pool-selection'
import { randomInt } from 'crypto'

function shuffleSecurely<T>(items: readonly T[]): T[] {
  const shuffled = [...items]
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = randomInt(index + 1)
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }
  return shuffled
}

/**
 * POST /api/v1/assessments/{assessmentId}/attempts
 * Start attempt — BR-04 rules
 */
export async function POST(request: NextRequest, { params }: { params: { assessmentId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

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
      type: true,
      lesson_id: true,
      course_id: true,
      lesson: {
        select: {
          id: true,
          video: { select: { duration_seconds: true } },
        },
      },
    },
  })
  if (!assessment) return NextResponse.json({ error: { code: 'AssessmentNotFound' } }, { status: 404 })

  const isAdmin = (auth as any).context!.role === 'ADMIN'
  const gate = assessment.type === 'COURSE_FINAL' && assessment.course_id
    ? await checkCourseFinalProgression(userId, assessment.course_id, isAdmin)
    : assessment.lesson_id
      ? await checkLessonProgression(userId, assessment.lesson_id, 'ASSESS', isAdmin)
      : { ok: false as const, code: 'InvalidAssessmentOwner', message: 'Assessment owner is missing.' }
  if (gate.ok === false) return NextResponse.json({ error: { code: gate.code, message: gate.message } }, { status: 403 })

  if (assessment.type === 'COURSE_FINAL') {
    const alreadyPassed = await prisma.attempt.findFirst({
      where: { assessment_id: assessmentId, user_id: userId, passed: true, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
      select: { id: true },
    })
    if (alreadyPassed) return NextResponse.json({ error: { code: 'AssessmentAlreadyPassed', message: 'Bạn đã đạt bài thi cuối khóa này.' } }, { status: 409 })
  }

  // No staff bypass: everyone must complete the prerequisite video.
  if (assessment.lesson_id && assessment.lesson) {
    const prog = await prisma.lessonProgress.findUnique({
      where: {
        user_id_lesson_id: {
          user_id: userId,
          lesson_id: assessment.lesson_id,
        },
      },
    })
    const video = assessment.lesson.video
    const furthest = prog?.furthest_watched_position_seconds || 0
    const watchedEnough = !video || hasWatchedFullVideo(furthest, video.duration_seconds)
    if (!watchedEnough) {
      return NextResponse.json({
      error: { code: 'VideoNotCompleted', message: 'Bạn cần xem hoàn tất 100% video bài giảng trước khi làm bài kiểm tra' },
      }, { status: 403 })
    }
  }

  // 1. Kiểm tra Cooldown: Mỗi lần làm (dù nộp hay hủy) cần đợi khoảng thời gian quy định
  const { QUIZ_COOLDOWN_MS, QUIZ_COOLDOWN_HOURS } = await import('@/lib/config/quiz')
  if (QUIZ_COOLDOWN_MS > 0) {
    const lastAttempt = await prisma.attempt.findFirst({
      where: {
        assessment_id: assessmentId,
        user_id: userId,
        status: { in: ['SUBMITTED', 'AUTO_SUBMITTED', 'CANCELLED'] },
      },
      orderBy: { submitted_at: 'desc' },
      select: { submitted_at: true, created_at: true },
    })

    if (lastAttempt) {
      const lastTime = lastAttempt.submitted_at || lastAttempt.created_at
      const elapsed = Date.now() - new Date(lastTime).getTime()
      if (elapsed < QUIZ_COOLDOWN_MS) {
        const remainingMs = QUIZ_COOLDOWN_MS - elapsed
        const remainingHours = Math.floor(remainingMs / (60 * 60 * 1000))
        const remainingMins = Math.ceil((remainingMs % (60 * 60 * 1000)) / (60 * 1000))
        return NextResponse.json({
          error: {
            code: 'CooldownActive',
            message: `Bạn cần đợi thêm ${remainingHours > 0 ? `${remainingHours} giờ ` : ''}${remainingMins} phút nữa mới có thể làm lại bài kiểm tra này (quy định giãn cách ${QUIZ_COOLDOWN_HOURS}h).`,
            remainingMs,
            cooldownUntil: new Date(Date.now() + remainingMs).toISOString(),
          },
        }, { status: 429 })
      }
    }
  }

  // 2. Tự động chuyển các bài IN_PROGRESS đã hết hạn sang CANCELLED
  await prisma.attempt.updateMany({
    where: {
      assessment_id: assessmentId,
      user_id: userId,
      status: 'IN_PROGRESS',
      expires_at: { lt: new Date() },
    },
    data: {
      status: 'CANCELLED',
      submitted_at: new Date(),
    },
  })

  const body = await request.json().catch(() => ({}))
  const forceNew = body?.forceNew === true

  // 3. Kiểm tra xem có bài thi nào ĐANG còn trong thời hạn hay không (nếu không forceNew)
  if (!forceNew) {
    const active = await prisma.attempt.findFirst({
      where: { assessment_id: assessmentId, user_id: userId, status: 'IN_PROGRESS' },
    })
    if (active) {
      // If not expired, return active attempt questions
      if (new Date() < active.expires_at) {
        const [activeQuestions, existingAnswers] = await Promise.all([
          prisma.attemptQuestion.findMany({
            where: { attempt_id: active.id },
            include: { question: { include: { options: true } } },
            orderBy: { display_order: 'asc' },
          }),
          prisma.attemptAnswer.findMany({
            where: { attempt_id: active.id },
            select: { question_id: true, selected_option_id: true },
          }),
        ])

        const answersMap: Record<string, string> = {}
        for (const ans of existingAnswers) {
          if (ans.selected_option_id) {
            answersMap[ans.question_id] = ans.selected_option_id
          }
        }

        return NextResponse.json({
          attemptId: active.id,
          id: active.id,
          attemptNumber: active.attempt_number,
          expiresAt: active.expires_at,
          isResumed: true,
          existingAnswers: answersMap,
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
  }

  const questions = await prisma.question.findMany({
    where: { assessment_id: assessmentId },
    include: { options: true },
    orderBy: { sort_order: 'asc' },
  })
  if (questions.length === 0) {
    return NextResponse.json({ error: { code: 'AssessmentNotFound', message: 'Assessment chưa có câu hỏi' } }, { status: 404 })
  }

  // A configured assessment must have exactly five complete pools, and every
  // question must belong to one of them. Never silently fall back to a normal quiz.
  const questionPools = await prisma.questionPool.findMany({
    where: { assessment_id: assessmentId },
    select: { id: true },
    orderBy: { sort_order: 'asc' },
  })
  const poolSelection = selectQuizQuestions(
    questionPools,
    questions.map((question) => ({ ...question, poolId: question.pool_id })),
    shuffleSecurely,
  )
  if (poolSelection.ok === false) {
    const messages = {
      QuestionPoolCountInvalid: 'A pooled quiz must have exactly five question pools.',
      QuestionPoolQuestionUnassigned: 'Every question must belong to one of the five configured pools.',
      QuestionPoolIncomplete: 'Each of the five question pools needs at least three questions.',
    }
    return NextResponse.json({ error: { code: poolSelection.code, message: messages[poolSelection.code] } }, { status: 422 })
  }
  const selectedQuestions = poolSelection.questions
  const expiresAt = new Date(Date.now() + Math.max(5, selectedQuestions.length * 2) * 60 * 1000)

  const attempt = await prisma.$transaction(async (tx) => {
    // Do not discard a resumable attempt until every prerequisite and the full
    // question-pool configuration above have passed validation.
    if (forceNew) {
      await tx.attempt.updateMany({
        where: { assessment_id: assessmentId, user_id: userId, status: 'IN_PROGRESS' },
        data: { status: 'CANCELLED', submitted_at: new Date() },
      })
    }

    // Đếm CHỈ những bài đã nộp thành công để tính lượt làm bài
    const submittedCount = await tx.attempt.count({
      where: {
        assessment_id: assessmentId,
        user_id: userId,
        status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
      },
    })

    const a = await tx.attempt.create({
      data: {
        assessment_id: assessmentId,
        user_id: userId,
        status: 'IN_PROGRESS',
        started_at: new Date(),
        expires_at: expiresAt,
        attempt_number: submittedCount + 1,
      },
    })

    await tx.attemptQuestion.createMany({
      data: selectedQuestions.map((q, idx) => ({
        attempt_id: a.id,
        question_id: q.id,
        display_order: idx,
      })),
    })

    return a
  })

  // Reuse precisely the same selection/order stored in AttemptQuestion.
  const shuffledQs = selectedQuestions.map((q) => ({
    questionId: q.id,
    id: q.id,
    questionText: q.question_text,
    points: q.points,
    options: shuffleSecurely(q.options).map((o) => ({
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
    isResumed: false,
    existingAnswers: {},
    questions: shuffledQs,
  }, { status: 201 })
}
