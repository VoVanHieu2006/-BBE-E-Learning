import { NextRequest, NextResponse } from 'next/server'
import { prisma } from './prisma'
import { authenticate } from './auth'
import { historicalChapterMonthRows, individualPeriodRows, chapterSeasonRows, competitionCohortAt } from './competition-snapshots'
import { dnaSeasonEnd } from './chapter-reward-gate'
import { getLearningManagerKind } from './manager-learning-access'
import { listAccessibleChapterIds, listManagedOrganizationUnits } from './authorization'
import { listChapterLearners } from './chapter-members'
import { currentLearningAffiliation } from './affiliation-access'
import { readLearningReadiness } from './learning-readiness'
import { readinessForReason } from './learning-readiness-rules'

async function currentChapterMetadata(chapterIds: string[], asOf: Date) {
  return new Map(await Promise.all(chapterIds.map(async id => [id, {
    currentRosterCount: (await listChapterLearners(id, { asOf })).length, rosterAsOf: asOf, dataAsOf: asOf,
  }] as const)))
}

type Group = 'MEMBER' | 'LT' | 'DNA' | 'CHAPTER'
type PeriodType = 'MONTH' | 'TERM'

const GROUPS: Group[] = ['MEMBER', 'LT', 'DNA', 'CHAPTER']
const PERIOD_TYPES: PeriodType[] = ['MONTH', 'TERM']

const CHAPTER_FORMULA = 'Tháng thường: S_m = A_m / N_m · Tháng chuyển giao: S_m = A_1 / N_1 + A_2 / N_2 · Điều kiện: KPI Vàng/Xanh, quân số >20, ≥50% thành viên đạt ≥70% bài lõi.'
const INDIVIDUAL_FORMULA = 'Tổng sao phát sinh trong kỳ; phá hòa theo thời điểm đạt tổng sao cuối (đến giây), bằng nhau đồng hạng.'

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

  const requestedChapterId = query.get('chapterId')
  let chapterId: string | null = null
  let managedChapterIds: string[] = []
  let managedDnaUnitIds: string[] = []
  const ownChapterId: string | null = context?.chapterId || null

  if (isGuest || isAdmin) {
    // Admin and Guest default to global system-wide.
    // If and only if an explicit chapterId was requested, apply that filter.
    chapterId = requestedChapterId || null
  } else if (managerKind === 'LEAD_CHAPTER') {
    managedChapterIds = await listAccessibleChapterIds(context!, 'VIEW_MEMBER_PROGRESS')
    if (!['MEMBER', 'LT'].includes(group)) return unauthorized('Lead Chapter chỉ được xem bảng Thành viên và LT trong Chapter mình quản lý.')
    if (!managedChapterIds.length) return unauthorized('Tài khoản chưa được gán Chapter quản lý.')
    if (requestedChapterId && !managedChapterIds.includes(requestedChapterId)) return unauthorized()
    chapterId = requestedChapterId || managedChapterIds[0] || null
  } else if (managerKind === 'LEAD_DNA') {
    const units = await listManagedOrganizationUnits(context!)
    managedDnaUnitIds = units.filter((unit) => unit.type === 'DNA' || unit.type === 'DNA_GROUP').map((unit) => unit.id)
    if (group !== 'DNA') return unauthorized('Lead DNA chỉ được xem bảng xếp hạng DNA trong phạm vi quản lý.')
    if (!managedDnaUnitIds.length) return unauthorized('Tài khoản chưa được gán đơn vị DNA quản lý.')
  } else if (context?.role === 'MEMBER') {
    // Authenticated regular member
    const affiliation = await currentLearningAffiliation(context.userId)

    if (affiliation.dnaUnitIds.length) {
      if (group !== 'DNA') return unauthorized('Thành viên Khối DNA chỉ được xem bảng xếp hạng Khối DNA.')
      managedDnaUnitIds = affiliation.dnaUnitIds
    } else {
      if (!['MEMBER', 'LT'].includes(group)) return unauthorized('Thành viên Chapter chỉ được xem bảng Thành viên và LT trong Chapter của mình.')
      const memberChapterId = affiliation.chapterId
      if (!memberChapterId) return unauthorized('Tài khoản thành viên chưa thuộc Chapter nào.')
      if (requestedChapterId && requestedChapterId !== memberChapterId) return unauthorized('Bạn chỉ được xem bảng xếp hạng của Chapter mình thuộc.')
      chapterId = memberChapterId
    }
  }

  const now = new Date()
  const readiness = await readLearningReadiness(prisma, now)
  const policy = readiness.policy
  // A public board may still be viewed before cutover (it will simply be empty);
  // authenticated managers get an explicit state instead of a misleading zero.
  if (!readiness.ready) return NextResponse.json({ items: [], state: 'AWAITING_CUTOVER', group, periodType, readiness, reasonCode: readiness.reasonCode, message: readiness.message })

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
          ? { id: periodId, ...(chapterId ? { chapter_id: chapterId } : {}) }
          : {
              chapter_id: chapterId || '00000000-0000-0000-0000-000000000000',
              starts_at: { lte: now },
              OR: [{ ends_at: null }, { ends_at: { gt: now } }],
            },
        orderBy: { starts_at: 'desc' },
      })
    : null

  if (periodId && periodType === 'TERM' && !useSeason && !useGlobalIndividualTerm && !term && chapterId) {
    const foreignTerm = await prisma.chapterCompetitionTerm.findUnique({ where: { id: periodId }, select: { chapter_id: true } })
    if (foreignTerm && foreignTerm.chapter_id !== chapterId) {
      return unauthorized('Bạn không có quyền xem kỳ thi đua của Chapter khác.')
    }
  }

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
  if (!period) {
    const missing = readinessForReason(periodType === 'MONTH' ? 'MONTH_NOT_CONFIGURED' : useSeason || useGlobalIndividualTerm ? 'SEASON_NOT_CONFIGURED' : 'TERM_NOT_CONFIGURED')
    return NextResponse.json({ items: [], state: 'PERIOD_UNAVAILABLE', group, periodType, ...missing, readiness: missing, formula: group === 'CHAPTER' ? CHAPTER_FORMULA : INDIVIDUAL_FORMULA })
  }

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
    if (group === 'CHAPTER' && payload.items) {
      payload = {
        ...payload,
        items: payload.items.map((row: any) => ({
          ...row,
          name: row.name || row.chapterName,
          id: row.id || row.chapterId,
          qualifiedMonthCount: row.qualifiedMonthCount ?? null,
        })),
      }
    }
    return NextResponse.json(await hydrateRanking(payload, isGuest), { headers: { 'Cache-Control': 'no-store' } })
  }
  if (period.ends_at && period.ends_at <= now) {
    return NextResponse.json({ items: [], state: 'AWAITING_SNAPSHOT', ...readinessForReason('SNAPSHOT_MISSING'), group, periodType, period, formula: group === 'CHAPTER' ? CHAPTER_FORMULA : INDIVIDUAL_FORMULA })
  }

  // Closed snapshots returned above remain immutable. Live affiliation-sensitive
  // rankings are read fresh, including changes committed by another server.
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
          const metadata = await currentChapterMetadata(liveRows.map(row => row.chapterId), now)
          const liveItems = liveRows.map((row) => ({
            ...metadata.get(row.chapterId),
            conditions: row.conditions,
            averageMemberCount: row.averageMemberCount,
            id: row.chapterId,
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
            qualifiedMonthCount: (row as any).qualifiedMonthCount ?? null,
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
          return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } })
        }
      }
      const result = await chapterSeasonRows(prisma, season.id, now)
      const seasonItems = result.items.map((item) => ({
        ...item,
        id: item.chapterId,
        name: item.chapterName,
        qualifiedMonthCount: item.qualifiedMonthCount ?? 0,
      }))
      return NextResponse.json({
        ...result,
        group,
        periodType,
        period,
        formula: CHAPTER_FORMULA,
        items: seasonItems.filter((item) => item.eligible),
        excluded: seasonItems.filter((item) => !item.eligible),
      }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (!month) {
      return NextResponse.json({ items: [], state: 'PERIOD_UNAVAILABLE', group, periodType, formula: CHAPTER_FORMULA })
    }
    const rows = await historicalChapterMonthRows(prisma, month, now)
    const metadata = await currentChapterMetadata(rows.map(row => row.chapterId), now)
    const formulaRows = rows.map((row) => ({
      ...metadata.get(row.chapterId),
      conditions: row.conditions,
      averageMemberCount: row.averageMemberCount,
      chapterId: row.chapterId,
      id: row.chapterId,
      name: row.chapterName,
      memberCount: Math.round(row.averageMemberCount * 10) / 10,
      totalStars: (row as any).totalStars || 0,
      score: row.score,
      atLeast70Percent: Math.round(row.at70Rate * 1000) / 10,
      kpiStatus: row.kpiStatus || null,
      rank: row.rank,
      eligible: row.eligible,
      exclusionReasons: row.exclusionReasons,
      dataError: (row as any).dataError || null,
      qualifiedMonthCount: (row as any).qualifiedMonthCount ?? null,
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
    return NextResponse.json(chapterPayload, { headers: { 'Cache-Control': 'no-store' } })
  }

  const items = await individualPeriodRows(
    prisma,
    period.starts_at,
    new Date(Math.min(period.ends_at?.getTime() || now.getTime(), now.getTime())),
    group,
    group === 'DNA' ? undefined : term?.chapter_id || chapterId || undefined,
    group === 'DNA' ? managedDnaUnitIds : undefined,
    season?.id,
  )
  const individualPayload = await hydrateRanking({
    items,
    group,
    periodType,
    period,
    state: 'OPEN',
    formula: INDIVIDUAL_FORMULA,
  }, isGuest)
  return NextResponse.json(individualPayload, { headers: { 'Cache-Control': 'no-store' } })
}

async function hydrateRanking(payload: any, isGuest = false) {
  if (payload.group === 'CHAPTER') return payload
  const items = payload.items || []
  if (!items.length) return payload

  const userIds = items.map((row: any) => row.userId).filter(Boolean)
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, display_name: true, email: true, anonymized_at: true },
      })
    : []

  const lacksHistorical = items.some((row: any) => !row.departmentName || !row.positionName || (payload.group !== 'DNA' && !row.chapterName))
  let historicalCohort: any[] | null = null
  if (lacksHistorical && payload.period) {
    try {
      const atDate = new Date(payload.period.ends_at || payload.period.starts_at || Date.now())
      historicalCohort = await competitionCohortAt(prisma, atDate)
    } catch {
      historicalCohort = null
    }
  }

  return {
    ...payload,
    items: items.map((row: any) => {
      const user = users.find((value) => value.id === row.userId)
      const historical = historicalCohort?.find((c: any) => c.userId === row.userId)
      const departmentName = row.departmentName || historical?.departmentName || null
      const positionName = row.positionName || historical?.positionName || null
      const chapterName = row.chapterName || historical?.chapterName || null
      const groupName = row.dnaUnitName || departmentName || row.groupName || null

      const baseRow: any = {
        ...row,
        displayName: user?.anonymized_at ? 'Tài khoản đã gỡ' : user?.display_name || row.displayName || 'Thành viên',
        departmentName,
        positionName,
        chapterName,
        groupName,
        stars: row.stars ?? 0,
      }

      if (isGuest) {
        delete baseRow.email
      } else {
        baseRow.email = user?.email || row.email || null
      }
      return baseRow
    }),
  }
}
