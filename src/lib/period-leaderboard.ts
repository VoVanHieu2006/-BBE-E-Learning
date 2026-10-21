import { NextRequest, NextResponse } from 'next/server'
import { prisma } from './prisma'
import { authenticate } from './auth'
import { historicalChapterMonthRows, individualPeriodRows, chapterSeasonRows } from './competition-snapshots'
import { dnaSeasonEnd } from './chapter-reward-gate'

/** Closed boards can only be served from a snapshot, never rebuilt from today's roles. */
export async function periodLeaderboard(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const query = request.nextUrl.searchParams
  const group = query.get('group') || 'MEMBER', periodType = query.get('periodType') || 'MONTH'
  if (!['MEMBER', 'LT', 'DNA', 'CHAPTER'].includes(group) || !['MONTH', 'TERM'].includes(periodType)) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
  const policy = await prisma.learningPolicy.findUnique({ where: { id: 'default' } })
  const now = new Date()
  if (!policy?.cutover_at || policy.cutover_at > now || !policy.mapping_approved_at) return NextResponse.json({ items: [], state: 'AWAITING_CUTOVER', group, periodType })
  const periodId = query.get('periodId')
  if (periodId && (periodType === 'MONTH' ? !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId) : !/^[0-9a-f-]{36}$/i.test(periodId))) return NextResponse.json({ error: { code: 'InvalidPeriod' } }, { status: 400 })
  const month = periodType === 'MONTH' ? await prisma.competitionMonth.findFirst({ where: periodId ? { key: periodId } : { starts_at: { lte: now }, ends_at: { gt: now } } }) : null
  const chapterId = query.get('chapterId') || auth.context!.chapterId
  const useSeason = group === 'DNA' || group === 'CHAPTER' && !query.has('chapterId')
  const term = periodType === 'TERM' && !useSeason ? await prisma.chapterCompetitionTerm.findFirst({ where: periodId ? { id: periodId } : { chapter_id: chapterId || '00000000-0000-0000-0000-000000000000', ends_at: null } }) : null
  const season = periodType === 'TERM' && useSeason ? await prisma.transferSeason.findFirst({ where: periodId ? { id: periodId } : group === 'DNA' ? { reward_boundary_at: { lte: now } } : { starts_at: { lte: now }, ends_at: { gt: now } }, orderBy: { reward_boundary_at: 'desc' } }) : null
  const dnaPeriod = group === 'DNA' && season?.reward_boundary_at ? { ...season, starts_at: new Date(Math.max(season.reward_boundary_at.getTime(), policy.cutover_at.getTime())), ends_at: dnaSeasonEnd(season.reward_boundary_at) } : null
  const period = month || term || (group === 'DNA' ? dnaPeriod : season)
  if (!period) return NextResponse.json({ items: [], state: 'PERIOD_UNAVAILABLE', group, periodType })
  const snapshot = await prisma.learningSnapshot.findUnique({ where: { key: `ranking:${group}:${period.id}` } })
  if (snapshot) return NextResponse.json(await hydrateRanking(snapshot.payload), { headers: { 'Cache-Control': 'no-store' } })
  if (period.ends_at && period.ends_at <= now) return NextResponse.json({ items: [], state: 'AWAITING_SNAPSHOT', group, periodType, period })
  if (group === 'CHAPTER') {
    if (season) return NextResponse.json({ ...(await chapterSeasonRows(prisma, season.id, now)), group, periodType, period, formula: 'Tổng điểm các tháng đủ điều kiện; toàn bộ điểm mỗi tháng thuộc nhiệm kỳ chứa ranh giới kết thúc tháng.' })
    let items: any[] = month ? await historicalChapterMonthRows(prisma, month, now) : []
    if (term) {
      const months = await prisma.competitionMonth.findMany({ where: { ends_at: { gt: term.starts_at, lte: now } } })
      const snapshots = await prisma.learningSnapshot.findMany({ where: { key: { in: months.map((value) => `ranking:CHAPTER:${value.id}`) } } })
      const results = snapshots.flatMap((saved) => ((saved.payload as any).items || []).filter((row: any) => row.chapterId === term.chapter_id))
      const chapter = await prisma.chapter.findUnique({ where: { id: term.chapter_id }, select: { name: true } })
      items = [{ chapterId: term.chapter_id, chapterName: chapter?.name || 'Chapter', score: results.filter((row) => row.eligible).reduce((sum, row) => sum + row.score, 0), rank: 1 }]
    }
    return NextResponse.json({ items, state: 'OPEN', group, periodType, period, formula: 'Σ sao giai đoạn / quân số cuối giai đoạn; quân số bình quân >20; tỷ lệ đạt 70% ≥50%; KPI YELLOW/GREEN' })
  }
  const items = await individualPeriodRows(prisma, period.starts_at, new Date(Math.min(period.ends_at?.getTime() || now.getTime(), now.getTime())), group, term?.chapter_id)
  return NextResponse.json(await hydrateRanking({ items, group, periodType, period, state: 'OPEN', formula: 'Tổng sao trong kỳ; đồng sao: thời gian đạt tổng sao cuối, sau đó ID ổn định' }), { headers: { 'Cache-Control': 'no-store' } })
}

async function hydrateRanking(payload: any) {
  if (payload.group === 'CHAPTER') return payload
  const users = await prisma.user.findMany({ where: { id: { in: payload.items.map((row: any) => row.userId) } }, select: { id: true, display_name: true, anonymized_at: true } })
  return { ...payload, items: payload.items.map((row: any) => {
    const user = users.find((value) => value.id === row.userId)
    return { ...row, displayName: user?.anonymized_at ? 'Tài khoản đã gỡ' : user?.display_name || 'Thành viên' }
  }) }
}
