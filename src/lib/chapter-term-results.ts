import { Prisma } from '@prisma/client'

type Month = { id: string; key: string; starts_at: Date; ends_at: Date }
type LiveReader = (tx: Prisma.TransactionClient, month: Month, end: Date) => Promise<any[]>

/** Allocates immutable month stages to one actual term / initial competition interval. */
export async function readChapterTermResult(tx: Prisma.TransactionClient, chapterId: string, startsAt: Date, endsAt: Date | null, at: Date, liveReader: LiveReader, initial = false) {
  const end = new Date(Math.min(endsAt?.getTime() ?? at.getTime(), at.getTime()))
  const months = end > startsAt ? await tx.competitionMonth.findMany({ where: { starts_at: { lt: end }, ends_at: { gt: startsAt } }, orderBy: { starts_at: 'asc' } }) : []
  const results: any[] = []
  let score = 0, totalStars = 0, qualifiedMonthCount = 0, provisionalScore = 0, provisionalStars = 0
  let missing = false, waitingKpi = false
  // A missing calendar row is missing evidence too, not an empty month.
  const localStart = new Date(startsAt.getTime() + 7 * 3_600_000)
  let cursor = new Date(Date.UTC(localStart.getUTCFullYear(), localStart.getUTCMonth(), 1) - 7 * 3_600_000)
  while (cursor < end) {
    const local = new Date(cursor.getTime() + 7 * 3_600_000)
    const key = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`
    if (!months.some(month => month.key === key)) {
      missing = true
      results.push({ monthId: null, month: key, score: null, allocatedScore: 0, allocatedStars: 0, eligible: false, provisional: false, exclusionReasons: ['MONTH_NOT_CONFIGURED'], hasContributedStage: false })
    }
    cursor = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - 7 * 3_600_000)
  }
  for (const month of months) {
    const open = month.ends_at > at
    const saved = open ? null : await tx.learningSnapshot.findUnique({ where: { key: `ranking:CHAPTER:${month.id}` } })
    const payload = saved?.payload as any
    const savedItems = Array.isArray(payload?.items) ? payload.items : []
    const item = open ? (await liveReader(tx, month, at)).find(row => row?.chapterId === chapterId) : savedItems.find((row: any) => row?.chapterId === chapterId)
    let reason: string | null = !item ? 'SNAPSHOT_MISSING' : !open && !['FINALIZED', 'WAITING_KPI'].includes(payload?.state) ? 'SNAPSHOT_DATA_MISSING' : null
    if (item && (typeof item.eligible !== 'boolean' || (item.eligible === false && !Array.isArray(item.exclusionReasons)))) reason = 'SNAPSHOT_DATA_MISSING'
    if (!open && payload?.state === 'WAITING_KPI') waitingKpi = true
    const rangeStart = new Date(Math.max(startsAt.getTime(), month.starts_at.getTime()))
    const rangeEnd = new Date(Math.min(end.getTime(), month.ends_at.getTime()))
    let allocatedScore = 0, allocatedStars = 0, hasContributedStage = false
    if (item && !reason) {
      // A whole-month score needs no invented stage. Partial months require saved stage facts.
      const wholeMonth = rangeStart <= month.starts_at && rangeEnd >= month.ends_at
      const stages = Array.isArray(item.stages) && item.stages.length ? item.stages : wholeMonth ? [{ startsAt: month.starts_at, endsAt: month.ends_at, stageScore: item.score, stars: item.totalStars }] : []
      if (!stages.length) reason = 'SNAPSHOT_STAGE_DATA_MISSING'
      if (stages.some((stage: any) => !stage || typeof stage !== 'object') || (item.stages && !Array.isArray(item.stages))) reason = 'SNAPSHOT_STAGE_DATA_MISSING'
      let coveredUntil = rangeStart.getTime()
      for (const stage of (reason ? [] : [...stages]).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())) {
        const start = new Date(stage.startsAt), stop = new Date(stage.endsAt)
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(stop.getTime()) || stop <= start) { reason = 'SNAPSHOT_STAGE_DATA_MISSING'; break }
        if (stop <= rangeStart || start >= rangeEnd) continue
        // Initial founding/cutover may fall inside its first month's sole stage;
        // there is no earlier actual term to which those Chapter stars could belong.
        if ((start < rangeStart && !(initial && startsAt > month.starts_at && start.getTime() === month.starts_at.getTime())) || stop > rangeEnd) { reason = 'SNAPSHOT_STAGE_BOUNDARY_MISSING'; break }
        if (Math.max(start.getTime(), rangeStart.getTime()) !== coveredUntil) { reason = 'SNAPSHOT_STAGE_COVERAGE_MISSING'; break }
        coveredUntil = stop.getTime()
        if (!Number.isFinite(stage.stars) || (item.eligible && !Number.isFinite(stage.stageScore))) { reason = 'SNAPSHOT_STAGE_DATA_MISSING'; break }
        allocatedStars += stage.stars
        if (item.eligible) allocatedScore += stage.stageScore
        hasContributedStage = true
      }
      if (!reason && coveredUntil !== rangeEnd.getTime()) reason = 'SNAPSHOT_STAGE_COVERAGE_MISSING'
    }
    if (reason) { if (!open) missing = true; allocatedScore = 0; allocatedStars = 0; hasContributedStage = false }
    const official = !open && payload?.state === 'FINALIZED' && !reason
    if (official) {
      totalStars += allocatedStars
      if (item.eligible && hasContributedStage) { score += allocatedScore; qualifiedMonthCount++ }
    } else if (open) { provisionalScore += allocatedScore; provisionalStars += allocatedStars }
    results.push({ monthId: month.id, month: month.key, score: item?.score ?? null, allocatedScore, allocatedStars, eligible: official && Boolean(item?.eligible && hasContributedStage), provisional: open, exclusionReasons: reason ? [reason] : item?.exclusionReasons || [], hasContributedStage })
  }
  return { score, totalStars, qualifiedMonthCount, provisionalScore, provisionalStars, months: results, missing, waitingKpi,
    eligible: qualifiedMonthCount > 0 && !missing && !waitingKpi,
    exclusionReasons: missing ? ['SNAPSHOT_MISSING'] : waitingKpi ? ['WAITING_KPI'] : qualifiedMonthCount ? [] : ['NO_ELIGIBLE_CLOSED_MONTH'] }
}
