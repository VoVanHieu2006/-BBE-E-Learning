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

type BatchRow = {
  id: string
  chapter_id: string
  effective_at: Date
  applied_at: Date | null
  status: string
  term_number: number | null
  transfer_season_id: string | null
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

  const [chapters, seasons, batches] = await Promise.all([
    prisma.chapter.findMany({ select: { id: true, name: true, status: true, current_term_number: true, created_at: true }, orderBy: { name: 'asc' } }),
    prisma.transferSeason.findMany({ orderBy: { starts_at: 'desc' } }),
    prisma.chapterReorganization.findMany({
      where: { status: { in: ['APPLIED', 'SCHEDULED'] } },
      select: { id: true, chapter_id: true, effective_at: true, applied_at: true, status: true, term_number: true, transfer_season_id: true },
      orderBy: { effective_at: 'desc' },
    }),
  ])

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

  const items = Array.from(groups.values())
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
            lateApplication: Boolean(applied.applied_at && applied.effective_at.getTime() < applied.applied_at.getTime() - 60_000),
          }
        }
        if (scheduled) {
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
        }
      }).sort((a, b) => {
        const order = { APPLIED: 0, SCHEDULED: 1, NONE: 2 }
        return order[a.status as keyof typeof order] - order[b.status as keyof typeof order] || a.name.localeCompare(b.name, 'vi')
      })

      const counts = {
        chapters: chapterItems.length,
        transferred: chapterItems.filter((row) => row.status === 'APPLIED').length,
        scheduled: chapterItems.filter((row) => row.status === 'SCHEDULED').length,
        notTransferred: chapterItems.filter((row) => row.status === 'NONE').length,
      }

      return {
        key: groupKey(group.window),
        window: {
          startsAt: group.window.startsAt,
          endsAt: group.window.endsAt,
          anchor: group.window.anchor,
          name: describeWindowName(group.window),
          label: describeWindow(group.window),
        },
        term: {
          startsAt: term.startsAt,
          endsAt: term.endsAt,
          label: `${formatVietnamDate(term.startsAt)} – ${formatVietnamDate(new Date(term.endsAt.getTime() - 1))}`,
        },
        status: resolution.reason,
        statusLabel: STATUS_LABELS[resolution.reason],
        message: resolution.message,
        seasons: group.seasons.map((season) => {
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
        counts,
        chapters: chapterItems,
      }
    })

  return NextResponse.json({
    generatedAt: new Date(),
    labels: {
      effectiveAt: 'Có hiệu lực',
      appliedAt: 'Thực tế áp dụng',
      actualTransferAt: 'Thời gian chuyển giao thực tế',
      term: 'Nhiệm kỳ',
      window: 'Giai đoạn',
    },
    items,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
