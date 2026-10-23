import { Prisma } from '@prisma/client'
import { hasWatchedFullVideo } from './video-progress-rules'
import { currentCycleAttemptFilter } from './learning-periods'

/** Persist the unlocked prefix; later bank/content edits cannot revoke earned access. */
export async function persistLearningUnlocks(tx: Prisma.TransactionClient, userId: string, courseId: string, cycleId: string, now: Date) {
  const lessons = await tx.lesson.findMany({ where: { session: { course_id: courseId } }, include: { video: true, assessment: true }, orderBy: [{ session: { sort_order: 'asc' } }, { sort_order: 'asc' }, { id: 'asc' }] })
  const [progress, attempts] = await Promise.all([
    tx.cycleLessonProgress.findMany({ where: { user_id: userId, learning_cycle_id: cycleId, lesson_id: { in: lessons.map((row) => row.id) } } }),
    tx.attempt.findMany({ where: { user_id: userId, ...(await currentCycleAttemptFilter(tx, userId)), passed: true, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } }, select: { assessment_id: true } }),
  ])
  const passed = new Set(attempts.map((row) => row.assessment_id))
  const unlocked = []
  for (const lesson of lessons) {
    unlocked.push(lesson.id)
    const watched = progress.find((row) => row.lesson_id === lesson.id)?.furthest_seconds || 0
    if (lesson.video && !hasWatchedFullVideo(watched, lesson.video.duration_seconds)) break
    if (lesson.assessment && !passed.has(lesson.assessment.id)) break
  }
  if (!unlocked.length) return
  await tx.cycleLessonProgress.createMany({ data: unlocked.map((id) => ({ user_id: userId, lesson_id: id, learning_cycle_id: cycleId, unlocked_at: now })), skipDuplicates: true })
  await tx.cycleLessonProgress.updateMany({ where: { user_id: userId, learning_cycle_id: cycleId, lesson_id: { in: unlocked }, unlocked_at: null }, data: { unlocked_at: now } })
}
