import { prisma } from './prisma'
import { QUIZ_PASS_PERCENT } from './config/quiz'
import { gradeQuizAttempt, validateAttemptAnswerSelections, GradingQuestion } from './quiz-attempt-rules'
import { learningContext, lockLearningUser, rewardEligibility, enqueueAssignmentSync } from './learning-periods'
import { highWaterIncrement } from './learning-cycle-rules'
import { syncCourseAssignmentCompletion } from './learning-assignments'
import { persistLearningUnlocks } from './learning-unlocks'
import { chapterRewardState } from './chapter-reward-gate'

/** Both submission entry points use this transaction, including completion and rewards. */
export async function submitQuiz(input: { attemptId: string; userId?: string; auto?: boolean; answers?: Record<string, unknown> }) {
  const owner = await prisma.attempt.findUnique({ where: { id: input.attemptId }, select: { user_id: true } })
  if (!owner) return { error: 'AttemptNotFound' as const }
  if (input.userId && owner.user_id !== input.userId) return { error: 'AccessDenied' as const }
  return prisma.$transaction(async (tx) => {
    let now = await lockLearningUser(tx, owner.user_id)
    await tx.$queryRaw`SELECT id FROM attempts WHERE id = ${input.attemptId}::uuid FOR UPDATE`
    const attempt = await tx.attempt.findUnique({ where: { id: input.attemptId }, include: {
      assessment: { include: { lesson: { select: { session: { select: { course_id: true } } } } } },
      attempt_questions: { include: { question: { include: { options: true } } }, orderBy: { display_order: 'asc' } },
      attempt_answers: true,
    } })
    if (!attempt) return { error: 'AttemptNotFound' as const }
    if (attempt.status === 'CANCELLED') return { error: 'AttemptCancelled' as const }
    if (attempt.status !== 'IN_PROGRESS' && attempt.grading_snapshot) return {
      grading: attempt.grading_snapshot as unknown as ReturnType<typeof gradeQuizAttempt>, amount: 0, repeated: true,
    }
    const userId = attempt.user_id
    const context = await learningContext(tx, userId, now)
    now = context?.now || now
    if (context && attempt.learning_cycle_id !== context.cycle.id && attempt.started_at >= context.cycle.starts_at) {
      // Transitional attempts begun before cutover may finish in the transition cycle.
      return { error: 'AttemptCycleChanged' as const }
    }
    if (context && attempt.started_at < context.cycle.starts_at && context.cycle.provenance !== 'LEGACY') {
      await tx.attempt.update({ where: { id: attempt.id }, data: { status: 'CANCELLED', cancellation_reason: 'LEARNING_CYCLE_RESET', submitted_at: now } })
      return { error: 'AttemptCycleChanged' as const }
    }
    const repeated = attempt.status !== 'IN_PROGRESS'
    if (!repeated && input.auto && attempt.expires_at > now) return { error: 'AttemptNotExpired' as const }
    if (!repeated && !input.auto && attempt.expires_at <= now) return { error: 'AttemptExpired' as const }
    if (!attempt.attempt_questions.length) return { error: 'AttemptHasNoQuestions' as const }
    if (!repeated && input.answers) {
      const options = attempt.attempt_questions.flatMap((row) => row.question.options)
      const validation = validateAttemptAnswerSelections(
        attempt.attempt_questions.map((row) => row.question_id),
        new Map(options.map((option) => [option.id, option.question_id])), Object.entries(input.answers),
      )
      if (validation.ok === false) return { error: validation.code }
      for (const answer of validation.answers) await tx.attemptAnswer.upsert({
        where: { attempt_id_question_id: { attempt_id: attempt.id, question_id: answer.questionId } },
        create: { attempt_id: attempt.id, question_id: answer.questionId, selected_option_id: answer.selectedOptionId, answered_at: now },
        update: { selected_option_id: answer.selectedOptionId, answered_at: now },
      })
    }
    const answers = await tx.attemptAnswer.findMany({ where: { attempt_id: attempt.id } })
    const grading = gradeQuizAttempt(attempt.attempt_questions.map(({ question, question_snapshot }) => question_snapshot ? question_snapshot as unknown as GradingQuestion : ({
      id: question.id, points: question.points, explanation: question.explanation,
      options: question.options.map((option) => ({ id: option.id, text: option.option_text, correct: option.is_correct })),
    })), answers.map((answer) => ({ questionId: answer.question_id, selectedOptionId: answer.selected_option_id })), QUIZ_PASS_PERCENT / 100)
    // Repeated submissions are read-only: they cannot re-grade against later bank edits.
    if (repeated) return { grading: { ...grading, scoreRatio: Number(attempt.score), passed: Boolean(attempt.passed) }, amount: 0, repeated: true }
    await tx.attempt.update({ where: { id: attempt.id }, data: {
      status: input.auto ? 'AUTO_SUBMITTED' : 'SUBMITTED', submitted_at: now,
      score: grading.scoreRatio, passed: grading.passed,
      grading_snapshot: JSON.parse(JSON.stringify(grading)),
    } })
    const assessment = attempt.assessment
    const courseId = assessment.course_id || assessment.lesson?.session.course_id
    let amount = 0
    if (grading.passed && courseId) {
      if (assessment.lesson_id) {
        // The video was authorized at start; use the current cycle's projection.
        await tx.lessonProgress.upsert({
          where: { user_id_lesson_id: { user_id: userId, lesson_id: assessment.lesson_id } },
          create: { user_id: userId, lesson_id: assessment.lesson_id, completed: true, completed_at: now },
          update: { completed: true, completed_at: now },
        })
        if (context) await tx.cycleLessonProgress.upsert({
          where: { user_id_lesson_id_learning_cycle_id: { user_id: userId, lesson_id: assessment.lesson_id, learning_cycle_id: context.cycle.id } },
          create: { user_id: userId, lesson_id: assessment.lesson_id, learning_cycle_id: context.cycle.id, completed_at: now },
          update: { completed_at: now },
        })
      }
      const eligible = await rewardEligibility(tx, userId, courseId, now)
      const paused = context && (await chapterRewardState(tx, userId, now)).paused
      if (eligible || paused) {
        const correctCount = grading.results.filter((row) => row.isCorrect).length
        const reason = assessment.type === 'COURSE_FINAL' ? 'COURSE_FINAL_PASS' as const : 'MODULE_QUIZ_PASS' as const
        const chapter = await tx.chapterMember.findUnique({ where: { user_id: userId } })
        if (context) {
          const key = { user_id: userId, assessment_id: assessment.id, competition_month_id: context.month.id, learning_cycle_id: context.cycle.id }
          const mark = await tx.quizRewardHighWaterMark.upsert({
            where: { user_id_assessment_id_competition_month_id_learning_cycle_id: key }, update: {},
            create: { ...key, reward_question_count: grading.results.length, reward_config: { questions: grading.results.map((row) => ({ id: row.questionId, points: row.points })) } },
          })
          // One star per correct answer, normalized to the first configuration's budget.
          const earned = Math.floor(correctCount / grading.results.length * mark.reward_question_count + 1e-9)
          const increment = highWaterIncrement(mark.maximum_stars, earned)
          amount = eligible ? increment : 0
          if (increment) {
            await tx.quizRewardHighWaterMark.update({ where: { id: mark.id }, data: { maximum_stars: earned } })
          }
          if (amount) {
            await tx.starLedger.create({ data: {
              user_id: userId, amount, reason, reward_key: `quiz:${mark.id}:${earned}`,
              source_type: 'ASSESSMENT', source_id: assessment.id, awarded_at: now,
              competition_month_id: context.month.id, learning_cycle_id: context.cycle.id,
              chapter_at_award_id: chapter?.chapter_id, provenance: 'NATIVE', metadata: { attemptId: attempt.id },
            } })
          }
        } else {
          const previous = await tx.starLedger.aggregate({ where: { user_id: userId, source_type: 'ASSESSMENT', source_id: assessment.id, amount: { gt: 0 }, reason: { in: ['MODULE_QUIZ_PASS', 'MODULE_QUIZ_BONUS', 'COURSE_FINAL_PASS', 'COURSE_FINAL_BONUS'] } }, _sum: { amount: true } })
          const alreadyPaid = previous._sum.amount || 0
          const result = await tx.starLedger.createMany({ data: Array.from({ length: Math.max(0, correctCount - alreadyPaid) }, (_, index) => ({
            user_id: userId, amount: 1, reason, reward_key: `quiz-correct:${userId}:${assessment.id}:${alreadyPaid + index + 1}`,
            source_type: 'ASSESSMENT', source_id: assessment.id, awarded_at: now, metadata: { attemptId: attempt.id },
          })), skipDuplicates: true })
          amount = result.count
        }
      }
      // Completion reconciliation is durable even if the worker fails after commit.
      await syncCourseAssignmentCompletion(userId, courseId, tx)
      if (context) await persistLearningUnlocks(tx, userId, courseId, context.cycle.id, now)
      await enqueueAssignmentSync(tx, userId, `submit:${attempt.id}`)
    }
    return { grading, amount, repeated: false }
  }, { timeout: 30_000 })
}
