import { attemptScorePercent } from '@/lib/course-progress-display'

/** Admin/BĐHU audit view of every course → module → lesson (video + quiz), built from stored records only. */

type Score = number | string | { toString(): string } | null

export interface DetailAttempt {
  id: string
  attempt_number: number
  score: Score
  passed: boolean
  status: string
  submitted_at: Date | null
}

export interface DetailLegacyProgress {
  completed: boolean
  completed_at: Date | null
  furthest_watched_position_seconds: number | null
  last_watched_at: Date | null
}

export interface DetailCycleProgress {
  lesson_id: string
  furthest_seconds: number
  completed_at: Date | null
}

export interface DetailCourse {
  id: string
  title: string
  final_assessment: { id: string; title: string; attempts: DetailAttempt[] } | null
  sessions: Array<{
    id: string
    title: string
    sort_order: number
    lessons: Array<{
      id: string
      title: string
      sort_order: number
      video: { id: string; title: string | null; duration_seconds: number } | null
      progress: DetailLegacyProgress[]
      assessment: { id: string; title: string; attempts: DetailAttempt[] } | null
    }>
  }>
}

function latestAttemptView(attempt: DetailAttempt | undefined) {
  if (!attempt) return null
  return {
    attemptId: attempt.id,
    number: attempt.attempt_number,
    scorePercent: attemptScorePercent(attempt.score),
    passed: attempt.passed,
    status: attempt.status,
    submittedAt: attempt.submitted_at,
  }
}

/** Best whole percent over the given attempts, null when none has a score. */
export function bestAttemptScorePercent(attempts: DetailAttempt[]): number | null {
  let best: number | null = null
  for (const attempt of attempts) {
    const percent = attemptScorePercent(attempt.score)
    if (percent !== null && (best === null || percent > best)) best = percent
  }
  return best
}

/**
 * Attempts must already be scoped to the active learning cycle and sorted newest first.
 * `cycleProgress` is the active cycle's lesson progress; pass null for a user without a cycle (legacy rows are used).
 */
export function buildLearningDetail(
  courses: DetailCourse[],
  starsBySource: Map<string, number>,
  cycleProgress: DetailCycleProgress[] | null,
) {
  const cycleByLesson = cycleProgress ? new Map(cycleProgress.map((row) => [row.lesson_id, row])) : null
  return courses.map((course) => ({
    courseId: course.id,
    title: course.title,
    finalAssessment: course.final_assessment && {
      assessmentId: course.final_assessment.id,
      title: course.final_assessment.title,
      attemptCount: course.final_assessment.attempts.length,
      stars: starsBySource.get(`ASSESSMENT:${course.final_assessment.id}`) || 0,
      everPassed: course.final_assessment.attempts.some((attempt) => attempt.passed),
      bestScorePercent: bestAttemptScorePercent(course.final_assessment.attempts),
      latestAttempt: latestAttemptView(course.final_assessment.attempts[0]),
    },
    modules: course.sessions.map((session) => ({
      moduleId: session.id,
      title: session.title,
      order: session.sort_order,
      lessons: session.lessons.map((lesson) => {
        const duration = lesson.video?.duration_seconds || 0
        const cycleRow = cycleByLesson ? cycleByLesson.get(lesson.id) : undefined
        const legacy = cycleByLesson ? undefined : lesson.progress[0]
        const watchedSeconds = cycleByLesson
          ? Math.floor(cycleRow?.furthest_seconds || 0)
          : legacy?.furthest_watched_position_seconds || 0
        // In a cycle, completion is the cycle's completed_at — the same truth calculateUserProgress uses.
        const completed = cycleByLesson
          ? Boolean(cycleRow?.completed_at)
          : duration > 0 ? watchedSeconds >= duration : Boolean(legacy?.completed)
        const attempts = lesson.assessment?.attempts || []
        return {
          lessonId: lesson.id,
          title: lesson.title,
          order: lesson.sort_order,
          video: lesson.video && {
            videoId: lesson.video.id,
            title: lesson.video.title,
            durationSeconds: duration,
            watchedSeconds,
            watchedPercent: completed ? 100 : duration > 0 ? Math.min(100, Math.floor((watchedSeconds / duration) * 100)) : 0,
            completed,
            stars: starsBySource.get(`VIDEO:${lesson.video.id}`) || 0,
            completedAt: (cycleByLesson ? cycleRow?.completed_at : legacy?.completed_at) || null,
            lastWatchedAt: (cycleByLesson ? null : legacy?.last_watched_at) || null,
          },
          quiz: lesson.assessment && {
            assessmentId: lesson.assessment.id,
            title: lesson.assessment.title,
            attemptCount: attempts.length,
            stars: starsBySource.get(`ASSESSMENT:${lesson.assessment.id}`) || 0,
            everPassed: attempts.some((attempt) => attempt.passed),
            bestScorePercent: bestAttemptScorePercent(attempts),
            latestAttempt: latestAttemptView(attempts[0]),
          },
        }
      }),
    })),
  }))
}

export function sumStarsBySource(entries: Array<{ amount: number; source_type: string; source_id: string }>) {
  const starsBySource = new Map<string, number>()
  for (const entry of entries) {
    const key = `${entry.source_type}:${entry.source_id}`
    starsBySource.set(key, (starsBySource.get(key) || 0) + entry.amount)
  }
  return starsBySource
}
