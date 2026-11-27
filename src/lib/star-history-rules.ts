import { competitionMonthBounds } from './learning-cycle-rules'

export function normalizeStarHistoryPagination(
  pageValue: string | null,
  limitValue: string | null,
  itemCount: number,
) {
  const requestedPage = Number(pageValue || 1)
  const requestedLimit = Number(limitValue || 20)
  const safePage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 50)
    : 20
  const safeItemCount = Number.isSafeInteger(itemCount) && itemCount > 0 ? itemCount : 0
  const totalPages = Math.ceil(safeItemCount / limit)

  return {
    page: totalPages === 0 ? 1 : Math.min(safePage, totalPages),
    limit,
    totalPages,
  }
}

export type StarHistoryReason = 'VIDEO_COMPLETION' | 'MODULE_QUIZ_PASS' | 'MODULE_QUIZ_BONUS' | 'COURSE_FINAL_PASS' | 'COURSE_FINAL_BONUS' | 'ADMIN_ADJUSTMENT'

export const STAR_HISTORY_SOURCE_REASONS = {
  VIDEO: ['VIDEO_COMPLETION'],
  LESSON_QUIZ: ['MODULE_QUIZ_PASS', 'MODULE_QUIZ_BONUS'],
  COURSE_FINAL: ['COURSE_FINAL_PASS', 'COURSE_FINAL_BONUS'],
  ADMIN_ADJUSTMENT: ['ADMIN_ADJUSTMENT'],
} as const satisfies Record<string, readonly StarHistoryReason[]>

export type StarHistorySourceFilter = 'ALL' | keyof typeof STAR_HISTORY_SOURCE_REASONS

export type StarHistoryFilterResult<T> = { ok: true; value: T } | { ok: false; message: string }

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isAll = (value: string) => value === '' || value.toUpperCase() === 'ALL'

export function isValidStarUserId(value: string): boolean {
  return UUID.test(value)
}

/** Blank, missing or `ALL` means every month; anything else must be a real `YYYY-MM`. */
export function parseStarHistoryMonth(value: string | null | undefined): StarHistoryFilterResult<string | null> {
  const month = (value ?? '').trim()
  if (isAll(month)) return { ok: true, value: null }
  return MONTH_KEY.test(month) ? { ok: true, value: month } : { ok: false, message: 'Tháng không hợp lệ. Vui lòng dùng định dạng YYYY-MM.' }
}

export function parseStarHistorySource(value: string | null | undefined): StarHistoryFilterResult<StarHistorySourceFilter> {
  const source = (value ?? '').trim().toUpperCase()
  if (isAll(source)) return { ok: true, value: 'ALL' }
  return Object.hasOwn(STAR_HISTORY_SOURCE_REASONS, source)
    ? { ok: true, value: source as StarHistorySourceFilter }
    : { ok: false, message: 'Nguồn Star không hợp lệ.' }
}

/** `null` means no reason filter. */
export function starReasonsForSource(source: StarHistorySourceFilter): StarHistoryReason[] | null {
  return source === 'ALL' ? null : [...STAR_HISTORY_SOURCE_REASONS[source]]
}

/** Vietnam month `[00:00 1st, 00:00 next 1st)` in UTC instants; UTC+7 has no DST. */
export function vnMonthBounds(monthKey: string): { startsAt: Date; endsAt: Date } {
  const match = MONTH_KEY.exec(monthKey)
  if (!match) throw new RangeError(`Invalid month key: ${monthKey}`)
  // 00:00 UTC on the 1st is 07:00 in Vietnam, safely inside the same VN month.
  const { startsAt, endsAt } = competitionMonthBounds(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)))
  return { startsAt, endsAt }
}

export function formatStarMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-')
  return `Tháng ${month}/${year}`
}
