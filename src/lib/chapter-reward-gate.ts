import { Prisma } from '@prisma/client'

/** Most recent April/October boundary, exactly midnight in Ho Chi Minh City. */
export function chapterRewardBoundary(at: Date) {
  const local = new Date(at.getTime() + 7 * 3_600_000)
  const year = local.getUTCFullYear(), month = local.getUTCMonth()
  return new Date(Date.UTC(month < 3 ? year - 1 : year, month < 3 || month >= 9 ? 9 : 3, 1) - 7 * 3_600_000)
}

export function isChapterRewardPaused(at: Date, boundary: Date, appliedAt: Date | null) {
  return at >= boundary && (!appliedAt || appliedAt > at)
}

export function dnaSeasonEnd(boundary: Date) {
  const local = new Date(boundary.getTime() + 7 * 3_600_000)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 6, 1) - 7 * 3_600_000)
}

/** Caller holds the user lock. Missing season configuration fails closed after cutover. */
export async function chapterRewardState(tx: Prisma.TransactionClient, userId: string, at: Date) {
  const policy = await tx.learningPolicy.findUnique({ where: { id: 'default' } })
  if (!policy?.cutover_at || !policy.mapping_approved_at || at < policy.cutover_at) return { paused: false, reason: null }
  const dna = await tx.organizationMembership.count({ where: { user_id: userId, status: 'ACTIVE', starts_at: { lte: at }, OR: [{ ends_at: null }, { ends_at: { gt: at } }], unit: { type: { in: ['DNA', 'DNA_GROUP'] } } } })
  if (dna) return { paused: false, reason: null }
  const chapter = await tx.chapterMember.findUnique({ where: { user_id: userId } })
  if (!chapter) return { paused: false, reason: null }
  const boundary = chapterRewardBoundary(at)
  const candidateSeasons = await tx.transferSeason.findMany({ where: { reward_boundary_at: { gte: boundary, lte: dnaSeasonEnd(boundary) }, starts_at: { lte: at } }, select: { id: true } })
  const successful = await tx.chapterReorganization.findFirst({ where: { chapter_id: chapter.chapter_id, transfer_season_id: { in: candidateSeasons.map((row) => row.id) }, status: 'APPLIED', applied_at: { lte: at } }, orderBy: { applied_at: 'desc' }, select: { transfer_season_id: true } })
  if (successful) return { paused: false, reason: null, boundary, seasonId: successful.transfer_season_id }
  const season = await tx.transferSeason.findUnique({ where: { reward_boundary_at: boundary } })
  if (!season) return { paused: true, reason: 'TRANSFER_SEASON_NOT_CONFIGURED', boundary }
  const applied = await tx.chapterReorganization.findFirst({ where: { chapter_id: chapter.chapter_id, transfer_season_id: season.id, status: 'APPLIED', applied_at: { lte: at } }, select: { applied_at: true } })
  return { paused: isChapterRewardPaused(at, boundary, applied?.applied_at || null), reason: applied ? null : 'CHAPTER_TRANSFER_OVERDUE', boundary, seasonId: season.id }
}
