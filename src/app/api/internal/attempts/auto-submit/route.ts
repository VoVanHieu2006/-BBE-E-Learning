import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/auth'
import { awardStars, canEarnStarsForCourse, starsForQuizScore } from '@/lib/stars'
import { syncCourseAssignmentCompletion } from '@/lib/learning-assignments'
import { QUIZ_PASS_PERCENT } from '@/lib/config/quiz'
import { gradeQuizAttempt } from '@/lib/quiz-attempt-rules'
import { starsForCourseFinalScore } from '@/lib/reward-rules'

/**
 * POST /api/internal/attempts/auto-submit
 * Auto-submit expired IN_PROGRESS attempts.
 * Protected by CRON_SECRET or Admin Bearer token.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  const cronSecret = process.env.CRON_SECRET
  const isValidSecret = Boolean(cronSecret && (
    authHeader === `Bearer ${cronSecret}` || request.headers.get('x-cron-secret') === cronSecret
  ))

  if (!isValidSecret && authHeader) {
    const auth = await authenticate(request)
    if (!auth.ok || (auth as any).context?.role !== 'ADMIN') {
      return NextResponse.json({ error: { code: 'Unauthorized', message: 'Unauthorized cron job' } }, { status: 401 })
    }
  } else if (!isValidSecret) {
    return NextResponse.json({ error: { code: 'Unauthorized', message: 'Unauthorized cron job' } }, { status: 401 })
  }

  const now = new Date()
  const expiredAttempts = await prisma.attempt.findMany({
    where: { status: 'IN_PROGRESS', expires_at: { lt: now } },
    select: { id: true },
  })
  const results = []

  for (const candidate of expiredAttempts) {
    // Use the same row lock as answer-save and manual-submit so the final
    // stored answer set and the persisted score cannot diverge under a race.
    const submission = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM attempts WHERE id = ${candidate.id}::uuid FOR UPDATE`
      const attempt = await tx.attempt.findUnique({
        where: { id: candidate.id },
        include: {
          attempt_questions: { include: { question: { include: { options: true } } } },
          attempt_answers: true,
        },
      })
      if (!attempt || attempt.status !== 'IN_PROGRESS' || attempt.expires_at >= now) return null

      const grading = gradeQuizAttempt(
        attempt.attempt_questions.map((attemptQuestion) => ({
          id: attemptQuestion.question_id,
          points: Number(attemptQuestion.question.points || 1),
          explanation: attemptQuestion.question.explanation,
          options: attemptQuestion.question.options.map((option) => ({
            id: option.id,
            text: option.option_text,
            correct: option.is_correct,
          })),
        })),
        attempt.attempt_answers.map((answer) => ({
          questionId: answer.question_id,
          selectedOptionId: answer.selected_option_id,
        })),
        QUIZ_PASS_PERCENT / 100,
      )

      const update = await tx.attempt.updateMany({
        where: { id: attempt.id, status: 'IN_PROGRESS', expires_at: { lt: now } },
        data: { status: 'AUTO_SUBMITTED', submitted_at: now, score: grading.scoreRatio, passed: grading.passed },
      })
      if (update.count === 0) return null

      return {
        attemptId: attempt.id,
        assessmentId: attempt.assessment_id,
        userId: attempt.user_id,
        scoreRatio: grading.scoreRatio,
        passed: grading.passed,
      }
    })
    if (!submission) continue

    if (submission.passed) {
      const assess = await prisma.assessment.findUnique({
        where: { id: submission.assessmentId },
        select: { type: true, lesson_id: true, course_id: true, lesson: { select: { session: { select: { course_id: true } } } } },
      })
      if (assess?.type === 'LESSON' && assess.lesson_id && assess.lesson) {
        await prisma.lessonProgress.upsert({
          where: { user_id_lesson_id: { user_id: submission.userId, lesson_id: assess.lesson_id } },
          create: { user_id: submission.userId, lesson_id: assess.lesson_id, completed: true, completed_at: now },
          update: { completed: true, completed_at: now },
        })
        await syncCourseAssignmentCompletion(submission.userId, assess.lesson.session.course_id)

        if (await canEarnStarsForCourse(submission.userId, assess.lesson.session.course_id)) {
          const quizStarTotal = starsForQuizScore(submission.scoreRatio, QUIZ_PASS_PERCENT / 100)
          const bonus = Math.max(0, quizStarTotal - 2)
          await awardStars({
            userId: submission.userId,
            amount: 2,
            reason: 'MODULE_QUIZ_PASS',
            rewardKey: `module-quiz-pass:${submission.userId}:${submission.assessmentId}`,
            sourceType: 'ASSESSMENT',
            sourceId: submission.assessmentId,
            metadata: { attemptId: submission.attemptId, score: Math.round(submission.scoreRatio * 100), autoSubmitted: true },
          })
          if (bonus > 0) {
            await awardStars({
              userId: submission.userId,
              amount: bonus,
              reason: 'MODULE_QUIZ_BONUS',
              rewardKey: `module-quiz-bonus:${submission.userId}:${submission.assessmentId}`,
              sourceType: 'ASSESSMENT',
              sourceId: submission.assessmentId,
              metadata: { attemptId: submission.attemptId, score: Math.round(submission.scoreRatio * 100), autoSubmitted: true },
            })
          }
        }
      } else if (assess?.type === 'COURSE_FINAL' && assess.course_id) {
        await syncCourseAssignmentCompletion(submission.userId, assess.course_id)
        if (await canEarnStarsForCourse(submission.userId, assess.course_id)) {
          const reward = starsForCourseFinalScore(submission.scoreRatio, QUIZ_PASS_PERCENT / 100)
          await awardStars({
            userId: submission.userId,
            amount: reward.passStars,
            reason: 'COURSE_FINAL_PASS',
            rewardKey: `course-final-pass:${submission.userId}:${submission.assessmentId}`,
            sourceType: 'ASSESSMENT',
            sourceId: submission.assessmentId,
            metadata: { attemptId: submission.attemptId, score: Math.round(submission.scoreRatio * 100), autoSubmitted: true },
          })
          if (reward.bonusStars > 0) await awardStars({
            userId: submission.userId,
            amount: reward.bonusStars,
            reason: 'COURSE_FINAL_BONUS',
            rewardKey: `course-final-bonus:${submission.userId}:${submission.assessmentId}`,
            sourceType: 'ASSESSMENT',
            sourceId: submission.assessmentId,
            metadata: { attemptId: submission.attemptId, score: Math.round(submission.scoreRatio * 100), autoSubmitted: true },
          })
        }
      }
    }

    results.push({
      attemptId: submission.attemptId,
      userId: submission.userId,
      score: Math.round(submission.scoreRatio * 100),
      passed: submission.passed,
      status: 'AUTO_SUBMITTED',
    })
  }

  return NextResponse.json({ processed: results.length, attempts: results }, { status: 200 })
}
