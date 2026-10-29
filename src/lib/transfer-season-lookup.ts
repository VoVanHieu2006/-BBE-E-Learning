import { addCalendarMonthsVietnam, getVietnamParts } from './vietnam-calendar'
import {
  describeWindow,
  describeWindowName,
  formatVietnamDate,
  sameInstant,
  termOfAnchor,
  windowOf,
  windowOfAnchor,
  type TransferWindow,
} from './transfer-windows'

/**
 * A transfer season is supposed to cover exactly one transfer window:
 *   01/01–30/06 with reward anchor 01/04
 *   01/07–31/12 with reward anchor 01/10
 *
 * The lookup below never guesses. It reports the exact reason a window cannot
 * be used so scheduling, applying and the read-only Admin view can explain the
 * next action instead of showing a generic "season missing" message.
 */
export type TransferSeasonLookupReason =
  | 'OK'
  | 'SEASON_NOT_CONFIGURED'
  | 'SEASON_OVERLAP'
  | 'SEASON_NOT_COVERING_DATE'
  | 'SEASON_LEGACY_WINDOW'
  | 'SEASON_WINDOW_MISMATCH'
  | 'SEASON_BOUNDARY_MISMATCH'

export interface TransferSeasonRow {
  id: string
  code: string
  starts_at: Date
  ends_at: Date
  reward_boundary_at: Date | null
}

export interface TransferSeasonResolution {
  ok: boolean
  reason: TransferSeasonLookupReason
  message: string | null
  window: TransferWindow
  season: TransferSeasonRow | null
  /** Every season that intersects the window; useful for overlap diagnostics. */
  seasons: TransferSeasonRow[]
}

export interface SeasonWindowCheck {
  ok: boolean
  reason: TransferSeasonLookupReason
  message: string | null
  window: TransferWindow | null
}

function overlapsWindow(season: TransferSeasonRow, window: TransferWindow): boolean {
  return season.starts_at.getTime() < window.endsAt.getTime()
    && season.ends_at.getTime() > window.startsAt.getTime()
}

function coversWindow(season: TransferSeasonRow, window: TransferWindow): boolean {
  return season.starts_at.getTime() <= window.startsAt.getTime()
    && season.ends_at.getTime() >= window.endsAt.getTime()
}

/** Old configuration used a six-month block starting at the reward anchor. */
export function isLegacySixMonthSeason(season: Pick<TransferSeasonRow, 'starts_at' | 'ends_at' | 'reward_boundary_at'>): boolean {
  if (!season.reward_boundary_at) return false
  return sameInstant(season.starts_at, season.reward_boundary_at)
    && sameInstant(season.ends_at, addCalendarMonthsVietnam(season.reward_boundary_at, 6))
}

/** A boundary is valid only at exactly 00:00 on 01/04 or 01/10, Vietnam time. */
export function isExactRewardBoundary(at: Date | null | undefined): at is Date {
  if (!at) return false
  const parts = getVietnamParts(at)
  return (parts.month === 4 || parts.month === 10)
    && parts.day === 1
    && parts.hour === 0
    && parts.minute === 0
    && parts.second === 0
    && parts.ms === 0
}

function seasonWindow(season: TransferSeasonRow): TransferWindow {
  const anchor = isExactRewardBoundary(season.reward_boundary_at)
    ? season.reward_boundary_at
    : windowOf(season.starts_at).anchor
  return windowOfAnchor(anchor)
}

export function seasonWindowOf(season: TransferSeasonRow): TransferWindow {
  return seasonWindow(season)
}

export function seasonTermOf(season: TransferSeasonRow): { startsAt: Date; endsAt: Date } {
  return termOfAnchor(seasonWindow(season).anchor)
}

function messageFor(reason: TransferSeasonLookupReason, window: TransferWindow, details?: { count?: number }): string {
  const name = describeWindowName(window)
  const dates = describeWindow(window)
  switch (reason) {
    case 'SEASON_NOT_CONFIGURED':
      return `Chưa có mùa chuyển giao cho ${name} (${dates}). Admin cần tạo mùa cho giai đoạn này.`
    case 'SEASON_OVERLAP':
      return `Có ${details?.count || 2} mùa chuyển giao cùng áp dụng cho ${name} (${dates}). Admin cần giữ lại đúng một mùa.`
    case 'SEASON_NOT_COVERING_DATE':
      return `Mùa chuyển giao hiện có chưa phủ hết ${name} (${dates}). Admin cần điều chỉnh ngày bắt đầu và kết thúc cho đủ cả giai đoạn.`
    case 'SEASON_LEGACY_WINDOW':
      return `Mùa chuyển giao đang dùng khung 6 tháng cũ nên không khớp ${name} (${dates}). Admin cần sửa mùa này về đúng giai đoạn trước khi đặt lịch.`
    case 'SEASON_WINDOW_MISMATCH':
      return `Mùa chuyển giao không trùng đúng ${name} (${dates}). Admin cần sửa ngày bắt đầu và kết thúc của mùa.`
    case 'SEASON_BOUNDARY_MISMATCH':
      return `Mốc thưởng của mùa chuyển giao chưa đúng. Với ${name} (${dates}), mốc phải là ${formatVietnamDate(window.anchor)} lúc 00:00.`
    default:
      return ''
  }
}

export function classifySeasonForWindow(seasons: TransferSeasonRow[], at: Date): TransferSeasonResolution {
  const window = windowOf(at)
  const intersecting = seasons.filter((season) => overlapsWindow(season, window))
  if (!intersecting.length) {
    return {
      ok: false,
      reason: 'SEASON_NOT_CONFIGURED',
      message: messageFor('SEASON_NOT_CONFIGURED', window),
      window,
      season: null,
      seasons: [],
    }
  }
  if (intersecting.length > 1) {
    return {
      ok: false,
      reason: 'SEASON_OVERLAP',
      message: messageFor('SEASON_OVERLAP', window, { count: intersecting.length }),
      window,
      season: null,
      seasons: intersecting,
    }
  }

  const season = intersecting[0]
  const exactWindow = sameInstant(season.starts_at, window.startsAt) && sameInstant(season.ends_at, window.endsAt)
  const exactBoundary = sameInstant(season.reward_boundary_at, window.anchor)

  if (exactWindow && exactBoundary) {
    return { ok: true, reason: 'OK', message: null, window, season, seasons: intersecting }
  }
  if (exactWindow) {
    return {
      ok: false,
      reason: 'SEASON_BOUNDARY_MISMATCH',
      message: messageFor('SEASON_BOUNDARY_MISMATCH', window),
      window,
      season,
      seasons: intersecting,
    }
  }
  if (isLegacySixMonthSeason(season)) {
    return {
      ok: false,
      reason: 'SEASON_LEGACY_WINDOW',
      message: messageFor('SEASON_LEGACY_WINDOW', window),
      window,
      season,
      seasons: intersecting,
    }
  }
  if (!coversWindow(season, window)) {
    return {
      ok: false,
      reason: 'SEASON_NOT_COVERING_DATE',
      message: messageFor('SEASON_NOT_COVERING_DATE', window),
      window,
      season,
      seasons: intersecting,
    }
  }
  return {
    ok: false,
    reason: 'SEASON_WINDOW_MISMATCH',
    message: messageFor('SEASON_WINDOW_MISMATCH', window),
    window,
    season,
    seasons: intersecting,
  }
}

type SeasonReader = {
  transferSeason: {
    findMany(args: {
      where: { starts_at: { lt: Date }; ends_at: { gt: Date } }
      orderBy?: { starts_at: 'asc' | 'desc' }
    }): Promise<TransferSeasonRow[]>
  }
}

export async function resolveSeasonForWindow(tx: SeasonReader, at: Date): Promise<TransferSeasonResolution> {
  const window = windowOf(at)
  const seasons = await tx.transferSeason.findMany({
    where: { starts_at: { lt: window.endsAt }, ends_at: { gt: window.startsAt } },
    orderBy: { starts_at: 'asc' },
  })
  return classifySeasonForWindow(seasons, at)
}

/**
 * Validates a season supplied by an Admin. A season must be exactly one
 * standard transfer window; legacy six-month blocks remain readable but are
 * never accepted as new configuration.
 */
export function checkSeasonConfiguration(startsAt: Date, endsAt: Date, boundaryAt: Date | null): SeasonWindowCheck {
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
    return {
      ok: false,
      reason: 'SEASON_WINDOW_MISMATCH',
      message: 'Ngày bắt đầu và kết thúc của mùa chuyển giao không hợp lệ.',
      window: null,
    }
  }
  if (!isExactRewardBoundary(boundaryAt)) {
    return {
      ok: false,
      reason: 'SEASON_BOUNDARY_MISMATCH',
      message: 'Mốc thưởng phải đúng 01/04 hoặc 01/10 lúc 00:00 giờ Việt Nam.',
      window: null,
    }
  }

  const boundaryWindow = windowOfAnchor(boundaryAt)
  const exactWindow = sameInstant(startsAt, boundaryWindow.startsAt) && sameInstant(endsAt, boundaryWindow.endsAt)
  if (!exactWindow) {
    return {
      ok: false,
      reason: 'SEASON_WINDOW_MISMATCH',
      message: `Mùa chuyển giao phải trùng đúng ${describeWindowName(boundaryWindow)} (${describeWindow(boundaryWindow)}). Admin cần đặt ngày bắt đầu và kết thúc theo đúng giai đoạn này.`,
      window: boundaryWindow,
    }
  }

  return { ok: true, reason: 'OK', message: null, window: boundaryWindow }
}

/** Human label for the read-only Admin view. */
export function describeSeasonState(season: TransferSeasonRow): { state: 'EXACT' | 'LEGACY' | 'BOUNDARY_MISMATCH' | 'MISMATCH'; label: string } {
  const window = seasonWindow(season)
  const exactWindow = sameInstant(season.starts_at, window.startsAt) && sameInstant(season.ends_at, window.endsAt)
  const exactBoundary = sameInstant(season.reward_boundary_at, window.anchor)
  if (exactWindow && exactBoundary) return { state: 'EXACT', label: 'Đúng giai đoạn' }
  if (isLegacySixMonthSeason(season)) return { state: 'LEGACY', label: 'Khung 6 tháng cũ' }
  if (exactWindow) return { state: 'BOUNDARY_MISMATCH', label: 'Mốc thưởng chưa đúng' }
  return { state: 'MISMATCH', label: 'Ngày bắt đầu/kết thúc chưa đúng' }
}
