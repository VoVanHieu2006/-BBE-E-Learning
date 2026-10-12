import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessChapterPermission } from '@/lib/authorization'
import { normalizeChapterKpiInput } from '@/lib/chapter-leaderboard-rules'
import { invalidateChapterLeaderboardCache } from '@/lib/chapter-leaderboard-cache'

export async function GET(request: NextRequest, { params }: { params: { chapterId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (!await canAccessChapterPermission(auth.context!, params.chapterId, 'VIEW_MEMBER_PROGRESS')) {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }
  const items = await prisma.chapterMonthlyKpi.findMany({ where: { chapter_id: params.chapterId }, orderBy: { month_start: 'desc' } })
  return NextResponse.json({ items: items.map((item) => ({ month: item.month_start, status: item.status, note: item.note, updatedAt: item.updated_at })) })
}

export async function PUT(request: NextRequest, { params }: { params: { chapterId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context?.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied', message: 'Only Admin configures KPI.' } }, { status: 403 })
  const body = await request.json().catch(() => null)
  const input = normalizeChapterKpiInput(body)
  if (!input) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
  const chapter = await prisma.chapter.findUnique({ where: { id: params.chapterId }, select: { id: true } })
  if (!chapter) return NextResponse.json({ error: { code: 'NotFound' } }, { status: 404 })
  const item = await prisma.chapterMonthlyKpi.upsert({
    where: { chapter_id_month_start: { chapter_id: params.chapterId, month_start: input.monthStart } },
    create: { chapter_id: params.chapterId, month_start: input.monthStart, status: input.status, note: input.note, configured_by_user_id: auth.context.userId },
    update: { status: input.status, note: input.note, configured_by_user_id: auth.context.userId },
  })
  invalidateChapterLeaderboardCache()
  return NextResponse.json({ month: item.month_start, status: item.status, note: item.note })
}
