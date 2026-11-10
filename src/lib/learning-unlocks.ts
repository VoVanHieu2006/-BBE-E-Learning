import { Prisma } from '@prisma/client'
import { hasWatchedFullVideo, endedCompletionToleranceSeconds } from './video-progress-rules'
import { currentCycleAttemptFilter } from './learning-periods'
import { firstInteractionAt, isNewForLearner } from './lesson-learning-state'

export interface UnlockCandidate {
  id: string
  createdAt?: Date | string | null
  quizCreatedAt?: Date | string | null
  hasQuiz: boolean
  videoWatched: boolean
  quizPassed: boolean
  lessonCompleted: boolean
}

/**
 * Tiền tố các bài được mở. Dừng ở bài đầu tiên chưa xong, TRỪ phần mới thêm sau lần tương tác đầu tiên:
 * bài/quiz mới chưa xong không chặn việc mở các bài sau (KHBB 6.1).
 */
export function unlockedPrefix(lessons: UnlockCandidate[], anchor: Date | null): string[] {
  const unlocked: string[] = []
  for (const lesson of lessons) {
    unlocked.push(lesson.id)
    const lessonIsNew = isNewForLearner(lesson.createdAt, anchor, lesson.lessonCompleted)
    if (lessonIsNew) continue
    if (!lesson.videoWatched) break
    const quizIsNew = lesson.hasQuiz && isNewForLearner(lesson.quizCreatedAt, anchor, lesson.quizPassed)
    if (lesson.hasQuiz && !lesson.quizPassed && !quizIsNew) break
  }
  return unlocked
}

/** Persist the unlocked prefix; later bank/content edits cannot revoke earned access. */
export async function persistLearningUnlocks(tx: Prisma.TransactionClient, userId: string, courseId: string, cycleId: string, now: Date) {
  const lessons = await tx.lesson.findMany({ where: { session: { course_id: courseId } }, include: { video: true, assessment: true }, orderBy: [{ session: { sort_order: 'asc' } }, { sort_order: 'asc' }, { id: 'asc' }] })
  const [progress, attempts] = await Promise.all([
    tx.cycleLessonProgress.findMany({ where: { user_id: userId, learning_cycle_id: cycleId, lesson_id: { in: lessons.map((row) => row.id) } } }),
    tx.attempt.findMany({ where: { user_id: userId, ...(await currentCycleAttemptFilter(tx, userId)), passed: true, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } }, select: { assessment_id: true } }),
  ])
  const passed = new Set(attempts.map((row) => row.assessment_id))
  const anchor = firstInteractionAt(progress)
  const unlocked = unlockedPrefix(lessons.map((lesson) => {
    const row = progress.find((item) => item.lesson_id === lesson.id)
    const watched = row?.furthest_seconds || 0
    const duration = lesson.video?.duration_seconds || 0
    const tolerance = endedCompletionToleranceSeconds(duration)
    return {
      id: lesson.id, createdAt: lesson.created_at, quizCreatedAt: lesson.assessment?.created_at, hasQuiz: Boolean(lesson.assessment),
      videoWatched: !lesson.video || hasWatchedFullVideo(watched, duration) || (duration > 0 && watched >= duration - tolerance),
      quizPassed: Boolean(lesson.assessment && passed.has(lesson.assessment.id)),
      lessonCompleted: Boolean(row?.completed_at),
    }
  }), anchor)
  if (!unlocked.length) return
  await tx.cycleLessonProgress.createMany({ data: unlocked.map((id) => ({ user_id: userId, lesson_id: id, learning_cycle_id: cycleId, unlocked_at: now })), skipDuplicates: true })
  await tx.cycleLessonProgress.updateMany({ where: { user_id: userId, learning_cycle_id: cycleId, lesson_id: { in: unlocked }, unlocked_at: null }, data: { unlocked_at: now } })
}
