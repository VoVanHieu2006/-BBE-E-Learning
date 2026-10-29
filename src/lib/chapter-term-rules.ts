/**
 * Pure domain logic for Chapter transfer eligibility and reward pause.
 *
 * Two different calendar notions are intentionally kept apart:
 *   - a transfer window (01/01–30/06 or 01/07–31/12) is the scheduling unit;
 *   - the elapsed reward anchor (most recent 01/04 or 01/10) drives the pause.
 *
 * All calendar calculations strictly adhere to Asia/Ho_Chi_Minh (UTC+7).
 */
import {
  actualTransferAt,
  anchorElapsed,
  windowOf,
  windowOfAnchor,
  type TransferWindow,
} from './transfer-windows'

export { addCalendarMonthsVietnam, daysInVietnamMonth, getVietnamParts } from './vietnam-calendar'

export type ChapterTransferStatus =
  | 'INITIAL_NOT_DUE'
  | 'FIRST_TRANSFER_DUE'
  | 'TRANSFER_SCHEDULED'
  | 'TRANSFER_APPLIED'
  | 'TRANSFER_OVERDUE'
  | 'DATA_INCONSISTENT'

export interface ChapterTransferEvidence {
  effective_at: Date
  applied_at: Date | null
}

export interface ChapterTransferSeason {
  id: string
  starts_at: Date
  ends_at: Date
  reward_boundary_at: Date | null
}

export interface ChapterTransferEligibilityInput {
  chapterId?: string
  at: Date
  candidateSeason: ChapterTransferSeason | null
  /** Every APPLIED transfer of this Chapter whose applied_at is not after `at`. */
  appliedTransfers?: ChapterTransferEvidence[]
  scheduledInWindow?: { effective_at: Date } | null
}

export interface ChapterTransferEligibilityResult {
  status: ChapterTransferStatus
  paused: boolean
  reason: string | null
  eligibleForSeason: boolean
  seasonId: string | null
  boundary: Date | null
  window: TransferWindow
  pauseWindow: TransferWindow
}

/** True when the row is evidence of a transfer made inside [window.startsAt, at]. */
export function isAppliedEvidenceInWindow(
  row: ChapterTransferEvidence,
  window: TransferWindow,
  at: Date,
): boolean {
  if (!row.applied_at || row.applied_at.getTime() > at.getTime()) return false
  // A row is attributed to the window of its effective time. Once it has been
  // applied, it proves that window is complete even if it was applied early
  // (before the window started) or late (after the window ended).
  if (row.effective_at.getTime() >= window.startsAt.getTime() && row.effective_at.getTime() < window.endsAt.getTime()) {
    return true
  }
  const actual = actualTransferAt(row.effective_at, row.applied_at)
  if (actual && actual.getTime() >= window.startsAt.getTime() && actual.getTime() <= at.getTime()) return true
  // A transfer scheduled outside the window but applied inside it still proves
  // that the Chapter completed a transfer during this window.
  return row.applied_at.getTime() >= window.startsAt.getTime() && row.applied_at.getTime() <= at.getTime()
}

/**
 * Standard pause formula:
 *   A_last(t)  = most recent 01/04 or 01/10 at or before t
 *   S(t)       = start of the window that belongs to A_last(t)
 *   paused(t)  = Chapter has ever transferred
 *                AND no APPLIED evidence falls in [S(t), t]
 *
 * The interval deliberately extends past the end of that window. A late worker
 * therefore closes the overdue gap at its real application time, without
 * deleting or backdating the stars already suppressed.
 */
export function isChapterTransferPausedAt(at: Date, appliedTransfers: ChapterTransferEvidence[]): boolean {
  if (!appliedTransfers.length) return false
  const pauseWindow = windowOfAnchor(anchorElapsed(at))
  return !appliedTransfers.some((row) => isAppliedEvidenceInWindow(row, pauseWindow, at))
}

/**
 * Decides whether a Chapter is due in the window containing `at` and whether
 * its stars are paused. There is no six-month waiting period for a new
 * Chapter; only a successful first transfer turns the pause mechanism on.
 */
export function evaluateChapterTransferEligibility(
  input: ChapterTransferEligibilityInput,
): ChapterTransferEligibilityResult {
  const { at, candidateSeason } = input
  const appliedTransfers = input.appliedTransfers || []
  const window = windowOf(at)
  const pauseWindow = windowOfAnchor(anchorElapsed(at))
  const hasEverApplied = appliedTransfers.length > 0
  const appliedInWindow = appliedTransfers.some((row) => isAppliedEvidenceInWindow(row, window, at))
  const paused = isChapterTransferPausedAt(at, appliedTransfers)
  const scheduled = Boolean(input.scheduledInWindow)
  const base = {
    seasonId: candidateSeason?.id || null,
    boundary: window.anchor,
    window,
    pauseWindow,
    paused: false,
    reason: null as string | null,
  }

  if (appliedInWindow) {
    return { ...base, status: 'TRANSFER_APPLIED', eligibleForSeason: true }
  }

  if (!hasEverApplied) {
    if (!candidateSeason) {
      return { ...base, status: 'INITIAL_NOT_DUE', eligibleForSeason: false }
    }
    if (at.getTime() >= window.anchor.getTime()) {
      // A Chapter that has never transferred keeps earning stars even when its
      // first transfer is overdue.
      return { ...base, status: 'TRANSFER_OVERDUE', eligibleForSeason: true }
    }
    return {
      ...base,
      status: scheduled ? 'TRANSFER_SCHEDULED' : 'FIRST_TRANSFER_DUE',
      eligibleForSeason: true,
    }
  }

  if (paused) {
    return {
      ...base,
      status: 'TRANSFER_OVERDUE',
      paused: true,
      reason: 'CHAPTER_TRANSFER_OVERDUE',
      eligibleForSeason: Boolean(candidateSeason),
    }
  }

  return {
    ...base,
    status: scheduled ? 'TRANSFER_SCHEDULED' : 'INITIAL_NOT_DUE',
    eligibleForSeason: Boolean(candidateSeason),
  }
}
