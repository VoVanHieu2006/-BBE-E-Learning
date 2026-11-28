/** Pure display rules for course progress (client-safe: no Prisma, no server imports). */

type ScoreLike = number | string | { toString(): string } | null | undefined

/** Attempt.score is stored as a 0..1 fraction; the UI shows a whole percent. */
export function attemptScorePercent(score: ScoreLike): number | null {
  if (score === null || score === undefined) return null
  const value = Number(score)
  return Number.isFinite(value) ? Math.round(value * 100) : null
}

/**
 * Whole percent of an attempt for display. Prefers an explicit scorePercent; otherwise reads `score`
 * as a fraction when it is ≤ 1 (1 → 100%) and as an already-converted percent when it is > 1.
 */
export function formatAttemptScorePercent(attempt: { scorePercent?: number | null; score?: ScoreLike } | null | undefined): number | null {
  if (!attempt) return null
  if (typeof attempt.scorePercent === 'number' && Number.isFinite(attempt.scorePercent)) return Math.round(attempt.scorePercent)
  if (attempt.score === null || attempt.score === undefined) return null
  const value = Number(attempt.score)
  if (!Number.isFinite(value)) return null
  return value <= 1 ? Math.round(value * 100) : Math.round(value)
}

/** "85%" or null when there is no score, so the UI never prints "null%". */
export function scorePercentLabel(attempt: Parameters<typeof formatAttemptScorePercent>[0]): string | null {
  const percent = formatAttemptScorePercent(attempt)
  return percent === null ? null : `${percent}%`
}

export interface LessonQuizSummary {
  allPassed: boolean
  passed: number
  total: number
  remaining: number
  label: string
}

/** Why a course is still "Đang học": how many lesson quizzes are passed. Null when the course has none. */
export function lessonQuizSummary(course: { totalLessonAssessments?: number | null; passedLessonAssessments?: number | null }): LessonQuizSummary | null {
  const total = Math.max(0, Math.floor(Number(course.totalLessonAssessments) || 0))
  if (total === 0) return null
  const passed = Math.min(total, Math.max(0, Math.floor(Number(course.passedLessonAssessments) || 0)))
  const remaining = total - passed
  return {
    allPassed: remaining === 0,
    passed,
    total,
    remaining,
    label: remaining === 0 ? `✓ Đạt hết (${passed}/${total})` : `${passed}/${total} bài đạt (còn ${remaining} chưa đạt)`,
  }
}

export type LessonQuizTone = 'passed' | 'ever-passed' | 'failed' | 'none'

/** One lesson quiz in the detail view. A quiz passed earlier in the cycle stays "Đã đạt" even when the latest retake failed. */
export function lessonQuizStatus(quiz: {
  everPassed?: boolean | null
  latestAttempt?: { passed?: boolean | null; scorePercent?: number | null; score?: ScoreLike } | null
} | null | undefined): { tone: LessonQuizTone; label: string } {
  const latest = quiz?.latestAttempt
  if (!latest) return { tone: 'none', label: 'Chưa thi' }
  const percent = scorePercentLabel(latest) ?? '—'
  if (latest.passed) return { tone: 'passed', label: `${percent} (Đạt)` }
  if (quiz?.everPassed) return { tone: 'ever-passed', label: `✓ Đã đạt (lần mới nhất: ${percent})` }
  return { tone: 'failed', label: `${percent} (Chưa đạt)` }
}

/** Student pages count a course as done only from the server's isCompleted, never from progress ≥ 100% alone. */
export function isCourseCompleted(course: { isCompleted?: boolean | null } | null | undefined): boolean {
  return course?.isCompleted === true
}
