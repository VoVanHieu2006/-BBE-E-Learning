export interface ChapterStage {
  startsAt: Date; endsAt: Date; memberCount: number; qualifiedCount: number; stars: number
}
/**
 * Official Chapter score: S_m = A_m / N_m.
 *
 * A_m is the total Stars earned by the Chapter in the period; N_m is the
 * time-weighted active roster in that period. Stage totals are used when a
 * transfer splits the month, so a half-month stage cannot count as a full one.
 */
export function chapterCompetitionScore(stages: ChapterStage[], kpi: string | null, options?: { coreLessonCount?: number }) {
  let elapsed = 0
  let personTime = 0
  let qualifiedTime = 0
  let totalStars = 0
  for (const stage of stages) {
    const duration = stage.endsAt.getTime() - stage.startsAt.getTime()
    if (duration <= 0 || stage.memberCount < 0 || stage.qualifiedCount < 0 || stage.qualifiedCount > stage.memberCount) throw new Error('InvalidChapterStage')
    elapsed += duration
    personTime += duration * stage.memberCount
    qualifiedTime += duration * stage.qualifiedCount
    totalStars += Number.isFinite(stage.stars) ? Math.max(0, stage.stars) : 0
  }
  const averageMemberCount = elapsed ? personTime / elapsed : 0
  const at70Rate = personTime ? qualifiedTime / personTime : 0
  const exclusionReasons: string[] = []
  let dataError: string | null = null
  let finalScore: number | null = averageMemberCount > 0 ? totalStars / averageMemberCount : 0

  if (averageMemberCount === 0) {
    exclusionReasons.push('ROSTER_ZERO')
    dataError = 'ROSTER_ZERO'
    finalScore = null
  } else if (options && options.coreLessonCount !== undefined && options.coreLessonCount === 0) {
    exclusionReasons.push('CORE_LESSONS_ZERO')
    dataError = 'CORE_LESSONS_ZERO'
    finalScore = null
  }

  if (averageMemberCount <= 20 && !exclusionReasons.includes('ROSTER_ZERO')) {
    exclusionReasons.push('MEMBER_COUNT_NOT_ABOVE_20')
  }
  if (at70Rate < 0.5 && !exclusionReasons.includes('CORE_LESSONS_ZERO')) {
    exclusionReasons.push('CORE_COMPLETION_BELOW_50_PERCENT')
  }
  if (!kpi) {
    exclusionReasons.push('WAITING_KPI')
  } else if (!['YELLOW', 'GREEN'].includes(kpi)) {
    exclusionReasons.push('KPI_NOT_ELIGIBLE')
  }

  return {
    score: finalScore,
    totalStars,
    averageMemberCount,
    at70Rate,
    eligible: exclusionReasons.length === 0,
    exclusionReasons,
    ...(dataError ? { dataError } : {}),
  }
}

export function competitionGroup(role: string, positionCodes: string[], dna: boolean) {
  if (role !== 'MEMBER' || positionCodes.some((code) => ['DNA_LEAD', 'DNA_MANAGER', 'CHAPTER_LEAD', 'TT', 'TRAINEE'].includes(code))) return null
  if (dna) return 'DNA' as const
  return positionCodes.some((code) => ['PRESIDENT', 'CHAPTER_PRESIDENT', 'DEPARTMENT_LEAD', 'DEPARTMENT_LEADER'].includes(code)) ? 'LT' as const : 'MEMBER' as const
}
