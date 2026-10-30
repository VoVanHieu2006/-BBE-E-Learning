import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { actualTransferAt, describeWindow, windowOf } from '@/lib/transfer-windows'

export const dynamic = 'force-dynamic'

const HISTORY_LIMIT = 50
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const STATUS_LABELS: Record<string, string> = {
  APPLIED: 'Đã áp dụng',
  SCHEDULED: 'Đang lên lịch',
  CANCELLED: 'Đã hủy',
  DRAFT: 'Nháp',
}

export async function GET(request: NextRequest, { params }: { params: { chapterId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok || auth.context?.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Bạn không có quyền xem lịch sử chuyển giao nhiệm kỳ.' } }, { status: 403 })
  }
  if (!UUID_RE.test(params.chapterId)) {
    return NextResponse.json({ error: { code: 'ChapterNotFound', message: 'Không tìm thấy chapter.' } }, { status: 404 })
  }

  const [chapter, grouped, entries, latestApplied, seasons] = await Promise.all([
    prisma.chapter.findUnique({ where: { id: params.chapterId }, select: { id: true, name: true, status: true } }),
    prisma.chapterReorganization.groupBy({ by: ['status'], where: { chapter_id: params.chapterId }, _count: { _all: true } }),
    prisma.chapterReorganization.findMany({
      where: { chapter_id: params.chapterId },
      select: {
        id: true,
        status: true,
        effective_at: true,
        applied_at: true,
        term_number: true,
        transfer_season_id: true,
        apply_attempts: true,
        last_error: true,
      },
      orderBy: { effective_at: 'desc' },
      take: HISTORY_LIMIT,
    }),
    prisma.chapterReorganization.findFirst({
      where: { chapter_id: params.chapterId, status: 'APPLIED', applied_at: { not: null } },
      orderBy: { applied_at: 'desc' },
      select: { effective_at: true, applied_at: true },
    }),
    prisma.transferSeason.findMany({ select: { id: true, code: true } }),
  ])

  if (!chapter) {
    return NextResponse.json({ error: { code: 'ChapterNotFound', message: 'Không tìm thấy chapter.' } }, { status: 404 })
  }

  const countOf = (status: string) => grouped.find((row) => row.status === status)?._count._all || 0
  const seasonCodes = new Map(seasons.map((season) => [season.id, season.code]))
  const totalEntries = grouped.reduce((sum, row) => sum + row._count._all, 0)

  return NextResponse.json({
    generatedAt: new Date(),
    chapter: { id: chapter.id, name: chapter.name, active: chapter.status === 'ACTIVE' },
    summary: {
      appliedCount: countOf('APPLIED'),
      scheduledCount: countOf('SCHEDULED'),
      cancelledCount: countOf('CANCELLED'),
      lastAppliedAt: latestApplied ? actualTransferAt(latestApplied.effective_at, latestApplied.applied_at) : null,
    },
    entries: entries.map((batch) => {
      const window = windowOf(batch.effective_at)
      return {
        id: batch.id,
        status: batch.status,
        statusLabel: STATUS_LABELS[batch.status] || batch.status,
        windowKey: window.startsAt.toISOString(),
        windowLabel: describeWindow(window),
        effectiveAt: batch.effective_at,
        appliedAt: batch.applied_at,
        actualTransferAt: actualTransferAt(batch.effective_at, batch.applied_at),
        termNumber: batch.term_number,
        seasonCode: batch.transfer_season_id ? seasonCodes.get(batch.transfer_season_id) || null : null,
        applyAttempts: batch.apply_attempts,
        lastError: batch.last_error,
      }
    }),
    entriesTruncated: totalEntries > HISTORY_LIMIT,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
