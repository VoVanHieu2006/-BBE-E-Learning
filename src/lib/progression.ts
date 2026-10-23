import { currentCycleAttemptFilter } from './learning-periods'
import { prisma } from './prisma'
import { hasWatchedFullVideo } from './video-progress-rules'
import { evaluateCourseFinalRequirements } from './course-final-assessment-rules'

export type ProgressionAction = 'VIEW' | 'WATCH' | 'ASSESS'

export type ProgressionDecision =
  | { ok: true; courseId: string; canEarnStars: boolean }
  | { ok: false; code: 'NotAssigned' | 'PreviousLessonIncomplete' | 'AssessmentNotAllowed' | 'LessonVideoIncomplete' | 'LessonAssessmentRequired'; message: string }

export type CourseFinalProgressionDecision =
  | { ok: true; courseId: string; canEarnStars: boolean }
  | { ok: false; code: string; message: string }

/** Final exams open only after every course video and every configured lesson quiz is passed. */
export async function checkCourseFinalProgression(
  userId: string,
  courseId: string,
  isAdmin = false,
): Promise<CourseFinalProgressionDecision> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      status: true,
      final_assessment: { select: { id: true } },
      sessions: {
        select: {
          sort_order: true,
          lessons: {
            select: {
              id: true,
              sort_order: true,
              video: { select: { duration_seconds: true } },
              assessment: { select: { id: true } },
            },
            orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
          },
        },
        orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      },
    },
  })
  if (!course) return { ok: false, code: 'CourseNotFound', message: 'Khóa học không tồn tại.' }
  if (!course.final_assessment) return { ok: false, code: 'FinalAssessmentNotFound', message: 'Khóa học chưa có bài thi cuối khóa.' }
  if (isAdmin) return { ok: true, courseId, canEarnStars: false }
  if (course.status !== 'PUBLISHED') return { ok: false, code: 'NotAssigned', message: 'Khóa học chưa xuất bản.' }

  const cycle = await prisma.learningCycle.findFirst({ where: { user_id: userId, ends_at: null }, select: { id: true } })
  const cycleFilter = await currentCycleAttemptFilter(prisma, userId)
  const assignments = await prisma.userLearningAssignment.findMany({
    where: { user_id: userId, course_id: courseId, ended_at: null },
    select: { can_view: true, can_assess: true, can_earn_stars: true },
  })
  const canAccessPublished = course.status === 'PUBLISHED'
  if (!canAccessPublished && (!assignments.length || !assignments.every((assignment) => assignment.can_view))) {
    return { ok: false, code: 'NotAssigned', message: 'Khóa học chưa được gán vào lộ trình học của bạn.' }
  }
  if (!canAccessPublished && !assignments.every((assignment) => assignment.can_assess)) {
    return { ok: false, code: 'AssessmentNotAllowed', message: 'Bạn chưa được cấp quyền làm bài thi trong khóa học này.' }
  }

  const lessons = course.sessions.flatMap((session) => session.lessons)
  const lessonIds = lessons.map((lesson) => lesson.id)
  let watchedByLesson = new Map<string, number>()
  if (cycle && lessonIds.length) {
    const cycleProgress = await prisma.cycleLessonProgress.findMany({
      where: { user_id: userId, learning_cycle_id: cycle.id, lesson_id: { in: lessonIds } },
      select: { lesson_id: true, furthest_seconds: true },
    })
    watchedByLesson = new Map(cycleProgress.map((row) => [row.lesson_id, row.furthest_seconds || 0]))
  } else if (lessonIds.length) {
    const progress = await prisma.lessonProgress.findMany({
      where: { user_id: userId, lesson_id: { in: lessonIds } },
      select: { lesson_id: true, furthest_watched_position_seconds: true },
    })
    watchedByLesson = new Map(progress.map((row) => [row.lesson_id, row.furthest_watched_position_seconds || 0]))
  }
  const passedIds = lessons.flatMap((lesson) => lesson.assessment ? [lesson.assessment.id] : [])
  const passedAttempts = passedIds.length
    ? await prisma.attempt.findMany({
        where: {
          user_id: userId,
          assessment_id: { in: passedIds },
          ...cycleFilter,
          passed: true,
          status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
        },
        select: { assessment_id: true },
        distinct: ['assessment_id'],
      })
    : []
  const passedAssessmentIds = new Set(passedAttempts.map((attempt) => attempt.assessment_id))
  const requirements = evaluateCourseFinalRequirements(
    lessons.map((lesson) => ({
      videoComplete: !lesson.video || hasWatchedFullVideo(
        watchedByLesson.get(lesson.id) || 0,
        lesson.video.duration_seconds || 0,
      ),
      assessmentId: lesson.assessment?.id || null,
    })),
    passedAssessmentIds,
  )
  if (requirements.ok === false) return requirements
  return { ok: true, courseId, canEarnStars: false }
}

/**
 * Server-side gate for ordered learning. Learners complete videos in order,
 * then all assessments attached to a module, before entering the next module.
 * Assessments are stored against lessons, so the containing session is treated
 * as the module/checkpoint boundary.
 */
export async function checkLessonProgression(
  userId: string,
  lessonId: string,
  action: ProgressionAction,
  isAdmin = false,
): Promise<ProgressionDecision> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    relationLoadStrategy: 'join',
    select: { id: true, session_id: true, session: { select: { course_id: true, course: { select: { status: true } } } } },
  })
  if (!lesson) return { ok: false, code: 'NotAssigned', message: 'Bài học không tồn tại' }
  const courseId = lesson.session.course_id

  if (isAdmin) return { ok: true, courseId, canEarnStars: false }
  if (lesson.session.course.status !== 'PUBLISHED') return { ok: false, code: 'NotAssigned', message: 'Khóa học chưa xuất bản.' }

  // Most video loads are for the first lesson of a course. Resolve only its id
  // first, avoiding a full curriculum + progress scan on the hot path.
  const firstLesson = await prisma.lesson.findFirst({
    where: { session: { course_id: courseId } },
    orderBy: [{ session: { sort_order: 'asc' } }, { sort_order: 'asc' }, { id: 'asc' }],
    select: { id: true },
  })
  if (firstLesson?.id === lessonId) {
    if (action === 'ASSESS') {
      const cycle = await prisma.learningCycle.findFirst({ where: { user_id: userId, ends_at: null }, select: { id: true } })
      const progress = cycle
        ? await prisma.cycleLessonProgress.findUnique({
            where: { user_id_lesson_id_learning_cycle_id: { user_id: userId, lesson_id: lessonId, learning_cycle_id: cycle.id } },
            select: { furthest_seconds: true },
          })
        : await prisma.lessonProgress.findUnique({ where: { user_id_lesson_id: { user_id: userId, lesson_id: lessonId } }, select: { furthest_watched_position_seconds: true } })
      const furthest = cycle ? (progress as any)?.furthest_seconds || 0 : (progress as any)?.furthest_watched_position_seconds || 0
      const duration = await prisma.video.findUnique({ where: { lesson_id: lessonId }, select: { duration_seconds: true } })
      if (!hasWatchedFullVideo(furthest, duration?.duration_seconds || 0)) {
        return { ok: false, code: 'LessonVideoIncomplete', message: 'Hãy hoàn thành video bài giảng trước khi làm quiz' }
      }
    }
    return { ok: true, courseId, canEarnStars: false }
  }

  const lessons = await prisma.lesson.findMany({
    where: { session: { course_id: courseId } },
    relationLoadStrategy: 'join',
    select: {
      id: true,
      session_id: true,
      session: { select: { sort_order: true } },
      video: { select: { duration_seconds: true } },
      assessment: { select: { id: true } },
    },
    orderBy: [{ session: { sort_order: 'asc' } }, { sort_order: 'asc' }, { id: 'asc' }],
  })
  const currentIndex = lessons.findIndex((item) => item.id === lessonId)
  if (currentIndex < 0) return { ok: false, code: 'NotAssigned', message: 'Bài học không tồn tại trong khóa học' }
  const current = lessons[currentIndex]
  const cycle = await prisma.learningCycle.findFirst({ where: { user_id: userId, ends_at: null }, select: { id: true, provenance: true } })
  const earnedUnlock = cycle ? await prisma.cycleLessonProgress.findUnique({ where: { user_id_lesson_id_learning_cycle_id: { user_id: userId, lesson_id: lessonId, learning_cycle_id: cycle.id } }, select: { unlocked_at: true } }) : null

  // Fast path for the first lesson: there are no previous videos/quizzes to
  // inspect, so a watch heartbeat needs only the course status already checked
  // above. An ASSESS action still verifies the current video once.
  if (currentIndex === 0) {
    if (action === 'ASSESS' && current.video) {
      const progress = cycle
        ? await prisma.cycleLessonProgress.findUnique({
            where: { user_id_lesson_id_learning_cycle_id: { user_id: userId, lesson_id: lessonId, learning_cycle_id: cycle.id } },
            select: { furthest_seconds: true },
          })
        : await prisma.lessonProgress.findUnique({ where: { user_id_lesson_id: { user_id: userId, lesson_id: lessonId } }, select: { furthest_watched_position_seconds: true } })
      const furthest = cycle ? (progress as any)?.furthest_seconds || 0 : (progress as any)?.furthest_watched_position_seconds || 0
      if (!hasWatchedFullVideo(furthest, current.video.duration_seconds || 0)) {
        return { ok: false, code: 'LessonVideoIncomplete', message: 'Hãy hoàn thành video bài giảng trước khi làm quiz' }
      }
    }
    return { ok: true, courseId, canEarnStars: false }
  }

  const previousLessons = lessons.slice(0, currentIndex)
  const relevantLessons = action === 'ASSESS' ? [...previousLessons, current] : previousLessons
  const relevantLessonIds = relevantLessons.map((item) => item.id)

  let watchedByLesson = new Map<string, number>()
  if (cycle && relevantLessonIds.length) {
    const cycleProgressRows = await prisma.cycleLessonProgress.findMany({
      where: { user_id: userId, learning_cycle_id: cycle.id, lesson_id: { in: relevantLessonIds } },
      select: { lesson_id: true, furthest_seconds: true },
    })
    watchedByLesson = new Map(cycleProgressRows.map((row) => [row.lesson_id, row.furthest_seconds || 0]))
  } else if (relevantLessonIds.length) {
    const progressRows = await prisma.lessonProgress.findMany({
      where: { user_id: userId, lesson_id: { in: relevantLessonIds } },
      select: { lesson_id: true, furthest_watched_position_seconds: true },
    })
    watchedByLesson = new Map(progressRows.map((row) => [row.lesson_id, row.furthest_watched_position_seconds || 0]))
  }

  const videoIsComplete = (item: typeof lessons[number]) => {
    if (!item.video) return true
    const duration = item.video.duration_seconds || 0
    return hasWatchedFullVideo(watchedByLesson.get(item.id) || 0, duration)
  }

  // Every earlier video must be complete
  if (!earnedUnlock?.unlocked_at && previousLessons.some((item) => !videoIsComplete(item))) {
    return { ok: false, code: 'PreviousLessonIncomplete', message: 'Bạn cần hoàn thành video trước đó trước khi tiếp tục' }
  }

  // Assessment(s) in earlier lessons are the checkpoint that unlocks this one.
  const requiredAssessmentIds = previousLessons.flatMap((item) => item.assessment ? [item.assessment.id] : [])
  if (requiredAssessmentIds.length && !earnedUnlock?.unlocked_at) {
    const cycleFilter = await currentCycleAttemptFilter(prisma, userId)
    const passedAttempts = await prisma.attempt.findMany({
      where: {
        user_id: userId,
        assessment_id: { in: requiredAssessmentIds },
        ...cycleFilter,
        passed: true,
        status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
      },
      select: { assessment_id: true },
      distinct: ['assessment_id'],
    })
    const passedIds = new Set(passedAttempts.map((attempt) => attempt.assessment_id))
    if (requiredAssessmentIds.some((id) => !passedIds.has(id))) {
      return { ok: false, code: 'LessonAssessmentRequired', message: 'Bạn cần đạt bài kiểm tra của bài trước để mở nội dung tiếp theo' }
    }
  }

  // Video of current lesson must be complete before assessment starts.
  if (action === 'ASSESS' && !videoIsComplete(current)) {
    return { ok: false, code: 'LessonVideoIncomplete', message: 'Hãy hoàn thành video bài giảng trước khi làm quiz' }
  }

  return { ok: true, courseId, canEarnStars: false }
}
