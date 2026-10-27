import { Prisma } from '@prisma/client'
import { hasWatchedFullVideo, endedCompletionToleranceSeconds } from './video-progress-rules'

export type LearningLesson = {
  id: string
  courseId?: string
  video: { duration_seconds: number | null } | null
  assessment: { id: string } | null
}
export type LessonLearningState = {
  learningCycleId: string | null
  canView: boolean
  canAssess: boolean
  videoCompleted: boolean
  lessonCompleted: boolean
  unlocked: boolean
  lockReason: 'PreviousLessonIncomplete' | 'LessonAssessmentRequired' | null
  furthestWatchedPositionSeconds: number
}

/** Read only: never imports legacy completion or materializes unlocks. Lessons must be in curriculum order. */
export async function readLessonLearningStates(tx: Prisma.TransactionClient, userId: string, lessons: LearningLesson[]) {
  const cycle = await tx.learningCycle.findFirst({ where: { user_id: userId, ends_at: null }, select: { id: true, provenance: true, starts_at: true } })
  const ids = lessons.map(l => l.id)
  const assessmentIds = lessons.flatMap(l => l.assessment ? [l.assessment.id] : [])
  const [cycleRows, legacyRows, attempts] = await Promise.all([
    tx.cycleLessonProgress.findMany({ where: { user_id: userId, learning_cycle_id: cycle?.id || '00000000-0000-0000-0000-000000000000', lesson_id: { in: cycle ? ids : [] } }, select: { lesson_id: true, completed_at: true, unlocked_at: true, furthest_seconds: true } }),
    tx.lessonProgress.findMany({ where: { user_id: userId, lesson_id: { in: cycle ? [] : ids } }, select: { lesson_id: true, completed: true, furthest_watched_position_seconds: true } }),
    assessmentIds.length ? tx.attempt.findMany({ where: {
      user_id: userId, assessment_id: { in: assessmentIds }, passed: true, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
      ...(cycle ? cycle.provenance === 'LEGACY'
        ? { OR: [{ learning_cycle_id: cycle.id }, { learning_cycle_id: null, started_at: { lt: cycle.starts_at } }] }
        : { learning_cycle_id: cycle.id } : {}),
    }, select: { assessment_id: true }, distinct: ['assessment_id'] }) : [],
  ])
  const progress = new Map(cycleRows.map(p => [p.lesson_id, p]))
  const legacy = new Map(legacyRows.map(p => [p.lesson_id, p]))
  const passed = new Set(attempts.map(a => a.assessment_id))
  let previousVideoIncomplete = false
  let previousQuizIncomplete = false
  const states: Record<string, LessonLearningState> = {}
  let previousCourseId: string | undefined
  for (const lesson of lessons) {
    if (lesson.courseId !== previousCourseId) { previousVideoIncomplete = false; previousQuizIncomplete = false }
    previousCourseId = lesson.courseId
    const row = progress.get(lesson.id), old = legacy.get(lesson.id)
    const lessonCompleted = cycle ? Boolean(row?.completed_at) : Boolean(old?.completed)
    const furthest = cycle ? row?.furthest_seconds || 0 : old?.furthest_watched_position_seconds || 0
    const duration = lesson.video?.duration_seconds || 0
    const videoCompleted = !lesson.video || lessonCompleted || hasWatchedFullVideo(furthest, duration)
      || (duration > 0 && furthest >= duration - endedCompletionToleranceSeconds(duration))
    const unlocked = Boolean(cycle && row?.unlocked_at)
    // A completed video is sufficient to revisit it; it does not pass its quiz.
    const earnedReview = Boolean(cycle && (lessonCompleted || (lesson.video && videoCompleted) || unlocked))
    const lockReason = earnedReview ? null : previousVideoIncomplete ? 'PreviousLessonIncomplete' : previousQuizIncomplete ? 'LessonAssessmentRequired' : null
    states[lesson.id] = { learningCycleId: cycle?.id || null, canView: !lockReason, canAssess: !lockReason && videoCompleted, videoCompleted, lessonCompleted, unlocked, lockReason, furthestWatchedPositionSeconds: furthest }
    previousVideoIncomplete ||= !videoCompleted
    previousQuizIncomplete ||= Boolean(lesson.assessment && !passed.has(lesson.assessment.id))
  }
  return states
}

export async function readCourseLearningStates(tx: Prisma.TransactionClient, userId: string, courseId: string) {
  const lessons = await tx.lesson.findMany({ where: { session: { course_id: courseId } }, select: { id: true, video: { select: { duration_seconds: true } }, assessment: { select: { id: true } } }, orderBy: [{ session: { sort_order: 'asc' } }, { sort_order: 'asc' }, { id: 'asc' }] })
  return readLessonLearningStates(tx, userId, lessons)
}
