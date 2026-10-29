import { Prisma } from '@prisma/client'
import { evaluateChapterTransferEligibility } from './chapter-term-rules'
import { anchorElapsed, windowOf, windowOfAnchor } from './transfer-windows'
import { resolveSeasonForWindow, type TransferSeasonLookupReason } from './transfer-season-lookup'

/**
 * The most recent April/October boundary at or before `at`, exactly midnight in
 * Ho Chi Minh City. This "elapsed" meaning is deliberately kept for reward
 * pause and DNA reset; scheduling uses `anchorNearest` from transfer-windows.
 */
export function chapterRewardBoundary(at: Date) {
  return anchorElapsed(at)
}

/** Kept for callers that only need a simple boundary check. */
export function isChapterRewardPaused(at: Date, boundary: Date, appliedAt: Date | null) {
  return at >= boundary && (!appliedAt || appliedAt > at)
}

export function dnaSeasonEnd(boundary: Date) {
  const local = new Date(boundary.getTime() + 7 * 3_600_000)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 6, 1) - 7 * 3_600_000)
}

interface RewardState {
  paused: boolean
  reason: string | null
  boundary?: Date
  seasonId?: string | null
  seasonReason?: TransferSeasonLookupReason
  seasonMessage?: string | null
  status?: string
}

/** Caller holds the user lock. Missing season configuration never pauses a Chapter by itself. */
export async function chapterRewardState(tx: Prisma.TransactionClient, userId: string, at: Date): Promise<RewardState> {
  const policy = await tx.learningPolicy.findUnique({ where: { id: 'default' } })
  if (!policy?.cutover_at || !policy.mapping_approved_at || at < policy.cutover_at) return { paused: false, reason: null }
  const dna = await tx.organizationMembership.count({ where: { user_id: userId, status: 'ACTIVE', starts_at: { lte: at }, OR: [{ ends_at: null }, { ends_at: { gt: at } }], unit: { type: { in: ['DNA', 'DNA_GROUP'] } } } })
  if (dna) return { paused: false, reason: null }
  const member = await tx.chapterMember.findUnique({ where: { user_id: userId } })
  if (!member) return { paused: false, reason: null }
  const chapter = await tx.chapter.findUnique({ where: { id: member.chapter_id } })
  if (!chapter) return { paused: false, reason: null }

  const boundary = chapterRewardBoundary(at)
  const currentWindow = windowOf(at)
  const [appliedTransfers, scheduled, seasonResolution] = await Promise.all([
    tx.chapterReorganization.findMany({
      where: { chapter_id: chapter.id, status: 'APPLIED', applied_at: { lte: at } },
      select: { effective_at: true, applied_at: true },
      orderBy: { applied_at: 'desc' },
    }),
    tx.chapterReorganization.findFirst({
      where: {
        chapter_id: chapter.id,
        status: 'SCHEDULED',
        effective_at: { gte: currentWindow.startsAt, lt: currentWindow.endsAt },
      },
      select: { effective_at: true },
    }),
    resolveSeasonForWindow(tx as any, at),
  ])

  const eligibility = evaluateChapterTransferEligibility({
    chapterId: chapter.id,
    at,
    candidateSeason: seasonResolution.season,
    appliedTransfers,
    scheduledInWindow: scheduled,
  })

  return {
    paused: eligibility.paused,
    reason: eligibility.reason,
    boundary,
    seasonId: seasonResolution.season?.id || null,
    seasonReason: seasonResolution.reason,
    seasonMessage: seasonResolution.message,
    status: eligibility.status,
  }
}

/** Exposed for diagnostics and the Admin progress view. */
export function rewardPauseWindow(at: Date) {
  return windowOfAnchor(anchorElapsed(at))
}
