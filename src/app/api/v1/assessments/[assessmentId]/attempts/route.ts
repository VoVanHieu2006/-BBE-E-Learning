import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkCourseFinalProgression, checkLessonProgression } from '@/lib/progression'
import { hasWatchedFullVideo, endedCompletionToleranceSeconds } from '@/lib/video-progress-rules'
import { selectQuizQuestions } from '@/lib/quiz-pool-selection'
import { randomInt } from 'crypto'
import { isLearningManager } from '@/lib/manager-learning-access'
import { selectBalancedFinalExamQuestions } from '@/lib/final-exam-selection'
import { lockCourseExamBank } from '@/lib/final-exam-bank'
import { learningContext, lockLearningUser, activeLearningPolicy } from '@/lib/learning-periods'

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
  if (await isLearningManager(userId, auth.context!.role)) {
    return NextResponse.json({ error: { code: 'ManagementOnlyAccount', message: 'Tài khoản quản lý không tham gia học hoặc làm bài kiểm tra.' } }, { status: 403 })
  }
  const assessmentId = params.assessmentId

  const newPolicy = await activeLearningPolicy(prisma, new Date())
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
      question_count: true,
      duration_minutes: true,
      lesson: {
        select: {
          id: true,
          video: { select: { id: true, duration_seconds: true } },
        },
      },
    },
  })
  if (!assessment) return NextResponse.json({ error: { code: 'AssessmentNotFound' } }, { status: 404 })
  const body = await request.json().catch(() => ({}))
  const forceNew = body?.forceNew === true
  const resumableAttempt = !forceNew
    ? await prisma.attempt.findFirst({ where: { assessment_id: assessmentId, user_id: userId, status: 'IN_PROGRESS', expires_at: { gt: new Date() } }, select: { id: true } })
    : null

  const isAdmin = (auth as any).context!.role === 'ADMIN'
  const gate = assessment.type === 'COURSE_FINAL' && assessment.course_id
    ? resumableAttempt ? { ok: true as const, courseId: assessment.course_id, canEarnStars: false } : await checkCourseFinalProgression(userId, assessment.course_id, isAdmin)
    : assessment.lesson_id
      ? await checkLessonProgression(userId, assessment.lesson_id, 'ASSESS', isAdmin)
      : { ok: false as const, code: 'InvalidAssessmentOwner', message: 'Assessment owner is missing.' }
  if (gate.ok === false) return NextResponse.json({ error: { code: gate.code, message: gate.message } }, { status: 403 })

  // If resuming an active in-progress attempt, bypass video and monthly replay checks
  if (!resumableAttempt && assessment.lesson_id && assessment.lesson) {
    const now = new Date()
    const cycle = await prisma.learningCycle.findFirst({ where: { user_id: userId, ends_at: null }, select: { id: true } })
    const currentMonth = await prisma.competitionMonth.findFirst({ where: { starts_at: { lte: now }, ends_at: { gt: now } } })

    if (cycle && currentMonth && assessment.lesson.video) {
      const priorAttemptInEarlierMonth = await prisma.attempt.findFirst({
        where: {
          assessment_id: assessmentId,
          user_id: userId,
          learning_cycle_id: cycle.id,
          status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
          submitted_at: { lt: currentMonth.starts_at },
        },
        select: { id: true },
      })

      if (priorAttemptInEarlierMonth) {
        const replay = await prisma.monthlyVideoReplay.findUnique({
          where: {
            user_id_video_id_competition_month_id_learning_cycle_id: {
              user_id: userId,
              video_id: assessment.lesson.video.id,
              competition_month_id: currentMonth.id,
              learning_cycle_id: cycle.id,
            },
          },
        })

        if (!replay || !replay.completed_at) {
          return NextResponse.json({
            error: {
              code: 'MonthlyVideoReplayRequired',
              message: 'Bạn cần xem lại toàn bộ video bài học trong tháng này trước khi làm bài kiểm tra.',
            },
          }, { status: 403 })
        }
      }
    }

    const cycleProg = cycle ? await prisma.cycleLessonProgress.findUnique({
      where: {
        user_id_lesson_id_learning_cycle_id: {
          user_id: userId,
          lesson_id: assessment.lesson_id,
          learning_cycle_id: cycle.id,
        },
      },
      select: { furthest_seconds: true },
    }) : null
    const prog = cycleProg ? null : await prisma.lessonProgress.findUnique({
      where: {
        user_id_lesson_id: {
          user_id: userId,
          lesson_id: assessment.lesson_id,
        },
      },
      select: { furthest_watched_position_seconds: true },
    })
    const video = assessment.lesson.video
    const furthest = cycleProg ? cycleProg.furthest_seconds : (prog?.furthest_watched_position_seconds || 0)
    const duration = video?.duration_seconds || 0
    const tolerance = endedCompletionToleranceSeconds(duration)
    const watchedEnough = !video || hasWatchedFullVideo(furthest, duration) || (duration > 0 && furthest >= duration - tolerance)
    if (!watchedEnough) {
      return NextResponse.json({
        error: { code: 'VideoNotCompleted', message: 'Bạn cần xem hoàn tất 100% video bài giảng trước khi làm bài kiểm tra' },
      }, { status: 403 })
    }
  }

  // 1. Kiểm tra Cooldown: Mỗi lần làm (dù nộp hay hủy) cần đợi khoảng thời gian quy định
  const { QUIZ_COOLDOWN_MS, QUIZ_COOLDOWN_MINUTES } = await import('@/lib/config/quiz')
  if (QUIZ_COOLDOWN_MS > 0 && !resumableAttempt) {
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
        const remainingMins = Math.ceil(remainingMs / (60 * 1000))
        return NextResponse.json({
          error: {
            code: 'CooldownActive',
            message: `Bạn cần đợi thêm ${remainingMins} phút nữa mới có thể làm lại bài kiểm tra này (quy định giãn cách ${QUIZ_COOLDOWN_MINUTES} phút).`,
            remainingMs,
            cooldownUntil: new Date(Date.now() + remainingMs).toISOString(),
          },
        }, { status: 429 })
      }
    }
  }

  // 2. Tự động chuyển các bài IN_PROGRESS đã hết hạn sang CANCELLED


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
          questionCount: activeQuestions.length,
          durationMinutes: assessment.duration_minutes,
          passingPercent: 85,
          existingAnswers: answersMap,
          questions: activeQuestions.map((aq) => {
            const snapshot = aq.question_snapshot as any
            const options = Array.isArray(snapshot?.options) && snapshot.options.length
              ? snapshot.options.map((o: any) => ({ optionId: o.id, id: o.id, optionText: o.text }))
              : aq.question.options.map((o) => ({ optionId: o.id, id: o.id, optionText: o.option_text }))
            return {
              questionId: aq.question.id,
              id: aq.question.id,
              questionText: snapshot?.questionText || aq.question.question_text,
              points: snapshot?.points ?? aq.question.points,
              options,
            }
          }),
        }, { status: 200 })
      }
    }
  }

  const finalVersion = assessment.type === 'COURSE_FINAL'
    ? await prisma.finalExamVersion.findFirst({ where: { assessment_id: assessmentId, is_active: true }, select: { id: true, question_count: true, duration_minutes: true } })
    : null
  if (assessment.type === 'COURSE_FINAL') {
    if (!finalVersion) return NextResponse.json({ error: { code: 'FinalExamVersionUnavailable', message: 'Bài thi cuối khóa chưa có phiên bản đề hợp lệ.' } }, { status: 422 })
    const passed = await prisma.attempt.count({ where: { assessment_id: assessmentId, user_id: userId, passed: true, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } } })
    if (passed && !newPolicy) return NextResponse.json({ error: { code: 'FinalExamAlreadyPassed', message: 'Bạn đã đạt bài thi cuối khóa.' } }, { status: 409 })
  }

  const questions = await prisma.question.findMany({
    where: assessment.type === 'COURSE_FINAL' && assessment.course_id
      ? { final_exam_version_id: finalVersion!.id }
      : { assessment_id: assessmentId },
    include: { options: true },
    orderBy: { sort_order: 'asc' },
  })
  if (questions.length === 0) {
    return NextResponse.json({ error: { code: 'AssessmentNotFound', message: 'Assessment chưa có câu hỏi' } }, { status: 404 })
  }

  // A configured assessment must have exactly five complete pools, and every
  // question must belong to one of them. Never silently fall back to a normal quiz.
  const questionPools = assessment.type === 'COURSE_FINAL' ? [] : await prisma.questionPool.findMany({
    where: { assessment_id: assessmentId }, select: { id: true }, orderBy: { sort_order: 'asc' },
  })
  const poolSelection = assessment.type === 'COURSE_FINAL'
    ? (() => {
        const selected = selectBalancedFinalExamQuestions(questions, finalVersion!.question_count, shuffleSecurely)
        return selected
          ? { ok: true as const, questions: selected }
          : { ok: false as const, code: 'QuestionPoolIncomplete' as const }
      })()
    : selectQuizQuestions(
        questionPools,
        questions.map((question) => ({ ...question, poolId: question.pool_id })),
        shuffleSecurely,
        assessment.question_count,
      )
  if (poolSelection.ok === false) {
    if (assessment.type === 'COURSE_FINAL') return NextResponse.json({ error: { code: 'FinalExamBankTooSmall', message: `Bài thi cần ${finalVersion!.question_count} câu nhưng phiên bản đề hiện không đủ câu. Vui lòng báo quản trị viên.` } }, { status: 422 })
    const messages: Record<string, string> = {
      QuestionPoolCountInvalid: 'Bài kiểm tra cần từ 1 đến 20 nhóm câu hỏi và số câu thi không thể ít hơn số nhóm.',
      QuestionPoolQuestionUnassigned: 'Mỗi câu hỏi phải thuộc một nhóm đã cấu hình.',
      QuestionPoolIncomplete: 'Mỗi nhóm phải có ít nhất một câu hỏi.',
      QuestionPoolQuotaExceeded: `Số câu cấu hình (${assessment.question_count} câu) vượt quá giới hạn cân bằng tối đa (${(poolSelection as any).maxAllowed ?? ''} câu). Vui lòng báo quản trị viên.`,
    }
    return NextResponse.json({ error: { code: poolSelection.code, message: messages[poolSelection.code] || 'Lỗi cấu hình nhóm câu hỏi' } }, { status: 422 })
  }
  const selectedQuestions = poolSelection.questions.map((question) => ({
    ...question,
    // The response and the resume snapshot must use the same option order.
    responseOptions: shuffleSecurely(question.options),
  }))
  const expiresAt = new Date(Date.now() + (finalVersion?.duration_minutes || assessment.duration_minutes) * 60 * 1000)

  let attempt: { id: string; attempt_number: number; expires_at: Date }
  try {
    attempt = await prisma.$transaction(async (tx) => {
    let now = await lockLearningUser(tx, userId)
    const lockedGate = assessment.type === 'COURSE_FINAL' && assessment.course_id
      ? await checkCourseFinalProgression(userId, assessment.course_id, isAdmin)
      : assessment.lesson_id ? await checkLessonProgression(userId, assessment.lesson_id, 'ASSESS', isAdmin) : null
    if (!lockedGate || lockedGate.ok === false) throw new Error('ProgressionChanged')
    const learning = await learningContext(tx, userId, now)
    now = learning?.now || now
    await lockCourseExamBank(tx, gate.courseId)
    if (assessment.type === 'COURSE_FINAL' && assessment.course_id) {
      const current = await tx.finalExamVersion.findFirst({ where: { assessment_id: assessmentId, is_active: true }, select: { id: true } })
      if (current?.id !== finalVersion?.id) throw new Error('FinalExamVersionChanged')
      if (!learning && await tx.attempt.count({ where: { assessment_id: assessmentId, user_id: userId, passed: true, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } } })) throw new Error('FinalExamAlreadyPassed')
    }
    if (!forceNew && await tx.attempt.count({ where: { assessment_id: assessmentId, user_id: userId, status: 'IN_PROGRESS', expires_at: { gt: new Date() } } })) throw new Error('AttemptAlreadyInProgress')
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
        final_exam_version_id: finalVersion?.id || null,
        user_id: userId,
        status: 'IN_PROGRESS',
        learning_cycle_id: learning?.cycle.id,
        started_at: now,
        expires_at: new Date(now.getTime() + (finalVersion?.duration_minutes || assessment.duration_minutes) * 60_000),
        attempt_number: submittedCount + 1,
      },
    })

    await tx.attemptQuestion.createMany({
      data: selectedQuestions.map((q, idx) => ({
        attempt_id: a.id,
        question_id: q.id,
        display_order: idx,
        question_snapshot: { id: q.id, questionText: q.question_text, points: q.points, explanation: q.explanation, options: q.responseOptions.map((option) => ({ id: option.id, text: option.option_text, correct: option.is_correct })) },
      })),
    })

    if (learning) await tx.quizRewardHighWaterMark.upsert({
      where: { user_id_assessment_id_competition_month_id_learning_cycle_id: { user_id: userId, assessment_id: assessmentId, competition_month_id: learning.month.id, learning_cycle_id: learning.cycle.id } },
      update: {}, create: { user_id: userId, assessment_id: assessmentId, competition_month_id: learning.month.id, learning_cycle_id: learning.cycle.id, reward_question_count: selectedQuestions.length, reward_config: { questions: selectedQuestions.map((q) => ({ id: q.id, points: q.points })) } },
    })
    return a
    }, { timeout: 60_000 })
  } catch (error) {
    if (error instanceof Error && error.message === 'ProgressionChanged') return NextResponse.json({ error: { code: 'ProgressionChanged', message: 'Chu kỳ hoặc quyền mở bài đã thay đổi. Hãy tải lại.' } }, { status: 409 })
    if (error instanceof Error && error.message === 'FinalExamVersionChanged') {
      return NextResponse.json({ error: { code: 'FinalExamVersionChanged', message: 'Đề thi vừa được cập nhật. Hãy tải lại trang để bắt đầu phiên bản mới.' } }, { status: 409 })
    }
    if (error instanceof Error && error.message === 'FinalExamAlreadyPassed') return NextResponse.json({ error: { code: 'FinalExamAlreadyPassed', message: 'Bạn đã đạt bài thi cuối khóa.' } }, { status: 409 })
    if (error instanceof Error && error.message === 'AttemptAlreadyInProgress') return NextResponse.json({ error: { code: 'AttemptAlreadyInProgress', message: 'Đã có lượt làm đang mở. Hãy tải lại trang để tiếp tục.' } }, { status: 409 })
    throw error
  }

  // Reuse precisely the same selection/order stored in AttemptQuestion.
  const shuffledQs = selectedQuestions.map((q) => ({
    questionId: q.id,
    id: q.id,
    questionText: q.question_text,
    points: q.points,
    options: q.responseOptions.map((o) => ({
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
    questionCount: shuffledQs.length,
    durationMinutes: finalVersion?.duration_minutes || assessment.duration_minutes,
    passingPercent: 85,
    questions: shuffledQs,
  }, { status: 201 })
}
