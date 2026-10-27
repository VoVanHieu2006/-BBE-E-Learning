import { Prisma } from '@prisma/client'
import { evaluateChapterTransferEligibility } from './chapter-term-rules'

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
  const member = await tx.chapterMember.findUnique({ where: { user_id: userId } })
  if (!member) return { paused: false, reason: null }
  const chapter = await tx.chapter.findUnique({ where: { id: member.chapter_id } })
  if (!chapter) return { paused: false, reason: null }

  const boundary = chapterRewardBoundary(at)
  const season = await tx.transferSeason.findUnique({ where: { reward_boundary_at: boundary } })

  // Check if chapter has any past APPLIED reorganization (i.e. not in initial term)
  const priorApplied = await tx.chapterReorganization.findFirst({
    where: {
      chapter_id: chapter.id,
      status: 'APPLIED',
      applied_at: { lte: at },
      ...(season ? { OR: [{ transfer_season_id: { not: season.id } }, { transfer_season_id: null }] } : {}),
    },
    select: { id: true, applied_at: true },
    orderBy: { applied_at: 'desc' },
  })

  const appliedThisSeason = season
    ? await tx.chapterReorganization.findFirst({
        where: { chapter_id: chapter.id, transfer_season_id: season.id, status: 'APPLIED', applied_at: { lte: at } },
        select: { applied_at: true },
      })
    : null

  const scheduledThisSeason = season
    ? await tx.chapterReorganization.findFirst({
        where: { chapter_id: chapter.id, transfer_season_id: season.id, status: 'SCHEDULED' },
        select: { effective_at: true },
      })
    : null

  // A successful early transfer opens its new actual term immediately, even
  // while the latest elapsed boundary still belongs to the previous season.
  // At the next boundary its own season's APPLIED evidence takes over below.
  if (priorApplied?.applied_at && priorApplied.applied_at >= boundary) {
    return { paused: false, reason: null, boundary, seasonId: season?.id, status: 'TRANSFER_APPLIED' }
  }

  if (!season) {
    if (!priorApplied) {
      const eligibility = evaluateChapterTransferEligibility({
        chapterId: chapter.id,
        chapterCreatedAt: chapter.created_at,
        at,
        candidateSeason: null,
        hasPriorAppliedReorg: false,
        appliedReorgThisSeason: null,
        scheduledReorgThisSeason: null,
      })
      if (!eligibility.paused) return { paused: false, reason: null, boundary }
    }
    return { paused: true, reason: 'TRANSFER_SEASON_NOT_CONFIGURED', boundary }
  }

  const eligibility = evaluateChapterTransferEligibility({
    chapterId: chapter.id,
    chapterCreatedAt: chapter.created_at,
    at,
    candidateSeason: season,
    hasPriorAppliedReorg: Boolean(priorApplied),
    appliedReorgThisSeason: appliedThisSeason,
    scheduledReorgThisSeason: scheduledThisSeason,
  })

  return {
    paused: eligibility.paused,
    reason: eligibility.reason,
    boundary,
    seasonId: season.id,
    status: eligibility.status,
  }
}

