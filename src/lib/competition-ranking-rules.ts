export interface ChapterStage {
  startsAt: Date; endsAt: Date; memberCount: number; qualifiedCount: number; stars: number
}
/** Segment totals belong to the term containing the month's closing boundary. */
export function chapterCompetitionScore(stages: ChapterStage[], kpi: string | null) {
  let elapsed = 0, personTime = 0, qualifiedTime = 0, score = 0
  for (const stage of stages) {
    const duration = stage.endsAt.getTime() - stage.startsAt.getTime()
    if (duration <= 0 || stage.memberCount < 0 || stage.qualifiedCount < 0 || stage.qualifiedCount > stage.memberCount) throw new Error('InvalidChapterStage')
    elapsed += duration
    personTime += duration * stage.memberCount
    qualifiedTime += duration * stage.qualifiedCount
    if (stage.memberCount > 0) score += stage.stars / stage.memberCount
  }
  const averageMemberCount = elapsed ? personTime / elapsed : 0
  const at70Rate = personTime ? qualifiedTime / personTime : 0
  const exclusionReasons = []
  if (averageMemberCount <= 20) exclusionReasons.push('MEMBER_COUNT_NOT_ABOVE_20')
  if (at70Rate < 0.5) exclusionReasons.push('CORE_COMPLETION_BELOW_50_PERCENT')
  if (!kpi) exclusionReasons.push('WAITING_KPI')
  else if (!['YELLOW', 'GREEN'].includes(kpi)) exclusionReasons.push('KPI_NOT_ELIGIBLE')
  return { score, averageMemberCount, at70Rate, eligible: exclusionReasons.length === 0, exclusionReasons }
}

export function competitionGroup(role: string, positionCodes: string[], dna: boolean) {
  if (role !== 'MEMBER' || positionCodes.some((code) => ['DNA_LEAD', 'DNA_MANAGER', 'CHAPTER_LEAD', 'TT', 'TRAINEE'].includes(code))) return null
  if (dna) return 'DNA' as const
  return positionCodes.some((code) => ['PRESIDENT', 'CHAPTER_PRESIDENT', 'DEPARTMENT_LEAD', 'DEPARTMENT_LEADER'].includes(code)) ? 'LT' as const : 'MEMBER' as const
}
