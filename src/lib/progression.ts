import { currentCycleAttemptFilter } from './learning-periods'
import { prisma } from './prisma'
import { readCourseLearningStates } from './lesson-learning-state'
import { hasWatchedFullVideo, endedCompletionToleranceSeconds } from './video-progress-rules'
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
    lessons.map((lesson) => {
      const d = lesson.video?.duration_seconds || 0
      const w = watchedByLesson.get(lesson.id) || 0
      const videoComplete = !lesson.video || hasWatchedFullVideo(w, d) || (d > 0 && w >= d - endedCompletionToleranceSeconds(d))
      return {
        videoComplete,
        assessmentId: lesson.assessment?.id || null,
      }
    }),
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

  const states = await readCourseLearningStates(prisma, userId, courseId)
  const state = states[lessonId]
  if (!state) return { ok: false, code: 'NotAssigned', message: 'Bài học không tồn tại trong khóa học' }
  if (!state.canView) return {
    ok: false, code: state.lockReason!,
    message: state.lockReason === 'PreviousLessonIncomplete'
      ? 'Bạn cần hoàn thành video trước đó trước khi tiếp tục'
      : 'Bạn cần đạt bài kiểm tra của bài trước để mở nội dung tiếp theo',
  }
  if (action === 'ASSESS' && !state.canAssess) return { ok: false, code: 'LessonVideoIncomplete', message: 'Hãy hoàn thành video bài giảng trước khi làm quiz' }
  return { ok: true, courseId, canEarnStars: false }
}
