import type { ChapterEligibilityCondition } from './competition-ranking-rules'

export type ExclusionPillTone = 'amber' | 'slate' | 'red'

export interface ChapterExclusionPill {
  key: string
  icon: string
  text: string
  tone: ExclusionPillTone
}

export interface ExcludedChapterLike {
  conditions?: ChapterEligibilityCondition[] | null
  exclusionReasons?: string[] | null
  reasons?: string[] | null
  memberCount?: number | null
  averageMemberCount?: number | null
  atLeast70Percent?: number | null
}

function floorAtCutoff(value: number, contradicts: (rounded: number) => boolean) {
  const tenths = Math.round(value * 1e7) / 1e6
  const rounded = Math.round(tenths) / 10
  return (contradicts(rounded) ? Math.floor(tenths) / 10 : rounded).toLocaleString('vi-VN', { maximumFractionDigits: 1 })
}

export function formatMonthKeyLabel(monthKey?: string | null): string {
  if (!monthKey || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return 'tháng này'
  const [year, month] = monthKey.split('-')
  return `tháng ${month}/${year}`
}

function pillFromCondition(condition: ChapterEligibilityCondition, monthLabel: string): ChapterExclusionPill | null {
  if (condition.state === 'PASS') return null

  if (condition.kind === 'MEMBER_COUNT') {
    if (condition.reasonCode === 'ROSTER_ZERO' || condition.value === 0) {
      return { key: 'MEMBER_COUNT', icon: '👥', text: 'Không có thành viên', tone: 'amber' }
    }
    if (condition.value !== null && condition.value !== undefined) {
      const shown = floorAtCutoff(Number(condition.value), (rounded) => rounded > 20)
      return { key: 'MEMBER_COUNT', icon: '👥', text: `Chưa có trên 20 thành viên (${shown} học viên)`, tone: 'amber' }
    }
    return { key: 'MEMBER_COUNT', icon: '👥', text: 'Chưa có dữ liệu quân số kỳ', tone: 'slate' }
  }

  if (condition.kind === 'CORE_COMPLETION') {
    if (condition.reasonCode === 'CORE_LESSONS_ZERO') {
      return { key: 'CORE_COMPLETION', icon: '📚', text: 'Chưa có bài học cốt lõi', tone: 'amber' }
    }
    if (condition.reasonCode === 'ROSTER_ZERO') {
      return { key: 'CORE_COMPLETION', icon: '📘', text: 'Chưa đạt 50% thành viên ≥70% (0% đã đạt)', tone: 'amber' }
    }
    if (condition.value !== null && condition.value !== undefined) {
      const shown = floorAtCutoff(Number(condition.value) * 100, (rounded) => rounded >= 50)
      return { key: 'CORE_COMPLETION', icon: '📘', text: `Chưa đạt 50% thành viên ≥70% (${shown}% đã đạt)`, tone: 'amber' }
    }
    return { key: 'CORE_COMPLETION', icon: '📘', text: 'Chưa có dữ liệu tỷ lệ hoàn thành bài lõi', tone: 'slate' }
  }

  // KPI condition
  if (condition.reasonCode === 'KPI_NOT_ELIGIBLE' || condition.state === 'FAIL') {
    return { key: 'KPI', icon: '🔴', text: 'KPI Đỏ hoặc Đen', tone: 'red' }
  }
  if (condition.reasonCode === 'SNAPSHOT_CONDITIONS_MISSING') {
    return { key: 'KPI', icon: '📅', text: 'Chưa có dữ liệu KPI', tone: 'slate' }
  }
  if (condition.reasonCode === 'WAITING_KPI' || condition.reasonCode === 'KPI_MISSING' || condition.value === null || condition.value === undefined) {
    return { key: 'KPI', icon: '📅', text: `Chưa nhập KPI ${monthLabel}`, tone: 'slate' }
  }
  return { key: 'KPI', icon: '📅', text: 'Chưa có dữ liệu KPI', tone: 'slate' }
}

function pillFromReasonCode(reason: string, chapter: ExcludedChapterLike, monthLabel: string): ChapterExclusionPill {
  switch (reason) {
    case 'ROSTER_ZERO':
      return { key: reason, icon: '👥', text: 'Không có thành viên', tone: 'amber' }
    case 'MEMBER_COUNT_NOT_ABOVE_20':
    case 'MINIMUM_MEMBERS': {
      const count = chapter.averageMemberCount ?? chapter.memberCount
      const suffix = count !== null && count !== undefined
        ? ` (${floorAtCutoff(Number(count), (rounded) => rounded > 20)} học viên)`
        : ''
      return { key: reason, icon: '👥', text: `Chưa có trên 20 thành viên${suffix}`, tone: 'amber' }
    }
    case 'CORE_LESSONS_ZERO':
      return { key: reason, icon: '📚', text: 'Chưa có bài học cốt lõi', tone: 'amber' }
    case 'CORE_COMPLETION_BELOW_50_PERCENT':
    case 'COMPLETION_THRESHOLD': {
      const pct = chapter.atLeast70Percent
      const suffix = pct !== null && pct !== undefined
        ? ` (${floorAtCutoff(Number(pct), (rounded) => rounded >= 50)}% đã đạt)`
        : ''
      return { key: reason, icon: '📘', text: `Chưa đạt 50% thành viên ≥70%${suffix}`, tone: 'amber' }
    }
    case 'WAITING_KPI':
    case 'KPI_MISSING':
      return { key: reason, icon: '📅', text: `Chưa nhập KPI ${monthLabel}`, tone: 'slate' }
    case 'KPI_NOT_ELIGIBLE':
    case 'KPI_RED':
      return { key: reason, icon: '🔴', text: 'KPI Đỏ hoặc Đen', tone: 'red' }
    case 'NO_ELIGIBLE_CLOSED_MONTH':
      return { key: reason, icon: '📅', text: 'Chưa có tháng đã chốt nào đủ điều kiện', tone: 'amber' }
    case 'TERM_NOT_STARTED':
      return { key: reason, icon: '⏳', text: 'Nhiệm kỳ chưa bắt đầu', tone: 'slate' }
    case 'SEASON_BOUNDARY_MISSING':
      return { key: reason, icon: '🗓️', text: 'Chưa cấu hình mốc nhiệm kỳ', tone: 'slate' }
    case 'MONTH_NOT_CONFIGURED':
      return { key: reason, icon: '🗓️', text: 'Tháng thi đua chưa được cấu hình', tone: 'slate' }
    case 'SNAPSHOT_MISSING':
      return { key: reason, icon: '📸', text: 'Chưa có snapshot kết quả tháng', tone: 'slate' }
    case 'SNAPSHOT_DATA_MISSING':
    case 'SNAPSHOT_CONDITIONS_MISSING':
      return { key: reason, icon: '📸', text: 'Snapshot thiếu dữ liệu điều kiện', tone: 'slate' }
    default:
      return { key: reason, icon: '⚠️', text: 'Chưa đủ dữ liệu để xếp hạng', tone: 'slate' }
  }
}

export function buildChapterExclusionPills(
  chapter: ExcludedChapterLike,
  options?: { monthKey?: string | null }
): ChapterExclusionPill[] {
  const monthLabel = formatMonthKeyLabel(options?.monthKey)

  if (Array.isArray(chapter.conditions) && chapter.conditions.length > 0) {
    const pills = chapter.conditions
      .map((condition) => pillFromCondition(condition, monthLabel))
      .filter((pill): pill is ChapterExclusionPill => pill !== null)
    if (pills.length > 0) return pills
  }

  const reasons = chapter.exclusionReasons?.length ? chapter.exclusionReasons : chapter.reasons || []
  if (reasons.length > 0) {
    const seen = new Set<string>()
    const pills: ChapterExclusionPill[] = []
    for (const reason of reasons) {
      if (seen.has(reason)) continue
      seen.add(reason)
      pills.push(pillFromReasonCode(reason, chapter, monthLabel))
    }
    return pills
  }

  return [{ key: 'UNSPECIFIED', icon: '⚠️', text: 'Chưa đủ điều kiện tham gia BXH', tone: 'amber' }]
}
