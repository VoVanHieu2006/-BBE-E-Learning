import { addCalendarMonthsVietnam, getVietnamParts } from './vietnam-calendar'

/**
 * Transfer windows are the scheduling and duplicate-protection unit:
 *   00:00 01/01 – 23:59:59 30/06  -> anchor 01/04
 *   00:00 01/07 – 23:59:59 31/12  -> anchor 01/10
 *
 * All boundaries are Asia/Ho_Chi_Minh (UTC+7). Windows are half-open so every
 * instant belongs to exactly one window.
 */
export interface TransferWindow {
  /** Inclusive start, 00:00 Vietnam time. */
  startsAt: Date
  /** Exclusive end, 00:00 Vietnam time. */
  endsAt: Date
  /** Normalized anchor inside this window, 00:00 Vietnam time. */
  anchor: Date
}

const VIETNAM_OFFSET_MS = 7 * 3_600_000

function vietnamMidnight(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day) - VIETNAM_OFFSET_MS)
}

/** Nearest April/October anchor: Jan–Jun -> April, Jul–Dec -> October. */
export function anchorNearest(at: Date): Date {
  const { year, month } = getVietnamParts(at)
  return month <= 6 ? vietnamMidnight(year, 3, 1) : vietnamMidnight(year, 9, 1)
}

/** Most recent April/October anchor at or before `at`. Used for reward pause and DNA reset. */
export function anchorElapsed(at: Date): Date {
  const { year, month } = getVietnamParts(at)
  if (month < 4) return vietnamMidnight(year - 1, 9, 1)
  if (month < 10) return vietnamMidnight(year, 3, 1)
  return vietnamMidnight(year, 9, 1)
}

/** The standard window that belongs to an anchor. Non-anchor dates are classified by their half-year. */
export function windowOfAnchor(anchor: Date): TransferWindow {
  const { year, month } = getVietnamParts(anchor)
  if (month <= 6) {
    return {
      startsAt: vietnamMidnight(year, 0, 1),
      endsAt: vietnamMidnight(year, 6, 1),
      anchor: vietnamMidnight(year, 3, 1),
    }
  }
  return {
    startsAt: vietnamMidnight(year, 6, 1),
    endsAt: vietnamMidnight(year + 1, 0, 1),
    anchor: vietnamMidnight(year, 9, 1),
  }
}

/** The standard window containing `at`. */
export function windowOf(at: Date): TransferWindow {
  return windowOfAnchor(anchorNearest(at))
}

/** Competition term belonging to an anchor: anchor -> anchor + 6 calendar months. */
export function termOfAnchor(anchor: Date): { startsAt: Date; endsAt: Date } {
  return { startsAt: anchor, endsAt: addCalendarMonthsVietnam(anchor, 6) }
}

export function nextWindow(window: TransferWindow): TransferWindow {
  const { year, month } = getVietnamParts(window.anchor)
  return month === 4
    ? windowOfAnchor(vietnamMidnight(year, 9, 1))
    : windowOfAnchor(vietnamMidnight(year + 1, 3, 1))
}

export function isWithinWindow(at: Date, window: TransferWindow): boolean {
  return at.getTime() >= window.startsAt.getTime() && at.getTime() < window.endsAt.getTime()
}

/**
 * Business/display time of a transfer. A delayed worker never backdates
 * `applied_at`, but the effective business moment cannot be later than either
 * the scheduled time or the real application time.
 */
export function actualTransferAt(effectiveAt: Date, appliedAt: Date | null | undefined): Date | null {
  if (!appliedAt) return null
  return new Date(Math.min(effectiveAt.getTime(), appliedAt.getTime()))
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatVietnamDate(at: Date): string {
  const { year, month, day } = getVietnamParts(at)
  return `${pad(day)}/${pad(month)}/${year}`
}

export function formatVietnamDateTime(at: Date): string {
  const { year, month, day, hour, minute } = getVietnamParts(at)
  return `${pad(day)}/${pad(month)}/${year} ${pad(hour)}:${pad(minute)}`
}

/** Inclusive human label, e.g. "01/01/2026 – 30/06/2026". */
export function describeWindow(window: TransferWindow): string {
  const inclusiveEnd = new Date(window.endsAt.getTime() - 1)
  return `${formatVietnamDate(window.startsAt)} – ${formatVietnamDate(inclusiveEnd)}`
}

export function describeTerm(anchor: Date): string {
  const term = termOfAnchor(anchor)
  return `${formatVietnamDate(term.startsAt)} – ${formatVietnamDate(term.endsAt)}`
}

export function describeWindowName(window: TransferWindow): string {
  const { year, month } = getVietnamParts(window.anchor)
  return month === 4 ? `giai đoạn tháng 4/${year}` : `giai đoạn tháng 10/${year}`
}

/** Exact April/October boundary check, including midnight and zero milliseconds. */
export function isRewardAnchor(at: Date): boolean {
  const parts = getVietnamParts(at)
  return (parts.month === 4 || parts.month === 10)
    && parts.day === 1
    && parts.hour === 0
    && parts.minute === 0
    && parts.second === 0
    && parts.ms === 0
}

export function sameInstant(a: Date | null | undefined, b: Date | null | undefined): boolean {
  return Boolean(a && b && a.getTime() === b.getTime())
}
