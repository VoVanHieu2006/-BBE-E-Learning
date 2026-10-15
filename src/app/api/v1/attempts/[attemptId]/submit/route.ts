import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { awardStars, canEarnStarsForCourse } from '@/lib/stars'
import { syncCourseAssignmentCompletion } from '@/lib/learning-assignments'
import { checkCourseFinalProgression, checkLessonProgression } from '@/lib/progression'
import { QUIZ_PASS_PERCENT } from '@/lib/config/quiz'
import { gradeQuizAttempt, validateAttemptAnswerSelections } from '@/lib/quiz-attempt-rules'

/** Submit and grade an attempt once, serializing answer writes against submission. */
export async function POST(request: NextRequest, { params }: { params: { attemptId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const userId = (auth as any).context!.userId
  const attempt = await prisma.attempt.findUnique({
    where: { id: params.attemptId },
    include: { assessment: { select: { type: true, lesson_id: true, course_id: true } } },
  })
  if (!attempt) return NextResponse.json({ error: { code: 'AttemptNotFound' } }, { status: 404 })
  if (attempt.user_id !== userId) return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })

  const progression = attempt.assessment.type === 'COURSE_FINAL' && attempt.assessment.course_id
    ? await checkCourseFinalProgression(userId, attempt.assessment.course_id, (auth as any).context!.role === 'ADMIN')
    : attempt.assessment.lesson_id
      ? await checkLessonProgression(userId, attempt.assessment.lesson_id, 'ASSESS', (auth as any).context!.role === 'ADMIN')
      : { ok: false as const, code: 'InvalidAssessmentOwner', message: 'Assessment owner is missing.' }
  if (progression.ok === false) {
    return NextResponse.json({ error: { code: progression.code, message: progression.message } }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Request body must be an object' } }, { status: 400 })
  }
  const bodyRecord = body as Record<string, unknown>
  const hasClientAnswers = Object.prototype.hasOwnProperty.call(bodyRecord, 'answers')
  if (hasClientAnswers && (!bodyRecord.answers || typeof bodyRecord.answers !== 'object' || Array.isArray(bodyRecord.answers))) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'answers must be an object keyed by questionId' } }, { status: 400 })
  }
  const submittedEntries = hasClientAnswers
    ? Object.entries(bodyRecord.answers as Record<string, unknown>)
    : []
  const optionIds = Array.from(new Set(submittedEntries
    .map(([, optionId]) => optionId)
    .filter((optionId): optionId is string => typeof optionId === 'string' && optionId.length > 0)))

  // All answer writes, grading and the status transition happen while holding a
  // row lock. An answer-save request either finishes before grading or sees the
  // submitted status and is rejected; it cannot silently race the final score.
  const submission = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM attempts WHERE id = ${params.attemptId}::uuid FOR UPDATE`
    const currentAttempt = await tx.attempt.findUnique({
      where: { id: params.attemptId },
      select: { user_id: true, status: true, expires_at: true },
    })
    if (!currentAttempt) return { error: 'AttemptNotFound' as const }
    if (currentAttempt.user_id !== userId) return { error: 'AccessDenied' as const }
    if (currentAttempt.status !== 'IN_PROGRESS') return { error: 'AttemptNotInProgress' as const }
    if (currentAttempt.expires_at <= new Date()) return { error: 'AttemptExpired' as const }

    const attemptQuestions = await tx.attemptQuestion.findMany({
      where: { attempt_id: params.attemptId },
      include: { question: { include: { options: true } } },
      orderBy: { display_order: 'asc' },
    })
    if (attemptQuestions.length === 0) return { error: 'AttemptHasNoQuestions' as const }

    if (hasClientAnswers) {
      const options = optionIds.length > 0
        ? await tx.questionOption.findMany({
            where: { id: { in: optionIds } },
            select: { id: true, question_id: true, is_correct: true },
          })
        : []
      const optionById = new Map(options.map((option) => [option.id, option]))
      const validation = validateAttemptAnswerSelections(
        attemptQuestions.map(({ question_id }) => question_id),
        new Map(options.map(({ id, question_id }) => [id, question_id])),
        submittedEntries,
      )
      if (validation.ok === false) return { error: validation.code }

      const answeredAt = new Date()
      await Promise.all(validation.answers.map(({ questionId, selectedOptionId }) => {
        const option = optionById.get(selectedOptionId)!
        return tx.attemptAnswer.upsert({
          where: { attempt_id_question_id: { attempt_id: params.attemptId, question_id: questionId } },
          create: {
            attempt_id: params.attemptId,
            question_id: questionId,
            selected_option_id: selectedOptionId,
            is_correct: option.is_correct,
            answered_at: answeredAt,
          },
          update: {
            selected_option_id: selectedOptionId,
            is_correct: option.is_correct,
            answered_at: answeredAt,
          },
        })
      }))
    }

    const answers = await tx.attemptAnswer.findMany({ where: { attempt_id: params.attemptId } })
    const grading = gradeQuizAttempt(
      attemptQuestions.map((attemptQuestion) => ({
        id: attemptQuestion.question_id,
        points: Number(attemptQuestion.question.points || 1),
        explanation: attemptQuestion.question.explanation,
        options: attemptQuestion.question.options.map((option) => ({
          id: option.id,
          text: option.option_text,
          correct: option.is_correct,
        })),
      })),
      answers.map((answer) => ({
        questionId: answer.question_id,
        selectedOptionId: answer.selected_option_id,
      })),
      QUIZ_PASS_PERCENT / 100,
    )

    const updateResult = await tx.attempt.updateMany({
      where: {
        id: params.attemptId,
        user_id: userId,
        status: 'IN_PROGRESS',
        expires_at: { gt: new Date() },
      },
      data: { status: 'SUBMITTED', submitted_at: new Date(), score: grading.scoreRatio, passed: grading.passed },
    })
    if (updateResult.count === 0) return { error: 'AttemptNotInProgress' as const }

    return { grading }
  })

  if ('error' in submission) {
    const status = submission.error === 'AttemptNotFound' ? 404 : submission.error === 'AccessDenied' ? 403 : 400
    return NextResponse.json({ error: { code: submission.error } }, { status })
  }

  const { score, totalPoints, scoreRatio, passed, results } = submission.grading
  const correctAnswerCount = results.filter((result) => result.isCorrect).length
  let starRewardAmount = 0
  if (passed) {
    const assess = await prisma.assessment.findUnique({
      where: { id: attempt.assessment_id },
      select: {
        type: true,
        lesson_id: true,
        course_id: true,
        lesson: { select: { session: { select: { course_id: true } } } },
      },
    })
    if (assess?.type === 'LESSON' && assess.lesson_id && assess.lesson) {
      await prisma.lessonProgress.upsert({
        where: { user_id_lesson_id: { user_id: userId, lesson_id: assess.lesson_id } },
        create: { user_id: userId, lesson_id: assess.lesson_id, completed: true, completed_at: new Date() },
        update: { completed: true, completed_at: new Date() },
      })
      await syncCourseAssignmentCompletion(userId, assess.lesson.session.course_id)

      if (await canEarnStarsForCourse(userId, assess.lesson.session.course_id)) {
        const starAwards = await Promise.all(Array.from({ length: correctAnswerCount }, (_, index) =>
          awardStars({
            userId,
            amount: 1,
            reason: 'MODULE_QUIZ_PASS',
            rewardKey: `quiz-correct:${userId}:${attempt.assessment_id}:${index + 1}`,
            sourceType: 'ASSESSMENT',
            sourceId: attempt.assessment_id,
            metadata: { attemptId: attempt.id, scoreRatio, correctOrdinal: index + 1 },
          })
        ))
        starRewardAmount = starAwards.reduce((sum, award) => sum + (award.awarded ? award.amount : 0), 0)
      }
    } else if (assess?.type === 'COURSE_FINAL' && assess.course_id) {
      await syncCourseAssignmentCompletion(userId, assess.course_id)
      if (await canEarnStarsForCourse(userId, assess.course_id)) {
        const awards = await Promise.all(Array.from({ length: correctAnswerCount }, (_, index) =>
          awardStars({
            userId,
            amount: 1,
            reason: 'COURSE_FINAL_PASS',
            rewardKey: `quiz-correct:${userId}:${attempt.assessment_id}:${index + 1}`,
            sourceType: 'ASSESSMENT',
            sourceId: attempt.assessment_id,
            metadata: { attemptId: attempt.id, scoreRatio, correctOrdinal: index + 1 },
          })
        ))
        starRewardAmount = awards.reduce((sum, award) => sum + (award.awarded ? award.amount : 0), 0)
      }
    }
  }

  return NextResponse.json({
    attemptId: attempt.id,
    score: Math.round(score),
    scorePercent: Math.round(scoreRatio * 100),
    totalPoints,
    passed,
    starReward: starRewardAmount > 0 ? { awarded: true, amount: starRewardAmount } : { awarded: false, amount: 0 },
    answers: results.map((result) => ({
      questionId: result.questionId,
      isCorrect: result.isCorrect,
      selectedOptionId: result.selectedOptionId,
      ...(passed ? { correctOptionId: result.correctOptionId, explanation: result.explanation } : {}),
    })),
  })
}
