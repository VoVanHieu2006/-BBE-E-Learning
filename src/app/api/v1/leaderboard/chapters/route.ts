import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parseChapterKpiMonthStart } from '@/lib/chapter-leaderboard-rules'
import { getCachedChapterLeaderboard, setCachedChapterLeaderboard } from '@/lib/chapter-leaderboard-cache'
import { historicalChapterMonthRows } from '@/lib/competition-snapshots'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  await authenticate(request).catch(() => null)
  const now = new Date()
  const requestedMonth = parseChapterKpiMonthStart(new URL(request.url).searchParams.get('month'))
  const requestedKey = requestedMonth ? requestedMonth.toISOString().slice(0, 7) : null

  // Default to the competition month that actually contains now. Selecting the
  // latest KPI row was wrong: a future KPI could make the whole board show 0.
  let compMonth = requestedKey
    ? await prisma.competitionMonth.findUnique({ where: { key: requestedKey } })
    : await prisma.competitionMonth.findFirst({ where: { starts_at: { lte: now }, ends_at: { gt: now } } })

  if (!compMonth && requestedMonth) {
    compMonth = await prisma.competitionMonth.create({
      data: {
        key: requestedKey!,
        starts_at: requestedMonth,
        ends_at: new Date(Date.UTC(requestedMonth.getUTCFullYear(), requestedMonth.getUTCMonth() + 1, 1)),
      },
    })
  }
  const availableMonthRows = await prisma.competitionMonth.findMany({ distinct: ['key'], orderBy: { starts_at: 'desc' }, select: { key: true }, take: 24 })
  const availableMonths = availableMonthRows.map(item => item.key)
  if (!compMonth) {
    return NextResponse.json({
      month: now.toISOString(),
      availableMonths,
      formulaVersion: 'chapter-v8-a-over-n',
      items: [],
      excluded: [],
      state: 'PERIOD_UNAVAILABLE',
    }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const cacheKey = `legacy-chapter:${compMonth.key}`
  const closed = compMonth.ends_at <= now
  // Closed months share the saved ranking with the period API. Never rebuild
  // historical results using today's users, curriculum or affiliations.
  const saved = closed ? await prisma.learningSnapshot.findUnique({ where: { key: `ranking:CHAPTER:${compMonth.id}` } }) : null
  const savedPayload = saved?.payload as any
  if (closed && (!Array.isArray(savedPayload?.items) || savedPayload.items.some((row: any) => !row || typeof row.eligible !== 'boolean' || !('score' in row)))) {
    return NextResponse.json({ month: compMonth.starts_at.toISOString(), monthKey: compMonth.key, availableMonths, items: [], excluded: [], state: 'AWAITING_SNAPSHOT', reasonCode: saved ? 'SNAPSHOT_DATA_MISSING' : 'SNAPSHOT_MISSING' }, { headers: { 'Cache-Control': 'no-store' } })
  }
  const cachedData = !closed ? getCachedChapterLeaderboard(cacheKey) : null
  if (cachedData) return NextResponse.json({ ...cachedData as object, availableMonths }, { headers: { 'Cache-Control': 'no-store' } })
  const [chapters, chapterRows] = await Promise.all([
    prisma.chapter.findMany({ select: { id: true, name: true, description: true } }),
    closed ? Promise.resolve(savedPayload.items as Awaited<ReturnType<typeof historicalChapterMonthRows>>) : historicalChapterMonthRows(prisma, compMonth, now),
  ])
  const chapterDescMap = new Map(chapters.map((chapter) => [chapter.id, chapter.description]))

  const mapRow = (row: (typeof chapterRows)[number]) => ({
    chapterId: row.chapterId,
    id: row.chapterId,
    name: row.chapterName,
    description: chapterDescMap.get(row.chapterId) || null,
    memberCount: Math.round(row.averageMemberCount * 10) / 10,
    totalStars: (row as any).totalStars || 0,
    completion: {
      averagePercent: Math.round(row.at70Rate * 1000) / 10,
      atLeast70Percent: Math.round(row.at70Rate * 1000) / 10,
    },
    stars: {
      total: (row as any).totalStars || 0,
      averagePerMember: row.score ?? 0,
      score: row.score ?? 0,
      achievedAt: (row as any).lastStarAwardedAt || null,
    },
    kpi: { status: row.kpiStatus || 'WAITING_KPI', bonus: 0 },
    size: { score: 0, cappedAt: 51 },
    score: row.score ?? 0,
    rank: row.rank,
    atLeast70Percent: Math.round(row.at70Rate * 1000) / 10,
    kpiStatus: row.kpiStatus || null,
    reasons: row.exclusionReasons,
    eligible: row.eligible,
    dataError: (row as any).dataError || null,
    qualifiedMonthCount: (row as any).qualifiedMonthCount ?? null,
  })
  const mapped = chapterRows.map(mapRow)
  const data = {
    month: compMonth.starts_at.toISOString(),
    monthKey: compMonth.key,
    availableMonths,
    formulaVersion: 'chapter-v8-a-over-n',
    formula: 'Tháng thường: S_m = A_m / N_m; Tháng chuyển giao: S_m = A_1 / N_1 + A_2 / N_2; KPI Vàng/Xanh; >20 thành viên; ≥50% đạt ≥70% bài lõi',
    updatedAt: now.toISOString(),
    state: closed ? savedPayload.state : 'OPEN',
    items: mapped.filter((row) => row.eligible),
    excluded: mapped.filter((row) => !row.eligible),
  }
  if (!closed) setCachedChapterLeaderboard(data, cacheKey)
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
