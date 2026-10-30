import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  actualTransferAt,
  describeWindow,
  describeWindowName,
  formatVietnamDate,
  nextWindow,
  termOfAnchor,
  windowOf,
  type TransferWindow,
} from '@/lib/transfer-windows'
import {
  classifySeasonForWindow,
  describeSeasonState,
  type TransferSeasonLookupReason,
  type TransferSeasonRow,
} from '@/lib/transfer-season-lookup'

export const dynamic = 'force-dynamic'

const STATUS_LABELS: Record<TransferSeasonLookupReason, string> = {
  OK: 'Sẵn sàng',
  SEASON_NOT_CONFIGURED: 'Chưa có mùa',
  SEASON_OVERLAP: 'Có nhiều mùa trùng nhau',
  SEASON_NOT_COVERING_DATE: 'Mùa chưa phủ hết giai đoạn',
  SEASON_LEGACY_WINDOW: 'Mùa dùng khung 6 tháng cũ',
  SEASON_WINDOW_MISMATCH: 'Ngày của mùa chưa đúng',
  SEASON_BOUNDARY_MISMATCH: 'Mốc thưởng chưa đúng',
}

const STATUS_FILTERS = ['APPLIED', 'SCHEDULED', 'NONE', 'OVERDUE'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number] | null

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const MAX_WINDOW_SUMMARIES = 36
const LATE_THRESHOLD_MS = 60_000

type BatchRow = {
  id: string
  chapter_id: string
  effective_at: Date
  applied_at: Date | null
  status: string
  term_number: number | null
  transfer_season_id: string | null
  last_error: string | null
  apply_attempts: number
}

function minutesBetween(later: number, earlier: number): number {
  return Math.max(0, Math.floor((later - earlier) / 60_000))
}

function parsePage(raw: string | null): number {
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 1) return 1
  return Math.floor(value)
}

function parsePageSize(raw: string | null): number {
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 1) return DEFAULT_PAGE_SIZE
  return Math.min(MAX_PAGE_SIZE, Math.floor(value))
}

function parseStatus(raw: string | null): StatusFilter {
  return STATUS_FILTERS.includes(raw as (typeof STATUS_FILTERS)[number]) ? raw as (typeof STATUS_FILTERS)[number] : null
}

type WindowGroup = {
  window: TransferWindow
  seasons: TransferSeasonRow[]
  batches: BatchRow[]
}

function groupKey(window: TransferWindow): string {
  return window.startsAt.toISOString()
}

function intersectingWindows(season: TransferSeasonRow): TransferWindow[] {
  const result: TransferWindow[] = []
  let window = windowOf(season.starts_at)
  for (let guard = 0; guard < 100 && window.startsAt.getTime() < season.ends_at.getTime(); guard += 1) {
    if (season.starts_at.getTime() < window.endsAt.getTime()) result.push(window)
    window = nextWindow(window)
  }
  return result
}

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok || auth.context?.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Bạn không có quyền xem thông tin chuyển giao nhiệm kỳ.' } }, { status: 403 })
  }

  const url = new URL(request.url)
  const page = parsePage(url.searchParams.get('page'))
  const pageSize = parsePageSize(url.searchParams.get('pageSize'))
  const search = (url.searchParams.get('q') || '').trim().slice(0, 100)
  const normalizedSearch = search.toLocaleLowerCase('vi')
  const statusFilter = parseStatus(url.searchParams.get('status'))
  const windowParam = url.searchParams.get('window')

  const [chapters, seasons, batches] = await Promise.all([
    prisma.chapter.findMany({ select: { id: true, name: true, status: true, current_term_number: true, created_at: true }, orderBy: { name: 'asc' } }),
    prisma.transferSeason.findMany({ orderBy: { starts_at: 'desc' } }),
    prisma.chapterReorganization.findMany({
      where: { status: { in: ['APPLIED', 'SCHEDULED'] } },
      select: { id: true, chapter_id: true, effective_at: true, applied_at: true, status: true, term_number: true, transfer_season_id: true, last_error: true, apply_attempts: true },
      orderBy: { effective_at: 'desc' },
    }),
  ])

  const lifetime = new Map<string, { applied: number; lastAppliedAt: Date | null }>()
  for (const batch of batches) {
    if (batch.status !== 'APPLIED') continue
    const entry = lifetime.get(batch.chapter_id) || { applied: 0, lastAppliedAt: null }
    entry.applied += 1
    const at = actualTransferAt(batch.effective_at, batch.applied_at)
    if (at && (!entry.lastAppliedAt || at.getTime() > entry.lastAppliedAt.getTime())) entry.lastAppliedAt = at
    lifetime.set(batch.chapter_id, entry)
  }

  const groups = new Map<string, WindowGroup>()
  const ensure = (window: TransferWindow): WindowGroup => {
    const key = groupKey(window)
    if (!groups.has(key)) groups.set(key, { window, seasons: [], batches: [] })
    return groups.get(key)!
  }

  for (const season of seasons) {
    // A legacy six-month season spans two standard windows. Show it in both so
    // neither window looks unexpectedly unconfigured in the Admin view.
    for (const window of intersectingWindows(season)) ensure(window).seasons.push(season)
  }
  for (const batch of batches) ensure(windowOf(batch.effective_at)).batches.push(batch)

  const nowMs = Date.now()
  const rendered = Array.from(groups.values())
    .sort((a, b) => b.window.startsAt.getTime() - a.window.startsAt.getTime())
    .map((group) => {
      const resolution = classifySeasonForWindow(group.seasons, group.window.anchor)
      const term = termOfAnchor(group.window.anchor)
      const byChapter = new Map<string, BatchRow[]>()
      for (const batch of group.batches) {
        const list = byChapter.get(batch.chapter_id) || []
        list.push(batch)
        byChapter.set(batch.chapter_id, list)
      }

      const chapterItems = chapters
        // A Chapter cannot have missed a window that ended before it existed.
        // Keep Chapters with history even if they were later deactivated.
        .filter((chapter) => byChapter.has(chapter.id)
          || (chapter.status === 'ACTIVE' && chapter.created_at.getTime() < group.window.endsAt.getTime()))
        .map((chapter) => {
        const list = byChapter.get(chapter.id) || []
        const applied = list
          .filter((batch) => batch.status === 'APPLIED' && batch.applied_at)
          .sort((a, b) => {
            const aAt = actualTransferAt(a.effective_at, a.applied_at)?.getTime() || 0
            const bAt = actualTransferAt(b.effective_at, b.applied_at)?.getTime() || 0
            return bAt - aAt
          })[0]
        const scheduled = list
          .filter((batch) => batch.status === 'SCHEDULED')
          .sort((a, b) => a.effective_at.getTime() - b.effective_at.getTime())[0]
        if (applied) {
          const actualAt = actualTransferAt(applied.effective_at, applied.applied_at)
          const appliedDelayMs = applied.applied_at && actualAt
            ? Math.max(0, applied.applied_at.getTime() - actualAt.getTime())
            : 0
          return {
            id: chapter.id,
            name: chapter.name,
            active: chapter.status === 'ACTIVE',
            status: 'APPLIED',
            statusLabel: 'Đã chuyển giao',
            effectiveAt: applied.effective_at,
            appliedAt: applied.applied_at,
            actualTransferAt: actualAt,
            termNumber: applied.term_number,
            batchCount: list.length,
            lateApplication: appliedDelayMs > LATE_THRESHOLD_MS,
            appliedDelayMinutes: appliedDelayMs > LATE_THRESHOLD_MS ? minutesBetween(applied.applied_at!.getTime(), actualAt!.getTime()) : 0,
            pendingOverdue: false,
            overdueMinutes: null,
            applyAttempts: applied.apply_attempts,
            lastError: applied.last_error,
          }
        }
        if (scheduled) {
          const overdueMs = nowMs - scheduled.effective_at.getTime()
          const pendingOverdue = overdueMs > LATE_THRESHOLD_MS
          return {
            id: chapter.id,
            name: chapter.name,
            active: chapter.status === 'ACTIVE',
            status: 'SCHEDULED',
            statusLabel: 'Đã lên lịch',
            effectiveAt: scheduled.effective_at,
            appliedAt: null,
            actualTransferAt: null,
            termNumber: scheduled.term_number,
            batchCount: list.length,
            lateApplication: false,
            appliedDelayMinutes: null,
            pendingOverdue,
            overdueMinutes: pendingOverdue ? minutesBetween(nowMs, scheduled.effective_at.getTime()) : null,
            applyAttempts: scheduled.apply_attempts,
            lastError: scheduled.last_error,
          }
        }
        return {
          id: chapter.id,
          name: chapter.name,
          active: chapter.status === 'ACTIVE',
          status: 'NONE',
          statusLabel: 'Chưa chuyển giao',
          effectiveAt: null,
          appliedAt: null,
          actualTransferAt: null,
          termNumber: chapter.current_term_number,
          batchCount: list.length,
          lateApplication: false,
          appliedDelayMinutes: null,
          pendingOverdue: false,
          overdueMinutes: null,
          applyAttempts: 0,
          lastError: null,
        }
      }).sort((a, b) => {
        const order = { APPLIED: 0, SCHEDULED: 1, NONE: 2 }
        return order[a.status as keyof typeof order] - order[b.status as keyof typeof order] || a.name.localeCompare(b.name, 'vi')
      }).map((row) => {
        const history = lifetime.get(row.id)
        return { ...row, totalAppliedCount: history?.applied || 0, lastAppliedAt: history?.lastAppliedAt || null }
      })

      const counts = {
        chapters: chapterItems.length,
        transferred: chapterItems.filter((row) => row.status === 'APPLIED').length,
        scheduled: chapterItems.filter((row) => row.status === 'SCHEDULED').length,
        notTransferred: chapterItems.filter((row) => row.status === 'NONE').length,
        overdue: chapterItems.filter((row) => row.pendingOverdue).length,
      }

      return { group, resolution, term, chapterItems, counts }
    })

  const summarize = (item: (typeof rendered)[number]) => ({
    key: groupKey(item.group.window),
    window: {
      startsAt: item.group.window.startsAt,
      endsAt: item.group.window.endsAt,
      anchor: item.group.window.anchor,
      name: describeWindowName(item.group.window),
      label: describeWindow(item.group.window),
    },
    term: {
      startsAt: item.term.startsAt,
      endsAt: item.term.endsAt,
      label: `${formatVietnamDate(item.term.startsAt)} – ${formatVietnamDate(new Date(item.term.endsAt.getTime() - 1))}`,
    },
    status: item.resolution.reason,
    statusLabel: STATUS_LABELS[item.resolution.reason],
    message: item.resolution.message,
    counts: item.counts,
  })

  const requestedMs = windowParam ? Date.parse(windowParam) : NaN
  const selected = (Number.isFinite(requestedMs)
    ? rendered.find((item) => item.group.window.startsAt.getTime() === requestedMs)
    : undefined) || rendered[0] || null

  const windows = rendered.slice(0, MAX_WINDOW_SUMMARIES).map(summarize)
  const selectedKey = selected ? groupKey(selected.group.window) : null
  if (selected && selectedKey && !windows.some((item) => item.key === selectedKey)) windows.push(summarize(selected))

  const items = selected ? (() => {
    const filtered = selected.chapterItems.filter((row) => {
      if (normalizedSearch && !row.name.toLocaleLowerCase('vi').includes(normalizedSearch)) return false
      if (statusFilter === 'OVERDUE') return row.pendingOverdue
      if (statusFilter) return row.status === statusFilter
      return true
    })
    const total = filtered.length
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const currentPage = Math.min(page, totalPages)
    return [{
      ...summarize(selected),
      seasons: selected.group.seasons.map((season) => {
        const state = describeSeasonState(season)
        return {
          id: season.id,
          code: season.code,
          startsAt: season.starts_at,
          endsAt: season.ends_at,
          rewardBoundaryAt: season.reward_boundary_at,
          state: state.state,
          stateLabel: state.label,
        }
      }),
      pagination: { page: currentPage, pageSize, total, totalPages },
      chapters: filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    }]
  })() : []

  return NextResponse.json({
    generatedAt: new Date(),
    labels: {
      effectiveAt: 'Có hiệu lực',
      appliedAt: 'Thực tế áp dụng',
      actualTransferAt: 'Thời gian chuyển giao thực tế',
      term: 'Nhiệm kỳ',
      window: 'Giai đoạn',
    },
    selectedWindowKey: selectedKey,
    windowsTruncated: rendered.length > MAX_WINDOW_SUMMARIES,
    windows,
    items,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
