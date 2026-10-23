import { NextRequest, NextResponse } from 'next/server'
import { prisma } from './prisma'
import { authenticate } from './auth'
import { historicalChapterMonthRows, individualPeriodRows, chapterSeasonRows } from './competition-snapshots'
import { dnaSeasonEnd } from './chapter-reward-gate'
import { getLearningManagerKind } from './manager-learning-access'
import { listAccessibleChapterIds, listManagedOrganizationUnits } from './authorization'
import { getCachedChapterLeaderboard, setCachedChapterLeaderboard } from './chapter-leaderboard-cache'

type Group = 'MEMBER' | 'LT' | 'DNA' | 'CHAPTER'
type PeriodType = 'MONTH' | 'TERM'

const GROUPS: Group[] = ['MEMBER', 'LT', 'DNA', 'CHAPTER']
const PERIOD_TYPES: PeriodType[] = ['MONTH', 'TERM']

const CHAPTER_FORMULA = 'S_m = A_m / N_m · A_m = tổng sao trong kỳ · N_m = quân số active bình quân (có trọng số thời gian khi chuyển giao) · KPI Vàng/Xanh · quân số >20 · ≥50% thành viên đạt ≥70% bài lõi.'
const INDIVIDUAL_FORMULA = 'Tổng sao phát sinh trong kỳ; đồng hạng theo thời điểm đạt tổng sao cuối, sau đó theo ID ổn định.'

function unauthorized(message = 'Bạn không có quyền xem bảng xếp hạng này.') {
  return NextResponse.json({ error: { code: 'AccessDenied', message } }, { status: 403 })
}

/** Closed boards are served only from saved snapshots, never rebuilt from today's roles. */
export async function periodLeaderboard(request: NextRequest) {
  const auth = await authenticate(request).catch(() => ({ ok: false as const }))
  const query = request.nextUrl.searchParams
  const group = (query.get('group') || 'MEMBER') as Group
  const periodType = (query.get('periodType') || 'MONTH') as PeriodType
  if (!GROUPS.includes(group) || !PERIOD_TYPES.includes(periodType)) {
    return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
  }

  const context = auth.ok ? (auth as any).context! : null
  const isGuest = !context
  const isAdmin = context?.role === 'ADMIN'
  const managerKind = context && !isAdmin ? await getLearningManagerKind(context.userId, context.role) : null

  let managedChapterIds: string[] = []
  let managedDnaUnitIds: string[] = []
  let ownChapterId: string | null = context?.chapterId || null

  if (managerKind === 'LEAD_CHAPTER') {
    managedChapterIds = await listAccessibleChapterIds(context!, 'VIEW_MEMBER_PROGRESS')
    if (!managedChapterIds.length && ownChapterId) managedChapterIds = [ownChapterId]
    if (!['MEMBER', 'LT'].includes(group)) return unauthorized('Lead Chapter chỉ được xem bảng Thành viên và LT trong Chapter mình quản lý.')
    if (!managedChapterIds.length) return unauthorized('Tài khoản chưa được gán Chapter quản lý.')
  }
  if (managerKind === 'LEAD_DNA') {
    const units = await listManagedOrganizationUnits(context!)
    managedDnaUnitIds = units.filter((unit) => unit.type === 'DNA' || unit.type === 'DNA_GROUP').map((unit) => unit.id)
    if (group !== 'DNA') return unauthorized('Lead DNA chỉ được xem bảng xếp hạng DNA trong phạm vi quản lý.')
    if (!managedDnaUnitIds.length) return unauthorized('Tài khoản chưa được gán đơn vị DNA quản lý.')
  }

  const requestedChapterId = query.get('chapterId')
  let chapterId: string | null = requestedChapterId || ownChapterId
  if (managerKind === 'LEAD_CHAPTER') {
    if (chapterId && !managedChapterIds.includes(chapterId)) return unauthorized()
    chapterId = chapterId || managedChapterIds[0] || null
  }
  if ((group === 'MEMBER' || group === 'LT') && !chapterId && !isAdmin && !isGuest) {
    // A member can use the public unscoped board, but a Chapter manager must
    // always be constrained to an authorized Chapter.
    if (managerKind === 'LEAD_CHAPTER') return unauthorized()
  }

  const policy = await prisma.learningPolicy.findUnique({ where: { id: 'default' } })
  const now = new Date()
  // A public board may still be viewed before cutover (it will simply be empty);
  // authenticated managers get an explicit state instead of a misleading zero.
  if (!policy?.cutover_at || policy.cutover_at > now || !policy.mapping_approved_at) {
    if (!isGuest) return NextResponse.json({ items: [], state: 'AWAITING_CUTOVER', group, periodType })
  }

  const periodId = query.get('periodId')
  if (periodId && (periodType === 'MONTH' ? !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId) : !/^[0-9a-f-]{36}$/i.test(periodId))) {
    return NextResponse.json({ error: { code: 'InvalidPeriod' } }, { status: 400 })
  }

  const month = periodType === 'MONTH'
    ? await prisma.competitionMonth.findFirst({ where: periodId ? { key: periodId } : { starts_at: { lte: now }, ends_at: { gt: now } } })
    : null
  const useSeason = group === 'DNA' || (group === 'CHAPTER' && !chapterId)
  const useGlobalIndividualTerm = periodType === 'TERM' && !chapterId && (group === 'MEMBER' || group === 'LT')
  const term = periodType === 'TERM' && !useSeason && !useGlobalIndividualTerm
    ? await prisma.chapterCompetitionTerm.findFirst({
        where: periodId
          ? { id: periodId }
          : {
              chapter_id: chapterId || '00000000-0000-0000-0000-000000000000',
              starts_at: { lte: now },
              OR: [{ ends_at: null }, { ends_at: { gt: now } }],
            },
        orderBy: { starts_at: 'desc' },
      })
    : null
  const season = periodType === 'TERM' && (useSeason || useGlobalIndividualTerm)
    ? await prisma.transferSeason.findFirst({
        where: periodId
          ? { id: periodId }
          : group === 'DNA'
            ? { reward_boundary_at: { lte: now } }
            : { starts_at: { lte: now }, ends_at: { gt: now } },
        orderBy: { reward_boundary_at: 'desc' },
      })
    : null
  const dnaPeriod = group === 'DNA' && season?.reward_boundary_at && policy?.cutover_at
    ? {
        ...season,
        starts_at: new Date(Math.max(season.reward_boundary_at.getTime(), policy.cutover_at.getTime())),
        ends_at: dnaSeasonEnd(season.reward_boundary_at),
      }
    : null
  const period = month || term || (group === 'DNA' ? dnaPeriod : season) || (group === 'CHAPTER' ? season : null)
  if (!period) return NextResponse.json({ items: [], state: 'PERIOD_UNAVAILABLE', group, periodType, formula: group === 'CHAPTER' ? CHAPTER_FORMULA : INDIVIDUAL_FORMULA })

  const snapshot = await prisma.learningSnapshot.findUnique({ where: { key: `ranking:${group}:${period.id}` } })
  if (snapshot) {
    let payload = snapshot.payload as any
    if ((group === 'MEMBER' || group === 'LT') && chapterId) {
      payload = { ...payload, items: (payload.items || []).filter((row: any) => row.chapterId === chapterId) }
    }
    if (group === 'DNA' && managedDnaUnitIds.length) {
      const allowed = new Set(managedDnaUnitIds)
      payload = { ...payload, items: (payload.items || []).filter((row: any) => row.dnaUnitId && allowed.has(row.dnaUnitId)) }
    }
    return NextResponse.json(await hydrateRanking(payload), { headers: { 'Cache-Control': 'no-store' } })
  }
  if (period.ends_at && period.ends_at <= now) {
    return NextResponse.json({ items: [], state: 'AWAITING_SNAPSHOT', group, periodType, period, formula: group === 'CHAPTER' ? CHAPTER_FORMULA : INDIVIDUAL_FORMULA })
  }

  const cacheKey = `period:${group}:${period.id}:${chapterId || ''}:${managedDnaUnitIds.join(',')}`
  const cached = getCachedChapterLeaderboard(cacheKey)
  if (cached) return NextResponse.json(cached, { headers: { 'Cache-Control': 'no-store' } })

  if (group === 'CHAPTER') {
    if (season) {
      // The current season has no closed month yet. Show a clearly labelled
      // live term-to-date board instead of an empty WAITING_KPI table.
      if ((!season.ends_at || season.ends_at > now) && season.starts_at <= now) {
        const liveMonth = await prisma.competitionMonth.findFirst({
          where: { starts_at: { lte: now }, ends_at: { gt: now } },
        })
        if (liveMonth) {
          const liveRows = await historicalChapterMonthRows(prisma, liveMonth, now)
          const liveItems = liveRows.map((row) => ({
            chapterId: row.chapterId,
            name: row.chapterName,
            memberCount: Math.round(row.averageMemberCount * 10) / 10,
            totalStars: (row as any).totalStars || 0,
            score: row.score,
            atLeast70Percent: Math.round(row.at70Rate * 1000) / 10,
            kpiStatus: row.kpiStatus,
            rank: row.rank,
            eligible: row.eligible,
            exclusionReasons: row.exclusionReasons,
          }))
          const payload = {
            group,
            periodType,
            period: { ...season, currentMonth: liveMonth },
            state: 'OPEN',
            formula: `${CHAPTER_FORMULA} (tạm tính tháng ${liveMonth.key}; nhiệm kỳ chưa chốt)`,
            items: liveItems.filter((row) => row.eligible),
            excluded: liveItems.filter((row) => !row.eligible),
          }
          setCachedChapterLeaderboard(payload, cacheKey)
          return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } })
        }
      }
      const result = await chapterSeasonRows(prisma, season.id, now)
      return NextResponse.json({
        ...result,
        group,
        periodType,
        period,
        formula: CHAPTER_FORMULA,
        items: result.items.filter((item) => item.eligible),
        excluded: result.items.filter((item) => !item.eligible),
      }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (!month) {
      return NextResponse.json({ items: [], state: 'PERIOD_UNAVAILABLE', group, periodType, formula: CHAPTER_FORMULA })
    }
    const rows = await historicalChapterMonthRows(prisma, month, now)
    const formulaRows = rows.map((row) => ({
      chapterId: row.chapterId,
      id: row.chapterId,
      name: row.chapterName,
      memberCount: Math.round(row.averageMemberCount * 10) / 10,
      totalStars: (row as any).totalStars || 0,
      score: row.score !== null ? Math.round(row.score * 100) / 100 : null,
      atLeast70Percent: Math.round(row.at70Rate * 1000) / 10,
      kpiStatus: row.kpiStatus || null,
      rank: row.rank,
      eligible: row.eligible,
      exclusionReasons: row.exclusionReasons,
      dataError: (row as any).dataError || null,
    }))
    const chapterPayload = {
      group,
      periodType,
      period,
      state: 'OPEN',
      formula: CHAPTER_FORMULA,
      items: formulaRows.filter((row) => row.eligible),
      excluded: formulaRows.filter((row) => !row.eligible),
    }
    setCachedChapterLeaderboard(chapterPayload, cacheKey)
    return NextResponse.json(chapterPayload, { headers: { 'Cache-Control': 'no-store' } })
  }

  const items = await individualPeriodRows(
    prisma,
    period.starts_at,
    new Date(Math.min(period.ends_at?.getTime() || now.getTime(), now.getTime())),
    group,
    group === 'DNA' ? undefined : term?.chapter_id || chapterId || undefined,
    group === 'DNA' ? managedDnaUnitIds : undefined,
  )
  const individualPayload = await hydrateRanking({
    items,
    group,
    periodType,
    period,
    state: 'OPEN',
    formula: INDIVIDUAL_FORMULA,
  })
  setCachedChapterLeaderboard(individualPayload, cacheKey)
  return NextResponse.json(individualPayload, { headers: { 'Cache-Control': 'no-store' } })
}

async function hydrateRanking(payload: any) {
  if (payload.group === 'CHAPTER') return payload
  const items = payload.items || []
  const users = items.length
    ? await prisma.user.findMany({
        where: { id: { in: items.map((row: any) => row.userId) } },
        select: { id: true, display_name: true, anonymized_at: true },
      })
    : []
  return {
    ...payload,
    items: items.map((row: any) => {
      const user = users.find((value) => value.id === row.userId)
      return {
        ...row,
        displayName: user?.anonymized_at ? 'Tài khoản đã gỡ' : user?.display_name || 'Thành viên',
        groupName: row.dnaUnitName || row.groupName || null,
      }
    }),
  }
}
