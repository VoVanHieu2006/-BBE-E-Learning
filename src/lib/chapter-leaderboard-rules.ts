export type ChapterKpiStatus = 'BLACK' | 'RED' | 'YELLOW' | 'GREEN'

export const CHAPTER_LEADERBOARD_WEIGHTS = {
  completion: 30,
  stars: 30,
  chapterSize: 20,
  greenKpiBonus: 20,
} as const

export interface ChapterLeaderboardMetrics {
  memberCount: number
  averageCompletion: number
  medianCompletion: number
  at70Rate: number
  averageStars: number
  kpiStatus: ChapterKpiStatus
  eligible: boolean
  completionScore: number
  sizeScore: number
}

export interface ChapterLeaderboardScore {
  starScore: number
  kpiBonus: number
  score: number
}

export interface MandatoryCourseRequirement {
  userId: string
  lessonIds: readonly string[]
  lessonAssessmentIds?: readonly string[]
  finalAssessmentId?: string | null
  canView?: boolean
  canAssess?: boolean
}

const finiteNonNegative = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0

/**
 * Completion is measured over the required milestones in each active mandatory
 * assignment: one video milestone per lesson, plus quizzes the learner is
 * permitted to take. Learners with no active required milestones remain at 0%.
 */
export function calculateMandatoryCompletionPercentByUser(
  userIds: readonly string[],
  assignments: readonly MandatoryCourseRequirement[],
  completedLessonIdsByUser: ReadonlyMap<string, ReadonlySet<string>>,
  passedAssessmentIdsByUser: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, number> {
  const requiredByUser = new Map(userIds.map((userId) => [userId, new Set<string>()]))
  for (const assignment of assignments) {
    if (assignment.canView === false) continue
    const requirements = requiredByUser.get(assignment.userId)
    if (!requirements) continue

    for (const lessonId of assignment.lessonIds) requirements.add(`video:${lessonId}`)
    if (assignment.canAssess !== false) {
      for (const assessmentId of assignment.lessonAssessmentIds || []) {
        requirements.add(`assessment:${assessmentId}`)
      }
      if (assignment.finalAssessmentId) requirements.add(`assessment:${assignment.finalAssessmentId}`)
    }
  }

  const completion = new Map<string, number>()
  for (const userId of userIds) {
    const required = requiredByUser.get(userId) || new Set<string>()
    if (!required.size) {
      completion.set(userId, 0)
      continue
    }

    const completedLessons = completedLessonIdsByUser.get(userId) || new Set<string>()
    const passedAssessments = passedAssessmentIdsByUser.get(userId) || new Set<string>()
    let completedCount = 0
    required.forEach((requirement) => {
      if (requirement.startsWith('video:') && completedLessons.has(requirement.slice('video:'.length))) completedCount++
      if (requirement.startsWith('assessment:') && passedAssessments.has(requirement.slice('assessment:'.length))) completedCount++
    })
    completion.set(userId, (completedCount / required.size) * 100)
  }
  return completion
}

export function parseChapterKpiMonthStart(input: unknown): Date | null {
  if (typeof input !== 'string') return null
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(input)
  if (!match) return null
  const year = Number(match[1])
  if (year < 1970 || year > 9999) return null
  return new Date(`${match[1]}-${match[2]}-01T00:00:00.000Z`)
}

export function normalizeChapterKpiInput(input: unknown): {
  monthStart: Date
  status: ChapterKpiStatus
  note: string | null
} | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const body = input as Record<string, unknown>
  const monthStart = parseChapterKpiMonthStart(body.month)
  const status = body.status
  const note = body.note
  if (!monthStart || (status !== 'BLACK' && status !== 'RED' && status !== 'YELLOW' && status !== 'GREEN')) return null
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.trim().length > 500)) return null
  return { monthStart, status, note: typeof note === 'string' ? note.trim() || null : null }
}

export function calculateChapterLeaderboardMetrics(
  rawCompletions: number[],
  rawAverageStars: number,
  kpiStatus: ChapterKpiStatus,
): ChapterLeaderboardMetrics {
  const completions = rawCompletions.map((value) =>
    Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0,
  )
  const memberCount = completions.length
  const sorted = [...completions].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const medianCompletion = sorted.length === 0 ? 0 : sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  const averageCompletion = memberCount
    ? completions.reduce((sum, value) => sum + value, 0) / memberCount
    : 0
  const at70Rate = memberCount
    ? completions.filter((completion) => completion >= 70).length / memberCount
    : 0
  const completionScore = averageCompletion
  // The size component grows linearly and reaches its cap at 51 members.
  const sizeScore = Math.min(100, (memberCount / 51) * 100)

  return {
    memberCount,
    averageCompletion,
    medianCompletion,
    at70Rate,
    averageStars: finiteNonNegative(rawAverageStars),
    kpiStatus,
    eligible: memberCount >= 20 && at70Rate >= 0.5 && kpiStatus !== 'RED' && kpiStatus !== 'BLACK',
    completionScore,
    sizeScore,
  }
}

export function scoreChapterLeaderboard(
  metrics: ChapterLeaderboardMetrics,
): ChapterLeaderboardScore {
  const starScore = metrics.averageStars
  const kpiBonus = metrics.kpiStatus === 'GREEN' ? CHAPTER_LEADERBOARD_WEIGHTS.greenKpiBonus : 0
  const score = metrics.completionScore * (CHAPTER_LEADERBOARD_WEIGHTS.completion / 100)
    + starScore * (CHAPTER_LEADERBOARD_WEIGHTS.stars / 100)
    + metrics.sizeScore * (CHAPTER_LEADERBOARD_WEIGHTS.chapterSize / 100)
    + kpiBonus

  return { starScore, kpiBonus, score }
}
