/**
 * Pure domain logic for Chapter competition terms and 6-calendar-month transfer eligibility.
 * All calendar calculations strictly adhere to Asia/Ho_Chi_Minh (UTC+7).
 */

const VIETNAM_OFFSET_MS = 7 * 3_600_000

export type ChapterTransferStatus =
  | 'INITIAL_NOT_DUE'
  | 'INITIAL_SEASON_SKIPPED'
  | 'FIRST_TRANSFER_DUE'
  | 'TRANSFER_SCHEDULED'
  | 'TRANSFER_APPLIED'
  | 'TRANSFER_OVERDUE'
  | 'DATA_INCONSISTENT'

/**
 * Returns number of days in a given month for a given year in Vietnam calendar.
 * month is 0-indexed (0 = Jan, 1 = Feb, ..., 11 = Dec).
 */
export function daysInVietnamMonth(year: number, month: number): number {
  if (month === 1) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
    return isLeap ? 29 : 28
  }
  if ([3, 5, 8, 10].includes(month)) return 30
  return 31
}

/**
 * Adds exact calendar months to a date based on Asia/Ho_Chi_Minh (UTC+7).
 * Preserves hours, minutes, seconds, milliseconds.
 * Clamps days to the last day of the target month if the target month has fewer days
 * (e.g., 31/08/2026 + 6 calendar months = 28/02/2027 in non-leap year).
 */
export function addCalendarMonthsVietnam(date: Date, months: number): Date {
  const localMs = date.getTime() + VIETNAM_OFFSET_MS
  const local = new Date(localMs)

  const year = local.getUTCFullYear()
  const month = local.getUTCMonth()
  const day = local.getUTCDate()
  const hours = local.getUTCHours()
  const minutes = local.getUTCMinutes()
  const seconds = local.getUTCSeconds()
  const ms = local.getUTCMilliseconds()

  const totalMonths = month + months
  const targetYear = year + Math.floor(totalMonths / 12)
  const targetMonth = ((totalMonths % 12) + 12) % 12

  const maxDays = daysInVietnamMonth(targetYear, targetMonth)
  const targetDay = Math.min(day, maxDays)

  const targetLocalUtcMs = Date.UTC(targetYear, targetMonth, targetDay, hours, minutes, seconds, ms)
  return new Date(targetLocalUtcMs - VIETNAM_OFFSET_MS)
}

/**
 * Returns Vietnam (UTC+7) calendar components of a Date.
 * month is 1-indexed (1 = Jan, ..., 12 = Dec).
 */
export function getVietnamParts(date: Date): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  ms: number
} {
  const localMs = date.getTime() + VIETNAM_OFFSET_MS
  const local = new Date(localMs)
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
    ms: local.getUTCMilliseconds(),
  }
}

export interface ChapterTransferEligibilityInput {
  chapterId?: string
  chapterCreatedAt: Date
  at: Date
  candidateSeason: {
    id: string
    starts_at: Date
    ends_at: Date
    reward_boundary_at: Date | null
  } | null
  hasPriorAppliedReorg?: boolean
  appliedReorgThisSeason?: { applied_at: Date | null } | null
  scheduledReorgThisSeason?: { effective_at: Date } | null
}

export interface ChapterTransferEligibilityResult {
  status: ChapterTransferStatus
  paused: boolean
  reason: string | null
  firstEligibleAt: Date | null
  eligibleForSeason: boolean
  seasonId: string | null
  boundary: Date | null
}

/**
 * Evaluates whether a chapter is due for transfer in a candidate season
 * and whether its star reward gate is paused.
 */
export function evaluateChapterTransferEligibility(
  input: ChapterTransferEligibilityInput
): ChapterTransferEligibilityResult {
  const {
    chapterCreatedAt,
    at,
    candidateSeason,
    hasPriorAppliedReorg,
    appliedReorgThisSeason,
    scheduledReorgThisSeason,
  } = input

  const boundary = candidateSeason?.reward_boundary_at || null
  const seasonId = candidateSeason?.id || null

  // If a reorg has already been APPLIED for this season, rewards are active
  if (appliedReorgThisSeason?.applied_at && appliedReorgThisSeason.applied_at <= at) {
    return {
      status: 'TRANSFER_APPLIED',
      paused: false,
      reason: null,
      firstEligibleAt: null,
      eligibleForSeason: true,
      seasonId,
      boundary,
    }
  }

  // If chapter has completed a prior reorganization in a past season,
  // it is no longer in its initial term. Standard subsequent term rules apply.
  if (hasPriorAppliedReorg) {
    if (!candidateSeason) {
      return { status: 'INITIAL_NOT_DUE', paused: false, reason: null, firstEligibleAt: null, eligibleForSeason: false, seasonId: null, boundary: null }
    }
    const isPastBoundary = Boolean(boundary && at >= boundary)
    if (isPastBoundary) {
      return {
        status: 'TRANSFER_OVERDUE',
        paused: true,
        reason: 'CHAPTER_TRANSFER_OVERDUE',
        firstEligibleAt: null,
        eligibleForSeason: true,
        seasonId,
        boundary,
      }
    }
    return {
      status: scheduledReorgThisSeason ? 'TRANSFER_SCHEDULED' : 'INITIAL_NOT_DUE',
      paused: false,
      reason: null,
      firstEligibleAt: null,
      eligibleForSeason: true,
      seasonId,
      boundary,
    }
  }

  // --- Chapter is in its INITIAL TERM ---
  const firstEligibleAt = addCalendarMonthsVietnam(chapterCreatedAt, 6)

  if (!candidateSeason) {
    // No season active or configured
    return {
      status: 'INITIAL_NOT_DUE',
      paused: false,
      reason: null,
      firstEligibleAt,
      eligibleForSeason: false,
      seasonId: null,
      boundary: null,
    }
  }

  // Mandatory Rule 1.2 & 1.3:
  // Chapter must have operated for at least 6 calendar months as of season.starts_at.
  // Missing by even 1 day, 1 hour, or 1 second skips the ENTIRE season!
  const isEligibleAtSeasonStart = firstEligibleAt.getTime() <= candidateSeason.starts_at.getTime()

  if (!isEligibleAtSeasonStart) {
    // The season started BEFORE the chapter was 6 calendar months old.
    // The chapter is NOT due to transfer this season, NOT overdue, and reward is NOT paused.
    // Even if chapter reaches 6 months mid-season, it continues Term 1 until the next season.
    // However, if chapter voluntarily applied a reorg, that was handled above (TRANSFER_APPLIED).
    return {
      status: 'INITIAL_SEASON_SKIPPED',
      paused: false,
      reason: null,
      firstEligibleAt,
      eligibleForSeason: false,
      seasonId,
      boundary,
    }
  }

  // Chapter WAS at least 6 calendar months old when season opened:
  // It is due for its FIRST mandatory transfer in this season!
  const isPastBoundary = Boolean(boundary && at >= boundary)

  if (isPastBoundary) {
    return {
      status: 'TRANSFER_OVERDUE',
      // The first transfer is due, but its initial learning/reward term continues
      // until application succeeds. Only subsequent terms may pause awards.
      paused: false,
      reason: null,
      firstEligibleAt,
      eligibleForSeason: true,
      seasonId,
      boundary,
    }
  }

  return {
    status: scheduledReorgThisSeason ? 'TRANSFER_SCHEDULED' : 'FIRST_TRANSFER_DUE',
    paused: false,
    reason: null,
    firstEligibleAt,
    eligibleForSeason: true,
    seasonId,
    boundary,
  }
}
