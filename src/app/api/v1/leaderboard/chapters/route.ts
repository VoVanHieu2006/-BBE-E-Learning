import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CHAPTER_LEADERBOARD_WEIGHTS, parseChapterKpiMonthStart } from '@/lib/chapter-leaderboard-rules'
import { getCachedChapterLeaderboard, setCachedChapterLeaderboard } from '@/lib/chapter-leaderboard-cache'
import { historicalChapterMonthRows } from '@/lib/competition-snapshots'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  await authenticate(request).catch(() => null)
  const requestedMonth = parseChapterKpiMonthStart(new URL(request.url).searchParams.get('month'))
  const latestKpi = requestedMonth ? null : await prisma.chapterMonthlyKpi.findFirst({ orderBy: { month_start: 'desc' }, select: { month_start: true } })
  const now = new Date()
  const monthStart = requestedMonth || latestKpi?.month_start || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1))
  const asOf = now < nextMonth ? now : new Date(nextMonth.getTime() - 1)
  const monthKey = monthStart.toISOString().slice(0, 7)
  const cacheKey = monthKey
  const cachedData = getCachedChapterLeaderboard(cacheKey)
  if (cachedData) return NextResponse.json(cachedData, { headers: { 'Cache-Control': 'no-store' } })

  let compMonth = await prisma.competitionMonth.findFirst({
    where: { OR: [{ key: monthKey }, { starts_at: { lte: monthStart }, ends_at: { gt: monthStart } }] },
  })
  if (!compMonth) {
    compMonth = await prisma.competitionMonth.create({
      data: {
        key: monthKey,
        starts_at: monthStart,
        ends_at: nextMonth,
        state: nextMonth <= now ? 'CLOSED' : 'OPEN',
      },
    })
  }

  const [chapters, kpis, availableMonths] = await Promise.all([
    prisma.chapter.findMany({ select: { id: true, name: true, description: true } }),
    prisma.chapterMonthlyKpi.findMany({ where: { month_start: { gte: monthStart, lt: nextMonth } }, select: { chapter_id: true, status: true, updated_at: true } }),
    prisma.chapterMonthlyKpi.findMany({ distinct: ['month_start'], orderBy: { month_start: 'desc' }, select: { month_start: true } }),
  ])
  const chapterDescMap = new Map(chapters.map((c) => [c.id, c.description]))

  const chapterRows = await historicalChapterMonthRows(prisma, compMonth, asOf)

  const items = chapterRows.filter((r) => r.eligible).map((r) => ({
    chapterId: r.chapterId,
    id: r.chapterId,
    name: r.chapterName,
    description: chapterDescMap.get(r.chapterId) || null,
    memberCount: Math.round(r.averageMemberCount * 10) / 10,
    completion: {
      averagePercent: Math.round(r.at70Rate * 1000) / 10,
      atLeast70Percent: Math.round(r.at70Rate * 1000) / 10,
    },
    stars: {
      averagePerMember: r.score !== null ? Math.round(r.score * 100) / 100 : 0,
      score: r.score !== null ? Math.round(r.score * 100) / 100 : 0,
      achievedAt: null,
    },
    kpi: {
      status: r.kpiStatus || 'WAITING_KPI',
      bonus: 0,
    },
    size: {
      score: 0,
      cappedAt: 51,
    },
    score: r.score !== null ? Math.round(r.score * 100) / 100 : 0,
    rank: r.rank,
  }))

  const excluded = chapterRows.filter((r) => !r.eligible).map((r) => ({
    chapterId: r.chapterId,
    id: r.chapterId,
    name: r.chapterName,
    description: chapterDescMap.get(r.chapterId) || null,
    memberCount: Math.round(r.averageMemberCount * 10) / 10,
    atLeast70Percent: Math.round(r.at70Rate * 1000) / 10,
    kpiStatus: r.kpiStatus || null,
    reasons: r.exclusionReasons,
    dataError: (r as any).dataError || null,
  }))

  const data = {
    month: monthStart.toISOString(),
    availableMonths: availableMonths.map((item) => item.month_start.toISOString().slice(0, 7)),
    formulaVersion: 'chapter-v7-canonical',
    updatedAt: new Date().toISOString(),
    sourceUpdatedAt: kpis.reduce<string | null>((latest, kpi) => !latest || kpi.updated_at.toISOString() > latest ? kpi.updated_at.toISOString() : latest, null),
    weights: CHAPTER_LEADERBOARD_WEIGHTS,
    items,
    excluded,
  }
  setCachedChapterLeaderboard(data, cacheKey)
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
