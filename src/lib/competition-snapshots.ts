import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { competitionGroup, chapterCompetitionScore, ChapterStage } from './competition-ranking-rules'
import { firstReachedFinalBalance } from './learning-cycle-rules'
import { lockLearningUser } from './learning-periods'
import { dnaSeasonEnd } from './chapter-reward-gate'

type Tx = Prisma.TransactionClient
const leftBoundary = (at: Date) => ({ starts_at: { lt: at }, OR: [{ ends_at: null }, { ends_at: { gte: at } }] })

export async function competitionKpiAt(tx: Tx, chapterId: string, month: string, at: Date) {
  const history = await tx.learningSnapshot.findMany({ where: { kind: 'CHAPTER_KPI_HISTORY', AND: [{ payload: { path: ['chapterId'], equals: chapterId } }, { payload: { path: ['month'], equals: month } }] }, orderBy: { captured_at: 'asc' } })
  const earlier = history.filter((row) => row.captured_at < at)
  const saved = earlier[earlier.length - 1] || history.find((row) => (row.payload as any).provenance !== 'LEGACY')
  if (saved) return (saved.payload as any).status as string
  const kpi = await tx.chapterMonthlyKpi.findUnique({ where: { chapter_id_month_start: { chapter_id: chapterId, month_start: new Date(`${month}-01T00:00:00Z`) } } })
  return kpi && kpi.updated_at < at ? kpi.status : null
}

/** State immediately before a half-open period's end, including later deactivated users. */
export async function competitionCohortAt(tx: Tx, at: Date) {
  const [states, chapters, allChapters, positions, memberships] = await Promise.all([
    tx.accountStateInterval.findMany({ where: { ...leftBoundary(at), role: 'MEMBER', status: 'ACTIVE' } }),
    tx.chapterAffiliationInterval.findMany({ where: leftBoundary(at) }),
    tx.chapter.findMany({ select: { id: true, name: true } }),
    tx.positionAssignment.findMany({
      where: { ...leftBoundary(at), created_at: { lt: at } },
      include: {
        position: { select: { code: true, name: true } },
        unit: { select: { id: true, name: true, type: true } },
      },
    }),
    tx.organizationMembership.findMany({
      where: { ...leftBoundary(at), created_at: { lt: at }, unit: { type: { in: ['DNA', 'DNA_GROUP', 'DEPARTMENT'] } } },
      include: { unit: { select: { id: true, name: true, type: true, code: true } } },
    }),
  ])
  const chapterNameMap = new Map(allChapters.map((c) => [c.id, c.name]))

  return states.flatMap((state) => {
    const userMemberships = memberships.filter((row) => row.user_id === state.user_id)
    const dna = userMemberships.filter((row) => row.unit.type === 'DNA' || row.unit.type === 'DNA_GROUP')
    const userPositions = positions.filter((row) => row.user_id === state.user_id)
    const positionCodes = userPositions.map((row) => row.position.code)
    if (dna.some((row) => row.unit.code === 'TT')) positionCodes.push('TT')
    const group = competitionGroup(state.role, positionCodes, dna.length > 0)
    const chapter = chapters.find((row) => row.user_id === state.user_id)
    const dnaUnit = dna.find((row) => row.unit.type === 'DNA_GROUP') || dna[0]
    if (!group || (!chapter && !dna.length)) return []

    // Historical Department (Ban) at time `at`
    const deptMembership = userMemberships.find((row) => row.unit.type === 'DEPARTMENT')
    const deptPosition = userPositions.find((row) => row.unit.type === 'DEPARTMENT')
    const departmentName = deptMembership?.unit.name || deptPosition?.unit.name || (dna.length ? 'Khối DNA' : null)

    // Historical Position name at time `at`
    const ltPos = userPositions.find((row) => ['PRESIDENT', 'CHAPTER_PRESIDENT', 'DEPARTMENT_LEAD', 'DEPARTMENT_LEADER'].includes(row.position.code))
    const primaryPos = userPositions.find((row) => (row as any).is_primary) || userPositions[0]
    const positionName = group === 'LT'
      ? (ltPos?.position.name || 'Ban Lãnh Đạo (LT)')
      : group === 'DNA'
      ? (primaryPos?.position.name || 'Thành viên DNA')
      : (primaryPos?.position.name || 'Thành viên')

    const chapterId = dna.length ? null : chapter?.chapter_id || null
    const chapterName = chapterId ? chapterNameMap.get(chapterId) || null : null

    return [{
      userId: state.user_id,
      group,
      chapterId,
      chapterName,
      departmentName,
      positionName,
      dnaUnitId: dnaUnit?.unit.id || null,
      dnaUnitName: dnaUnit?.unit.name || null,
    }]
  })
}

async function coreLessonIdsAt(tx: Tx, at: Date) {
  const [courses, events, versions] = await Promise.all([
    tx.course.findMany({ where: { program: { code: { in: ['CORE_MEMBER', 'CORE_LEADER', 'CORE_DNA'] } } }, select: { id: true } }),
    tx.coursePublicationEvent.findMany({ where: { effective_at: { lt: at } }, orderBy: { effective_at: 'desc' } }),
    tx.courseRequirementVersion.findMany({ where: { published_at: { lt: at } }, orderBy: { version: 'desc' } }),
  ])
  const ids = new Set<string>()
  const publishedCourseIds: string[] = []
  for (const course of courses) {
    if (events.find((event) => event.course_id === course.id)?.status === 'PUBLISHED') {
      publishedCourseIds.push(course.id)
    }
  }
  const fallbackCourseIds: string[] = []
  for (const courseId of publishedCourseIds) {
    const version = versions.find((row) => row.course_id === courseId)
    if (!version) {
      fallbackCourseIds.push(courseId)
    } else {
      for (const id of version.lesson_ids) ids.add(id)
    }
  }
  if (fallbackCourseIds.length) {
    const fallbackLessons = await tx.lesson.findMany({
      where: { session: { course_id: { in: fallbackCourseIds } } },
      select: { id: true },
    })
    for (const l of fallbackLessons) ids.add(l.id)
  }
  return ids
}

export function rankIndividuals<T extends { stars: number; elapsedMs: number; userId: string }>(items: T[]) {
  const sorted = [...items].sort((a, b) => {
    if (b.stars !== a.stars) return b.stars - a.stars
    const aSec = Math.floor(a.elapsedMs / 1000)
    const bSec = Math.floor(b.elapsedMs / 1000)
    if (aSec !== bSec) return aSec - bSec
    return a.userId.localeCompare(b.userId)
  })

  let currentRank = 1
  return sorted.map((row, index) => {
    if (index > 0) {
      const prev = sorted[index - 1]
      const prevSec = Math.floor(prev.elapsedMs / 1000)
      const currSec = Math.floor(row.elapsedMs / 1000)
      if (row.stars === prev.stars && currSec === prevSec) {
        return { ...row, rank: currentRank }
      }
    }
    currentRank = index + 1
    return { ...row, rank: currentRank }
  })
}

export async function individualPeriodRows(
  tx: Tx,
  startsAt: Date,
  endsAt: Date,
  group: string,
  chapterId?: string,
  dnaUnitIds?: string[],
  seasonId?: string
) {
  const allowedDna = dnaUnitIds && dnaUnitIds.length ? new Set(dnaUnitIds) : null
  const cohort = (await competitionCohortAt(tx, endsAt)).filter((row) =>
    row.group === group
    && (!chapterId || row.chapterId === chapterId)
    && (!allowedDna || (row.dnaUnitId ? allowedDna.has(row.dnaUnitId) : false)),
  )

  let termByChapter = new Map<string, { starts_at: Date; ends_at: Date | null }>()
  if ((group === 'MEMBER' || group === 'LT') && !chapterId) {
    const terms = await tx.chapterCompetitionTerm.findMany({
      where: seasonId
        ? { season_id: seasonId }
        : { starts_at: { lte: endsAt }, OR: [{ ends_at: null }, { ends_at: { gte: startsAt } }] },
    })
    for (const t of terms) {
      termByChapter.set(t.chapter_id, t)
    }
  }

  const userIds = cohort.map((row) => row.userId)
  const earliestStart = termByChapter.size
    ? new Date(Math.min(startsAt.getTime(), ...Array.from(termByChapter.values()).map((t) => t.starts_at.getTime())))
    : startsAt

  const ledger = userIds.length
    ? await tx.starLedger.findMany({
        where: {
          user_id: { in: userIds },
          provenance: 'NATIVE',
          awarded_at: { gte: earliestStart, lt: endsAt },
        },
        select: { user_id: true, amount: true, awarded_at: true },
      })
    : []

  const scored = cohort.map((user) => {
    const chTerm = user.chapterId ? termByChapter.get(user.chapterId) : null
    const userStart = chTerm ? chTerm.starts_at : startsAt
    const userEnd = chTerm?.ends_at ? new Date(Math.min(chTerm.ends_at.getTime(), endsAt.getTime())) : endsAt

    const userRows = ledger.filter(
      (row) => row.user_id === user.userId && row.awarded_at >= userStart && row.awarded_at < userEnd
    )
    const balance = firstReachedFinalBalance(userRows, userStart)
    return {
      ...user,
      stars: balance.total,
      starsAchievedAt: balance.achievedAt,
      elapsedMs: balance.elapsedMs,
      cycleStartsAt: userStart,
      cycleEndsAt: userEnd,
    }
  })
  return rankIndividuals(scored)
}

export async function historicalChapterMonthRows(tx: Tx, month: { id: string; key: string; starts_at: Date; ends_at: Date }, end: Date) {
  const [chapters, cohort, coreIds, cycles, transfers, dnaMemberships, starRows, kpis] = await Promise.all([
    tx.chapter.findMany({ select: { id: true, name: true } }),
    competitionCohortAt(tx, end),
    coreLessonIdsAt(tx, end),
    tx.learningCycle.findMany({ where: leftBoundary(end), select: { id: true, user_id: true } }),
    tx.chapterReorganization.findMany({
      where: { status: 'APPLIED', applied_at: { gt: month.starts_at, lt: end } },
      select: { chapter_id: true, applied_at: true },
      orderBy: { applied_at: 'asc' },
    }),
    tx.organizationMembership.findMany({
      where: {
        unit: { type: { in: ['DNA', 'DNA_GROUP'] } },
        starts_at: { lte: end },
        OR: [{ ends_at: null }, { ends_at: { gt: month.starts_at } }],
      },
      select: { user_id: true },
    }),
    tx.starLedger.findMany({
      where: { competition_month_id: month.id, awarded_at: { gte: month.starts_at, lt: end } },
      select: { chapter_at_award_id: true, user_id: true, amount: true, awarded_at: true },
    }),
    tx.chapterMonthlyKpi.findMany({
      where: { month_start: new Date(`${month.key}-01T00:00:00.000Z`) },
      select: { chapter_id: true, status: true, updated_at: true },
    }),
  ])
  const excludedDnaUserIds = new Set(dnaMemberships.map((row) => row.user_id))
  const cycleIds = cycles.map((cycle) => cycle.id)
  const progressRows = cycleIds.length
    ? await tx.cycleLessonProgress.findMany({
        where: { learning_cycle_id: { in: cycleIds }, completed_at: { lt: end } },
        select: { user_id: true, lesson_id: true, completed_at: true },
      })
    : []
  const progressByUser = new Map<string, Array<{ lesson_id: string; completed_at: Date | null }>>()
  for (const row of progressRows) {
    const list = progressByUser.get(row.user_id) || []
    list.push(row)
    progressByUser.set(row.user_id, list)
  }
  const cohortCache = new Map<number, typeof cohort>()
  const cohortAt = async (at: Date) => {
    if (at.getTime() === end.getTime()) return cohort
    const key = at.getTime()
    if (!cohortCache.has(key)) cohortCache.set(key, await competitionCohortAt(tx, at))
    return cohortCache.get(key)!
  }
  const kpiByChapter = new Map(kpis.map((row) => [row.chapter_id, row]))
  const items = []
  for (const chapter of chapters) {
    const chapterTransfers = transfers.filter((row) => row.chapter_id === chapter.id)
    const endpoints = Array.from(new Set([...chapterTransfers.map((row) => row.applied_at!.getTime()), end.getTime()])).sort((a, b) => a - b)
    const stages: ChapterStage[] = []
    let startsAt = month.starts_at
    for (const timestamp of endpoints) {
      const at = new Date(timestamp)
      if (at <= startsAt) continue
      const stageCohort = await cohortAt(at)
      const members = stageCohort.filter((row) => row.chapterId === chapter.id && row.group !== 'DNA' && !excludedDnaUserIds.has(row.userId))
      const qualifiedCount = coreIds.size
        ? members.filter((member) => {
            const completed = new Set((progressByUser.get(member.userId) || [])
              .filter((row) => row.completed_at && row.completed_at < at && coreIds.has(row.lesson_id))
              .map((row) => row.lesson_id))
            return completed.size / coreIds.size >= 0.7
          }).length
        : 0
      const stageStarRows = starRows.filter((row) => (
        row.chapter_at_award_id === chapter.id
        && !excludedDnaUserIds.has(row.user_id)
        && row.awarded_at >= startsAt
        && row.awarded_at < at
      ))
      const stageStars = stageStarRows.reduce((sum, row) => sum + row.amount, 0)
      const stageLastStar = stageStarRows.length ? new Date(Math.max(...stageStarRows.map((r) => r.awarded_at.getTime()))) : null
      stages.push({
        startsAt,
        endsAt: at,
        memberCount: members.length,
        qualifiedCount,
        stars: stageStars,
        lastStarAwardedAt: stageLastStar,
      })
      startsAt = at
    }
    const kpiRow = kpiByChapter.get(chapter.id)
    const kpi = kpiRow && kpiRow.updated_at < end ? kpiRow.status : null

    const chapterStarRows = starRows.filter((row) => (
      row.chapter_at_award_id === chapter.id
      && !excludedDnaUserIds.has(row.user_id)
      && row.awarded_at >= month.starts_at
      && row.awarded_at < end
    ))
    const lastStarAwardedAt = chapterStarRows.length ? new Date(Math.max(...chapterStarRows.map((r) => r.awarded_at.getTime()))) : null
    const scoreResult = chapterCompetitionScore(stages, kpi, { coreLessonCount: coreIds.size })

    items.push({
      chapterId: chapter.id,
      chapterName: chapter.name,
      stages: scoreResult.stageResults,
      kpiStatus: kpi,
      lastStarAwardedAt,
      ...scoreResult,
    })
  }
  return rankChapters(items, { isTerm: false })
}

export function rankChapters<T extends {
  chapterId: string
  eligible: boolean
  score: number | null
  lastStarAwardedAt?: Date | string | null
  qualifiedMonthCount?: number
}>(items: T[], options?: { isTerm?: boolean }) {
  const isTerm = options?.isTerm === true

  const sorted = [...items].sort((a, b) => {
    // 1. Eligible chapters first
    if (Number(b.eligible) !== Number(a.eligible)) return Number(b.eligible) - Number(a.eligible)
    if (!a.eligible && !b.eligible) return a.chapterId.localeCompare(b.chapterId)

    // 2. High-precision unrounded score comparison
    const scoreA = a.score ?? -Infinity
    const scoreB = b.score ?? -Infinity
    if (Math.abs(scoreB - scoreA) > 1e-12) {
      return scoreB - scoreA
    }

    // 3. Tie-breaking when scores are equal:
    if (isTerm) {
      // Term: Chapter with MORE qualified months on the leaderboard ranks higher
      const monthsA = a.qualifiedMonthCount ?? 0
      const monthsB = b.qualifiedMonthCount ?? 0
      if (monthsB !== monthsA) return monthsB - monthsA
    } else {
      // Month: Chapter with earlier last valid star received timestamp ranks higher (to the second)
      if (a.lastStarAwardedAt && b.lastStarAwardedAt) {
        const aSec = Math.floor(new Date(a.lastStarAwardedAt).getTime() / 1000)
        const bSec = Math.floor(new Date(b.lastStarAwardedAt).getTime() / 1000)
        if (aSec !== bSec) return aSec - bSec
      } else if (a.lastStarAwardedAt && !b.lastStarAwardedAt) {
        return -1
      } else if (!a.lastStarAwardedAt && b.lastStarAwardedAt) {
        return 1
      }
    }

    // 4. Stable sort by ID for array determinism (identical rank will be assigned below)
    return a.chapterId.localeCompare(b.chapterId)
  })

  let currentRank = 1
  return sorted.map((row, index) => {
    if (!row.eligible) {
      return { ...row, rank: null }
    }
    if (index > 0) {
      const prev = sorted[index - 1]
      if (prev.eligible) {
        const scoresEqual = Math.abs((row.score ?? -Infinity) - (prev.score ?? -Infinity)) <= 1e-12
        if (scoresEqual) {
          if (isTerm) {
            const monthsEqual = (row.qualifiedMonthCount ?? 0) === (prev.qualifiedMonthCount ?? 0)
            if (monthsEqual) {
              return { ...row, rank: currentRank }
            }
          } else {
            const currSec = row.lastStarAwardedAt ? Math.floor(new Date(row.lastStarAwardedAt).getTime() / 1000) : null
            const prevSec = prev.lastStarAwardedAt ? Math.floor(new Date(prev.lastStarAwardedAt).getTime() / 1000) : null
            if (currSec === prevSec) {
              return { ...row, rank: currentRank }
            }
          }
        }
      }
    }
    currentRank = index + 1
    return { ...row, rank: currentRank }
  })
}

export async function chapterSeasonRows(tx: Tx, seasonId: string, at: Date) {
  const [chapters, terms] = await Promise.all([
    tx.chapter.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true } }),
    tx.chapterCompetitionTerm.findMany({ where: { season_id: seasonId } }),
  ])
  let waitingKpi = false
  let missingTerm = false
  const items = []
  for (const chapter of chapters) {
    const term = terms.find((row) => row.chapter_id === chapter.id)
    if (!term) {
      missingTerm = true
      items.push({
        chapterId: chapter.id,
        chapterName: chapter.name,
        score: 0,
        eligible: false,
        exclusionReasons: ['TERM_NOT_STARTED'],
        months: [],
        qualifiedMonthCount: 0,
      })
      continue
    }

    const termEnd = term.ends_at ? new Date(Math.min(term.ends_at.getTime(), at.getTime())) : at
    const months = await tx.competitionMonth.findMany({
      where: { starts_at: { lt: termEnd }, ends_at: { gt: term.starts_at } },
      orderBy: { starts_at: 'asc' },
    })

    const results = []
    let totalTermScore = 0
    let qualifiedMonthCount = 0

    for (const month of months) {
      const saved = await tx.learningSnapshot.findUnique({ where: { key: `ranking:CHAPTER:${month.id}` } })
      let monthItem: any = null
      let isWaitingKpi = false

      if (saved) {
        const payload = saved?.payload as any
        if (payload?.state === 'WAITING_KPI') isWaitingKpi = true
        monthItem = payload?.items?.find((row: any) => row.chapterId === chapter.id)
      } else if (month.ends_at <= at) {
        isWaitingKpi = true
      } else {
        const liveRows = await historicalChapterMonthRows(tx, month, at)
        monthItem = liveRows.find((row) => row.chapterId === chapter.id)
      }

      if (isWaitingKpi) waitingKpi = true

      if (!monthItem) {
        results.push({
          monthId: month.id,
          month: month.key,
          score: 0,
          allocatedScore: 0,
          eligible: false,
          exclusionReasons: ['NO_RECORD'],
          hasContributedStage: false,
        })
        continue
      }

      const stages = (monthItem.stages && monthItem.stages.length ? monthItem.stages : [{
        startsAt: month.starts_at,
        endsAt: month.ends_at,
        memberCount: monthItem.averageMemberCount,
        qualifiedCount: 0,
        stars: monthItem.totalStars || 0,
        stageScore: monthItem.score,
      }]).map((s: any) => ({
        ...s,
        startsAt: new Date(s.startsAt),
        endsAt: new Date(s.endsAt),
      }))

      let allocatedScore = 0
      let hasContributedStage = false

      for (const stage of stages) {
        const midpoint = new Date((stage.startsAt.getTime() + stage.endsAt.getTime()) / 2)
        if (midpoint >= term.starts_at && midpoint < termEnd) {
          hasContributedStage = true
          if (monthItem.eligible) {
            const sScore = stage.stageScore !== undefined && stage.stageScore !== null
              ? stage.stageScore
              : (stage.memberCount > 0 ? stage.stars / stage.memberCount : 0)
            allocatedScore += sScore
          }
        }
      }

      if (!stages.length && month.starts_at >= term.starts_at && month.ends_at <= termEnd) {
        hasContributedStage = true
        if (monthItem.eligible && monthItem.score) allocatedScore = monthItem.score
      }

      if (monthItem.eligible && hasContributedStage) {
        totalTermScore += allocatedScore
        qualifiedMonthCount++
      }

      results.push({
        monthId: month.id,
        month: month.key,
        score: monthItem.score,
        allocatedScore,
        eligible: monthItem.eligible && hasContributedStage,
        exclusionReasons: monthItem.exclusionReasons || [],
        hasContributedStage,
      })
    }

    const eligible = results.some((row) => row.eligible && row.hasContributedStage)
    items.push({
      chapterId: chapter.id,
      chapterName: chapter.name,
      termId: term.id,
      termStartsAt: term.starts_at,
      termEndsAt: term.ends_at,
      score: totalTermScore,
      eligible,
      exclusionReasons: eligible ? [] : ['NO_ELIGIBLE_CLOSED_MONTH'],
      months: results,
      qualifiedMonthCount,
    })
  }

  return {
    items: rankChapters(items, { isTerm: true }),
    state: waitingKpi
      ? 'WAITING_KPI'
      : !missingTerm && terms.length && terms.every((term) => term.ends_at && term.ends_at <= at)
      ? 'FINALIZED'
      : 'OPEN',
  }
}

async function saveSnapshot(tx: Tx, key: string, payload: unknown, now: Date) {
  await tx.learningSnapshot.create({ data: { key, kind: 'COMPETITION_RANKING', captured_at: now, payload: JSON.parse(JSON.stringify(payload)) } })
}

/** Users and then month are locked in the same order as learning writers. */
export async function closeCompetitionMonths() {
  const months = await prisma.competitionMonth.findMany({ where: { state: 'OPEN', ends_at: { lte: new Date() } }, orderBy: { starts_at: 'asc' } })
  let closed = 0
  for (const candidate of months) await prisma.$transaction(async (tx) => {
    const users = await tx.user.findMany({ select: { id: true }, orderBy: { id: 'asc' } })
    for (const user of users) await lockLearningUser(tx, user.id)
    await tx.$queryRaw`SELECT id FROM competition_months WHERE id=${candidate.id}::uuid FOR UPDATE`
    const month = await tx.competitionMonth.findUniqueOrThrow({ where: { id: candidate.id } })
    if (month.state !== 'OPEN') return
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    if (month.ends_at > clock.now) return
    for (const group of ['MEMBER', 'LT', 'DNA']) await saveSnapshot(tx, `ranking:${group}:${month.id}`, {
      group, periodType: 'MONTH', period: month, state: 'FINALIZED', items: await individualPeriodRows(tx, month.starts_at, month.ends_at, group),
    }, clock.now)
    const chapterItems = await historicalChapterMonthRows(tx, month, month.ends_at)
    await saveSnapshot(tx, `ranking:CHAPTER:${month.id}`, { group: 'CHAPTER', periodType: 'MONTH', period: month, state: chapterItems.some((row) => !row.kpiStatus) ? 'WAITING_KPI' : 'FINALIZED', items: chapterItems }, clock.now)
    await tx.competitionMonth.update({ where: { id: month.id }, data: { state: 'CLOSED', closed_at: clock.now } })
    closed++
  }, { timeout: 60_000 })
  return closed
}

/** Only KPI fields can change while pending; the saved stage facts are never recomputed. */
export async function completePendingCompetitionKpis() {
  const snapshots = await prisma.learningSnapshot.findMany({ where: { kind: 'COMPETITION_RANKING' } })
  let completed = 0
  for (const snapshot of snapshots) {
    if ((snapshot.payload as any)?.state !== 'WAITING_KPI' || (snapshot.payload as any)?.periodType !== 'MONTH') continue
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM learning_snapshots WHERE id=${snapshot.id}::uuid FOR UPDATE`
      const saved = await tx.learningSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } })
      const payload = saved.payload as any
      if (payload.state !== 'WAITING_KPI') return
      for (const item of payload.items) {
        const kpi = item.kpiStatus || await competitionKpiAt(tx, item.chapterId, payload.period.key, new Date(payload.period.ends_at))
        if (kpi && !item.kpiStatus) {
          item.kpiStatus = kpi
          const stages = item.stages.map((stage: any) => ({ ...stage, startsAt: new Date(stage.startsAt), endsAt: new Date(stage.endsAt) }))
          Object.assign(item, chapterCompetitionScore(stages, kpi))
        }
      }
      payload.items = rankChapters(payload.items)
      if (payload.items.every((item: any) => item.kpiStatus)) { payload.state = 'FINALIZED'; completed++ }
      await tx.learningSnapshot.update({ where: { id: saved.id }, data: { payload } })
    })
  }
  return completed
}

export async function closeCompetitionTerms() {
  const now = new Date()
  const [terms, seasons] = await Promise.all([
    prisma.chapterCompetitionTerm.findMany({ where: { ends_at: { lte: now } } }),
    prisma.transferSeason.findMany({ where: { ends_at: { lte: now } } }),
  ])
  let captured = 0
  const policy = await prisma.learningPolicy.findUnique({ where: { id: 'default' } })
  const dnaSeasons = await prisma.transferSeason.findMany({ where: { reward_boundary_at: { not: null } } })
  for (const season of dnaSeasons) {
    const end = dnaSeasonEnd(season.reward_boundary_at!)
    if (end > now || !policy?.cutover_at || end <= policy.cutover_at) continue
    await prisma.$transaction(async (tx) => {
      const users = await tx.user.findMany({ select: { id: true }, orderBy: { id: 'asc' } })
      for (const user of users) await lockLearningUser(tx, user.id)
      const key = `ranking:DNA:${season.id}`
      if (await tx.learningSnapshot.findUnique({ where: { key } })) return
      const period = { ...season, starts_at: new Date(Math.max(season.reward_boundary_at!.getTime(), policy.cutover_at!.getTime())), ends_at: end }
      await saveSnapshot(tx, key, { group: 'DNA', periodType: 'TERM', period, state: 'FINALIZED', items: await individualPeriodRows(tx, period.starts_at, end, 'DNA') }, now)
      captured++
    }, { timeout: 60_000 })
  }
  for (const period of [...terms, ...seasons]) await prisma.$transaction(async (tx) => {
    const users = await tx.user.findMany({ select: { id: true }, orderBy: { id: 'asc' } })
    for (const user of users) await lockLearningUser(tx, user.id)
    const chapterId = 'chapter_id' in period ? period.chapter_id : undefined
    for (const group of chapterId ? ['MEMBER', 'LT'] : []) {
      const key = `ranking:${group}:${period.id}`
      if (await tx.learningSnapshot.findUnique({ where: { key } })) continue
      await saveSnapshot(tx, key, { group, periodType: 'TERM', period, state: 'FINALIZED', items: await individualPeriodRows(tx, period.starts_at, period.ends_at!, group, chapterId) }, now)
      captured++
    }
    if (!chapterId) {
      const key = `ranking:CHAPTER:${period.id}`
      const existing = await tx.learningSnapshot.findUnique({ where: { key } })
      if ((existing?.payload as any)?.state === 'FINALIZED') return
      const result = await chapterSeasonRows(tx, period.id, now)
      const payload = { ...result, group: 'CHAPTER', periodType: 'TERM', period }
      if (existing) await tx.learningSnapshot.update({ where: { id: existing.id }, data: { payload: JSON.parse(JSON.stringify(payload)) } })
      else await saveSnapshot(tx, key, payload, now)
      return
    }
    const key = `ranking:CHAPTER:${period.id}`
    const existing = await tx.learningSnapshot.findUnique({ where: { key } })
    if ((existing?.payload as any)?.state === 'FINALIZED') return
    // Chapter term months with stage-split logic
    const months = await tx.competitionMonth.findMany({
      where: { starts_at: { lt: period.ends_at! }, ends_at: { gt: period.starts_at } },
      orderBy: { starts_at: 'asc' },
    })
    const results = []
    let waiting = false
    let totalScore = 0
    let qualifiedMonthCount = 0

    for (const month of months) {
      const saved = await tx.learningSnapshot.findUnique({ where: { key: `ranking:CHAPTER:${month.id}` } })
      const payload = saved?.payload as any
      if (!payload || payload.state !== 'FINALIZED') waiting = true
      const item = payload?.items.find((row: any) => row.chapterId === chapterId)
      if (item) {
        const stages = (item.stages && item.stages.length ? item.stages : [{
          startsAt: month.starts_at,
          endsAt: month.ends_at,
          memberCount: item.averageMemberCount,
          qualifiedCount: 0,
          stars: item.totalStars || 0,
          stageScore: item.score,
        }]).map((s: any) => ({
          ...s,
          startsAt: new Date(s.startsAt),
          endsAt: new Date(s.endsAt),
        }))

        let allocatedScore = 0
        let hasContributedStage = false

        for (const stage of stages) {
          const midpoint = new Date((stage.startsAt.getTime() + stage.endsAt.getTime()) / 2)
          if (midpoint >= period.starts_at && midpoint < period.ends_at!) {
            hasContributedStage = true
            if (item.eligible) {
              const sScore = stage.stageScore !== undefined && stage.stageScore !== null
                ? stage.stageScore
                : (stage.memberCount > 0 ? stage.stars / stage.memberCount : 0)
              allocatedScore += sScore
            }
          }
        }

        if (!stages.length && month.starts_at >= period.starts_at && month.ends_at <= period.ends_at!) {
          hasContributedStage = true
          if (item.eligible && item.score) allocatedScore = item.score
        }

        if (item.eligible && hasContributedStage) {
          totalScore += allocatedScore
          qualifiedMonthCount++
        }

        results.push({
          monthId: month.id,
          month: month.key,
          score: item.score,
          allocatedScore,
          eligible: item.eligible && hasContributedStage,
          exclusionReasons: item.exclusionReasons || [],
          hasContributedStage,
        })
      }
    }
    const chapter = await tx.chapter.findUnique({ where: { id: chapterId }, select: { name: true } })
    const eligible = results.some((row) => row.eligible && row.hasContributedStage)
    const payload = {
      group: 'CHAPTER',
      periodType: 'TERM',
      period,
      state: waiting ? 'WAITING_KPI' : 'FINALIZED',
      items: [{
        chapterId,
        chapterName: chapter?.name || 'Chapter',
        score: totalScore,
        qualifiedMonthCount,
        months: results,
        rank: 1,
        eligible,
      }],
    }
    if (existing) await tx.learningSnapshot.update({ where: { id: existing.id }, data: { payload: JSON.parse(JSON.stringify(payload)) } })
    else await saveSnapshot(tx, key, payload, now)
  }, { timeout: 60_000 })
  return captured
}
