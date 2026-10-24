export interface ChapterStage {
  startsAt: Date
  endsAt: Date
  memberCount: number
  qualifiedCount: number
  stars: number
  lastStarAwardedAt?: Date | null
}

export interface ChapterStageResult extends ChapterStage {
  stageScore: number | null
}

/**
 * Official Chapter Competition Score:
 * - Normal month (no transfer, 1 stage):
 *     S_m = A_m / N_m
 *     Where A_m is total valid Stars; N_m is valid chapter member count at month end.
 * - Transfer month (split by reorganization, >= 2 stages):
 *     S_m = sum_i (A_i / N_i) = A_1 / N_1 + A_2 / N_2 + ...
 *     Where A_i is valid Stars in stage i; N_i is snapshot member count in stage i.
 * - Scale condition:
 *     N_m > 20 (normal) or N_avg = (sum N_i * T_i) / (sum T_i) > 20 (transfer month).
 * - Progress condition:
 *     R >= 0.5 (50%), where R = Q_m / N_m (normal) or (sum Q_i * T_i) / (sum N_i * T_i) (transfer).
 * - KPI condition: YELLOW or GREEN.
 */
export function chapterCompetitionScore(
  stages: ChapterStage[],
  kpi: string | null,
  options?: { coreLessonCount?: number }
) {
  if (!stages || stages.length === 0) {
    return {
      score: null,
      totalStars: 0,
      averageMemberCount: 0,
      at70Rate: 0,
      eligible: false,
      exclusionReasons: ['ROSTER_ZERO'],
      dataError: 'ROSTER_ZERO',
      stageResults: [],
    }
  }

  let elapsed = 0
  let personTime = 0
  let qualifiedTime = 0
  let totalStars = 0
  let hasZeroRoster = false

  for (const stage of stages) {
    const duration = stage.endsAt.getTime() - stage.startsAt.getTime()
    if (duration <= 0 || stage.memberCount < 0 || stage.qualifiedCount < 0 || stage.qualifiedCount > stage.memberCount) {
      throw new Error('InvalidChapterStage')
    }
    if (stage.memberCount === 0) {
      hasZeroRoster = true
    }
    elapsed += duration
    personTime += duration * stage.memberCount
    qualifiedTime += duration * stage.qualifiedCount
    totalStars += Number.isFinite(stage.stars) ? Math.max(0, stage.stars) : 0
  }

  const exclusionReasons: string[] = []
  let dataError: string | null = null

  if (hasZeroRoster) {
    exclusionReasons.push('ROSTER_ZERO')
    dataError = 'ROSTER_ZERO'
  } else if (options && options.coreLessonCount !== undefined && options.coreLessonCount === 0) {
    exclusionReasons.push('CORE_LESSONS_ZERO')
    dataError = 'CORE_LESSONS_ZERO'
  }

  let finalScore: number | null = null
  let averageMemberCount = 0
  let at70Rate = 0

  if (!hasZeroRoster && !dataError) {
    if (stages.length === 1) {
      // Normal month: S_m = A_m / N_m
      const single = stages[0]
      finalScore = single.stars / single.memberCount
      averageMemberCount = single.memberCount
      at70Rate = single.memberCount > 0 ? single.qualifiedCount / single.memberCount : 0
    } else {
      // Transfer month: S_m = A_1 / N_1 + A_2 / N_2 + ...
      finalScore = stages.reduce((sum, s) => sum + (s.stars / s.memberCount), 0)
      averageMemberCount = elapsed > 0 ? personTime / elapsed : 0
      at70Rate = personTime > 0 ? qualifiedTime / personTime : 0
    }
  }

  // Conditions
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

  const stageResults: ChapterStageResult[] = stages.map((s) => ({
    ...s,
    stageScore: s.memberCount > 0 ? s.stars / s.memberCount : null,
  }))

  return {
    score: finalScore,
    totalStars,
    averageMemberCount,
    at70Rate,
    eligible: exclusionReasons.length === 0 && !dataError,
    exclusionReasons,
    stageResults,
    ...(dataError ? { dataError } : {}),
  }
}

export function competitionGroup(role: string, positionCodes: string[], dna: boolean) {
  if (role !== 'MEMBER' || positionCodes.some((code) => ['DNA_LEAD', 'DNA_MANAGER', 'CHAPTER_LEAD', 'CHAPTER_MANAGER', 'TT', 'TRAINEE'].includes(code))) return null
  if (dna) return 'DNA' as const
  return positionCodes.some((code) => ['PRESIDENT', 'CHAPTER_PRESIDENT', 'DEPARTMENT_LEAD', 'DEPARTMENT_LEADER'].includes(code)) ? 'LT' as const : 'MEMBER' as const
}
