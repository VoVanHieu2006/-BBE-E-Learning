import { prisma } from '@/lib/prisma'
import { reconcileLearningAssignmentsForUser } from '@/lib/learning-assignments'
import { hasWatchedFullVideo } from '@/lib/video-progress-rules'
import { evaluateCourseFinalRequirements } from '@/lib/course-final-assessment-rules'

export type ProgressionAction = 'VIEW' | 'WATCH' | 'ASSESS'

export type ProgressionDecision =
  | { ok: true; courseId: string; canEarnStars: boolean }
  | { ok: false; code: 'NotAssigned' | 'PreviousModuleIncomplete' | 'AssessmentNotAllowed' | 'ModuleVideosIncomplete' | 'ModuleAssessmentRequired'; message: string }

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
            orderBy: { sort_order: 'asc' },
          },
        },
        orderBy: { sort_order: 'asc' },
      },
    },
  })
  if (!course) return { ok: false, code: 'CourseNotFound', message: 'Khóa học không tồn tại.' }
  if (!course.final_assessment) return { ok: false, code: 'FinalAssessmentNotFound', message: 'Khóa học chưa có bài thi cuối khóa.' }
  if (isAdmin) return { ok: true, courseId, canEarnStars: false }

  await reconcileLearningAssignmentsForUser(userId)
  const assignments = await prisma.userLearningAssignment.findMany({
    where: { user_id: userId, course_id: courseId, ended_at: null },
    select: { can_view: true, can_assess: true, can_earn_stars: true },
  })
  if (!assignments.length || !assignments.every((assignment) => assignment.can_view)) {
    return { ok: false, code: 'NotAssigned', message: 'Khóa học chưa được gán vào lộ trình học của bạn.' }
  }
  if (!assignments.every((assignment) => assignment.can_assess)) {
    return { ok: false, code: 'AssessmentNotAllowed', message: 'Bạn chưa được cấp quyền làm bài thi trong khóa học này.' }
  }

  const lessons = course.sessions.flatMap((session) => session.lessons)
  const lessonIds = lessons.map((lesson) => lesson.id)
  const progress = lessonIds.length
    ? await prisma.lessonProgress.findMany({
        where: { user_id: userId, lesson_id: { in: lessonIds } },
        select: { lesson_id: true, furthest_watched_position_seconds: true },
      })
    : []
  const watchedByLesson = new Map(progress.map((row) => [row.lesson_id, row.furthest_watched_position_seconds || 0]))
  const passedIds = lessons.flatMap((lesson) => lesson.assessment ? [lesson.assessment.id] : [])
  const passedAttempts = passedIds.length
    ? await prisma.attempt.findMany({
        where: {
          user_id: userId,
          assessment_id: { in: passedIds },
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
  return { ok: true, courseId, canEarnStars: assignments.every((assignment) => assignment.can_earn_stars) }
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
    select: { id: true, session_id: true, session: { select: { course_id: true } } },
  })
  if (!lesson) return { ok: false, code: 'NotAssigned', message: 'Bài học không tồn tại' }
  const courseId = lesson.session.course_id

  if (isAdmin) return { ok: true, courseId, canEarnStars: false }

  await reconcileLearningAssignmentsForUser(userId)
  const assignments = await prisma.userLearningAssignment.findMany({
    where: { user_id: userId, course_id: courseId, ended_at: null },
    select: { can_view: true, can_assess: true, can_earn_stars: true },
  })
  if (assignments.length === 0 || !assignments.every((assignment) => assignment.can_view)) {
    return { ok: false, code: 'NotAssigned', message: 'Nội dung này chưa được gán vào lộ trình học của bạn' }
  }
  if (action === 'ASSESS' && !assignments.every((assignment) => assignment.can_assess)) {
    return { ok: false, code: 'AssessmentNotAllowed', message: 'Bạn chỉ được xem nội dung này, chưa có quyền làm bài kiểm tra' }
  }

  const lessons = await prisma.lesson.findMany({
    where: { session: { course_id: courseId } },
    select: {
      id: true,
      session_id: true,
      session: { select: { sort_order: true } },
      video: { select: { duration_seconds: true } },
      assessment: { select: { id: true } },
    },
    orderBy: [{ session: { sort_order: 'asc' } }, { sort_order: 'asc' }],
  })
  const currentIndex = lessons.findIndex((item) => item.id === lessonId)
  if (currentIndex < 0) return { ok: false, code: 'NotAssigned', message: 'Bài học không tồn tại trong khóa học' }
  const current = lessons[currentIndex]
  const previousLessons = lessons.slice(0, currentIndex)
  const currentModuleLessons = lessons.filter((item) => item.session_id === current.session_id)
  const priorModuleIds = new Set(
    previousLessons.filter((item) => item.session_id !== current.session_id).map((item) => item.session_id),
  )
  const relevantLessons = lessons.filter((item) =>
    previousLessons.some((previous) => previous.id === item.id) ||
    (action === 'ASSESS' && item.session_id === current.session_id),
  )
  const relevantLessonIds = relevantLessons.map((item) => item.id)
  const progressRows = relevantLessonIds.length
    ? await prisma.lessonProgress.findMany({
        where: { user_id: userId, lesson_id: { in: relevantLessonIds } },
        select: { lesson_id: true, furthest_watched_position_seconds: true },
      })
    : []
  const watchedByLesson = new Map(progressRows.map((row) => [row.lesson_id, row.furthest_watched_position_seconds || 0]))
  const videoIsComplete = (item: typeof lessons[number]) => {
    if (!item.video) return true
    const duration = item.video.duration_seconds || 0
    return hasWatchedFullVideo(watchedByLesson.get(item.id) || 0, duration)
  }

  // Every earlier video must be complete; within a module, videos remain
  // sequential, but the module quiz does not interrupt the video sequence.
  if (previousLessons.some((item) => !videoIsComplete(item))) {
    return { ok: false, code: 'PreviousModuleIncomplete', message: 'Bạn cần hoàn thành video trước đó trước khi tiếp tục' }
  }

  // Assessment(s) in an earlier module are the checkpoint that unlocks this one.
  const requiredAssessmentIds = lessons
    .filter((item) => priorModuleIds.has(item.session_id) && item.assessment)
    .map((item) => item.assessment!.id)
  if (requiredAssessmentIds.length) {
    const passedAttempts = await prisma.attempt.findMany({
      where: {
        user_id: userId,
        assessment_id: { in: requiredAssessmentIds },
        passed: true,
        status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
      },
      select: { assessment_id: true },
      distinct: ['assessment_id'],
    })
    const passedIds = new Set(passedAttempts.map((attempt) => attempt.assessment_id))
    if (requiredAssessmentIds.some((id) => !passedIds.has(id))) {
      return { ok: false, code: 'ModuleAssessmentRequired', message: 'Bạn cần đạt bài kiểm tra của module trước để mở nội dung tiếp theo' }
    }
  }

  // All videos in a module must be completed before any assessment in it starts.
  if (action === 'ASSESS' && currentModuleLessons.some((item) => !videoIsComplete(item))) {
    return { ok: false, code: 'ModuleVideosIncomplete', message: 'Hãy hoàn thành toàn bộ video trong module trước khi làm quiz' }
  }

  return { ok: true, courseId, canEarnStars: assignments.every((assignment) => assignment.can_earn_stars) }
}
