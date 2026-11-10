import { Prisma } from '@prisma/client'
import { hasWatchedFullVideo, endedCompletionToleranceSeconds } from './video-progress-rules'

export type LearningLesson = {
  id: string
  courseId?: string
  /** Dùng cho nhãn "Mới" (KHBB 6.1). Bài chưa có `created_at` thì không bao giờ được coi là mới. */
  created_at?: Date | string | null
  video: { duration_seconds: number | null } | null
  assessment: { id: string; created_at?: Date | string | null } | null
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
  /** Bài được thêm sau lần tương tác đầu tiên của người học với khóa và người học chưa xong bài đó. */
  isNew: boolean
  /** Quiz được thêm/tạo lại sau lần tương tác đầu tiên và người học chưa đạt. */
  quizIsNew: boolean
  /** Đã đạt quiz của bài (khác `lessonCompleted`). Bài không có quiz thì false. */
  assessmentPassed: boolean
}

const toTime = (value: Date | string | null | undefined) => {
  if (!value) return null
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

/** Mốc tương tác đầu tiên của người học với khóa: sớm nhất của `unlocked_at`/`completed_at`. */
export function firstInteractionAt(rows: { unlocked_at?: Date | null; completed_at?: Date | null }[]): Date | null {
  let earliest: number | null = null
  for (const row of rows) {
    for (const value of [row.unlocked_at, row.completed_at]) {
      const time = toTime(value)
      if (time !== null && (earliest === null || time < earliest)) earliest = time
    }
  }
  return earliest === null ? null : new Date(earliest)
}

/** Một bài/quiz là "mới" với người học: tạo sau mốc tương tác đầu tiên và người học chưa hoàn thành. Chưa tương tác = không có nhãn. */
export function isNewForLearner(createdAt: Date | string | null | undefined, anchor: Date | null, done: boolean): boolean {
  if (done || !anchor) return false
  const created = toTime(createdAt)
  return created !== null && created > anchor.getTime()
}

export interface LessonStateInputs {
  cycleId: string | null
  lessons: LearningLesson[]
  /** Tiến độ theo chu kỳ (có chu kỳ) hoặc tiến độ cũ (không chu kỳ). */
  cycleProgress: Map<string, { completed_at: Date | null; unlocked_at: Date | null; furthest_seconds: number }>
  legacyProgress: Map<string, { completed: boolean; furthest_watched_position_seconds: number }>
  passedAssessmentIds: Set<string>
  /** Mốc tương tác đầu tiên theo khóa học (khóa `''` khi lesson không có courseId). */
  anchorByCourse: Map<string, Date | null>
}

/**
 * Tính trạng thái từng bài. Bài/quiz "mới" chưa xong KHÔNG chặn việc mở các bài sau (KHBB 6.1), nhưng vẫn
 * bắt buộc để tính hoàn thành khóa và để thi cuối (kiểm tra ở `checkCourseFinalProgression`).
 */
export function buildLessonStates(input: LessonStateInputs): Record<string, LessonLearningState> {
  const { cycleId, lessons, cycleProgress, legacyProgress, passedAssessmentIds, anchorByCourse } = input
  const hasCycle = Boolean(cycleId)
  let previousVideoIncomplete = false
  let previousQuizIncomplete = false
  const states: Record<string, LessonLearningState> = {}
  let previousCourseId: string | undefined
  for (const lesson of lessons) {
    if (lesson.courseId !== previousCourseId) { previousVideoIncomplete = false; previousQuizIncomplete = false }
    previousCourseId = lesson.courseId
    const row = cycleProgress.get(lesson.id), old = legacyProgress.get(lesson.id)
    const lessonCompleted = hasCycle ? Boolean(row?.completed_at) : Boolean(old?.completed)
    const furthest = hasCycle ? row?.furthest_seconds || 0 : old?.furthest_watched_position_seconds || 0
    const duration = lesson.video?.duration_seconds || 0
    const videoCompleted = !lesson.video || lessonCompleted || hasWatchedFullVideo(furthest, duration)
      || (duration > 0 && furthest >= duration - endedCompletionToleranceSeconds(duration))
    const unlocked = Boolean(hasCycle && row?.unlocked_at)
    const assessmentPassed = Boolean(lesson.assessment && passedAssessmentIds.has(lesson.assessment.id))
    const anchor = anchorByCourse.get(lesson.courseId || '') ?? null
    const isNew = isNewForLearner(lesson.created_at, anchor, lessonCompleted)
    const quizIsNew = Boolean(lesson.assessment) && isNewForLearner(lesson.assessment?.created_at, anchor, assessmentPassed)
    // A completed video is sufficient to revisit it; it does not pass its quiz.
    // Bài đã xong luôn xem lại được, kể cả khi người học chưa có chu kỳ (không bị khóa lại vì bài chèn phía trước).
    const earnedReview = lessonCompleted || Boolean(hasCycle && ((lesson.video && videoCompleted) || unlocked))
    const lockReason = earnedReview ? null : previousVideoIncomplete ? 'PreviousLessonIncomplete' : previousQuizIncomplete ? 'LessonAssessmentRequired' : null
    states[lesson.id] = {
      learningCycleId: cycleId, canView: !lockReason, canAssess: !lockReason && videoCompleted, videoCompleted, lessonCompleted, unlocked,
      lockReason, furthestWatchedPositionSeconds: furthest, isNew, quizIsNew, assessmentPassed,
    }
    // Phần mới chưa xong không chặn bài phía sau.
    if (!isNew) previousVideoIncomplete ||= !videoCompleted
    if (!isNew && !quizIsNew) previousQuizIncomplete ||= Boolean(lesson.assessment && !assessmentPassed)
  }
  return states
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
  const courseOfLesson = new Map(lessons.map(l => [l.id, l.courseId || '']))
  const rowsByCourse = new Map<string, { unlocked_at: Date | null; completed_at: Date | null }[]>()
  for (const row of cycleRows) {
    const key = courseOfLesson.get(row.lesson_id) ?? ''
    rowsByCourse.set(key, [...(rowsByCourse.get(key) || []), row])
  }
  const anchorByCourse = new Map(Array.from(rowsByCourse).map(([courseId, rows]) => [courseId, firstInteractionAt(rows)] as const))
  return buildLessonStates({
    cycleId: cycle?.id || null,
    lessons,
    cycleProgress: progress,
    legacyProgress: new Map(legacyRows.map(p => [p.lesson_id, p])),
    passedAssessmentIds: new Set(attempts.map(a => a.assessment_id)),
    anchorByCourse,
  })
}

export async function readCourseLearningStates(tx: Prisma.TransactionClient, userId: string, courseId: string) {
  const lessons = await tx.lesson.findMany({ where: { session: { course_id: courseId } }, select: { id: true, created_at: true, video: { select: { duration_seconds: true } }, assessment: { select: { id: true, created_at: true } } }, orderBy: [{ session: { sort_order: 'asc' } }, { sort_order: 'asc' }, { id: 'asc' }] })
  return readLessonLearningStates(tx, userId, lessons.map((lesson) => ({ ...lesson, courseId })))
}
