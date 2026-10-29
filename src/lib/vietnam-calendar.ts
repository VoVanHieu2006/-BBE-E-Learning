/** Calendar helpers strictly for Asia/Ho_Chi_Minh (UTC+7). */
export const VIETNAM_OFFSET_MS = 7 * 3_600_000

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
