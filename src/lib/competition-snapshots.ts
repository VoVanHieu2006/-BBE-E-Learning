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
  const [states, chapters, positions, memberships] = await Promise.all([
    tx.accountStateInterval.findMany({ where: { ...leftBoundary(at), role: 'MEMBER', status: 'ACTIVE' } }),
    tx.chapterAffiliationInterval.findMany({ where: leftBoundary(at) }),
    tx.positionAssignment.findMany({ where: { ...leftBoundary(at), created_at: { lt: at } }, include: { position: { select: { code: true } } } }),
    tx.organizationMembership.findMany({ where: { ...leftBoundary(at), created_at: { lt: at }, unit: { type: { in: ['DNA', 'DNA_GROUP'] } } }, include: { unit: { select: { type: true, code: true } } } }),
  ])
  return states.flatMap((state) => {
    const dna = memberships.filter((row) => row.user_id === state.user_id)
    const positionCodes = positions.filter((row) => row.user_id === state.user_id).map((row) => row.position.code)
    if (dna.some((row) => row.unit.code === 'TT')) positionCodes.push('TT')
    const group = competitionGroup(state.role, positionCodes, dna.length > 0)
    const chapter = chapters.find((row) => row.user_id === state.user_id)
    return group && (chapter || dna.length) ? [{ userId: state.user_id, group, chapterId: dna.length ? null : chapter?.chapter_id || null }] : []
  })
}

async function coreLessonIdsAt(tx: Tx, at: Date) {
  const [courses, events, versions] = await Promise.all([
    tx.course.findMany({ where: { program: { code: { in: ['CORE_MEMBER', 'CORE_LEADER', 'CORE_DNA'] } } }, select: { id: true } }),
    tx.coursePublicationEvent.findMany({ where: { effective_at: { lt: at } }, orderBy: { effective_at: 'desc' } }),
    tx.courseRequirementVersion.findMany({ where: { published_at: { lt: at } }, orderBy: { version: 'desc' } }),
  ])
  const ids = new Set<string>()
  for (const course of courses) if (events.find((event) => event.course_id === course.id)?.status === 'PUBLISHED') {
    const version = versions.find((row) => row.course_id === course.id)
    if (!version) throw new Error(`MissingCourseRequirementBaseline:${course.id}`)
    for (const id of version.lesson_ids) ids.add(id)
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

export async function individualPeriodRows(tx: Tx, startsAt: Date, endsAt: Date, group: string, chapterId?: string) {
  const cohort = (await competitionCohortAt(tx, endsAt)).filter((row) => row.group === group && (!chapterId || row.chapterId === chapterId))
  const ledger = await tx.starLedger.findMany({ where: { user_id: { in: cohort.map((row) => row.userId) }, provenance: 'NATIVE', awarded_at: { gte: startsAt, lt: endsAt } }, select: { user_id: true, amount: true, awarded_at: true } })
  const scored = cohort.map((user) => {
    const balance = firstReachedFinalBalance(ledger.filter((row) => row.user_id === user.userId), startsAt)
    return { ...user, stars: balance.total, starsAchievedAt: balance.achievedAt, elapsedMs: balance.elapsedMs }
  })
  return rankIndividuals(scored)
}

export async function historicalChapterMonthRows(tx: Tx, month: { id: string; key: string; starts_at: Date; ends_at: Date }, end: Date) {
  const chapters = await tx.chapter.findMany({ select: { id: true, name: true } })
  const items = []
  for (const chapter of chapters) {
    const transferredDnaIntervals = await tx.chapterAffiliationInterval.findMany({
      where: {
        chapter_id: chapter.id,
        ends_at: { gte: month.starts_at, lt: month.ends_at },
      },
      select: { user_id: true, ends_at: true },
    })

    const candidateUserIds = transferredDnaIntervals.map((i) => i.user_id)
    const dnaMemberships = candidateUserIds.length ? await tx.organizationMembership.findMany({
      where: {
        user_id: { in: candidateUserIds },
        unit: { type: { in: ['DNA', 'DNA_GROUP'] } },
        starts_at: { lte: month.ends_at },
        OR: [{ ends_at: null }, { ends_at: { gt: month.starts_at } }],
      },
      select: { user_id: true },
    }) : []

    const excludedDnaUserIds = new Set(dnaMemberships.map((m) => m.user_id))

    const transfers = await tx.chapterReorganization.findMany({ where: { chapter_id: chapter.id, status: 'APPLIED', applied_at: { gt: month.starts_at, lt: end } }, orderBy: { applied_at: 'asc' } })
    const endpoints = [...transfers.map((row) => row.applied_at!), end]
    const stages: ChapterStage[] = []
    let startsAt = month.starts_at
    let latestCoreLessonCount = 0

    for (const at of endpoints) {
      const [cohort, coreIds, cycles] = await Promise.all([
        competitionCohortAt(tx, at), coreLessonIdsAt(tx, at), tx.learningCycle.findMany({ where: leftBoundary(at) }),
      ])
      latestCoreLessonCount = coreIds.size
      const members = cohort.filter((row) => row.chapterId === chapter.id && row.group !== 'DNA' && !excludedDnaUserIds.has(row.userId))
      const progress = await tx.cycleLessonProgress.findMany({ where: {
        user_id: { in: members.map((row) => row.userId) }, learning_cycle_id: { in: cycles.map((row) => row.id) }, completed_at: { lt: at },
      }, select: { user_id: true, lesson_id: true } })
      const qualifiedCount = coreIds.size ? members.filter((member) => new Set(progress.filter((row) => row.user_id === member.userId && coreIds.has(row.lesson_id)).map((row) => row.lesson_id)).size / coreIds.size >= 0.7).length : 0
      const ledger = await tx.starLedger.aggregate({
        where: {
          competition_month_id: month.id,
          chapter_at_award_id: chapter.id,
          awarded_at: { gte: startsAt, lt: at },
          ...(excludedDnaUserIds.size ? { user_id: { notIn: Array.from(excludedDnaUserIds) } } : {}),
        },
        _sum: { amount: true },
      })
      if (at > startsAt) stages.push({ startsAt, endsAt: at, memberCount: members.length, qualifiedCount, stars: ledger._sum.amount || 0 })
      startsAt = at
    }
    const kpi = await competitionKpiAt(tx, chapter.id, month.key, end)
    items.push({
      chapterId: chapter.id,
      chapterName: chapter.name,
      stages,
      kpiStatus: kpi,
      ...chapterCompetitionScore(stages, kpi, { coreLessonCount: latestCoreLessonCount }),
    })
  }
  return rankChapters(items)
}

export function rankChapters<T extends { chapterId: string; eligible: boolean; score: number | null }>(items: T[]) {
  const sorted = [...items].sort((a, b) => {
    if (Number(b.eligible) !== Number(a.eligible)) return Number(b.eligible) - Number(a.eligible)
    const scoreA = a.score ?? -Infinity
    const scoreB = b.score ?? -Infinity
    if (scoreB !== scoreA) return scoreB - scoreA
    return a.chapterId.localeCompare(b.chapterId)
  })

  let currentRank = 1
  return sorted.map((row, index) => {
    if (!row.eligible) {
      return { ...row, rank: null }
    }
    if (index > 0 && sorted[index - 1].eligible && sorted[index - 1].score === row.score) {
      return { ...row, rank: currentRank }
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
    if (!term) { missingTerm = true; items.push({ chapterId: chapter.id, chapterName: chapter.name, score: 0, eligible: false, exclusionReasons: ['TERM_NOT_STARTED'], months: [] }); continue }
    const months = await tx.competitionMonth.findMany({ where: { ends_at: { gt: term.starts_at, lte: term.ends_at || at } }, orderBy: { ends_at: 'asc' } })
    const results = []
    for (const month of months) {
      const saved = await tx.learningSnapshot.findUnique({ where: { key: `ranking:CHAPTER:${month.id}` } })
      const payload = saved?.payload as any
      if (!payload || payload.state !== 'FINALIZED') waitingKpi = true
      const item = payload?.items.find((row: any) => row.chapterId === chapter.id)
      if (item) results.push({ month: month.key, score: item.score, eligible: item.eligible })
    }
    items.push({ chapterId: chapter.id, chapterName: chapter.name, termId: term.id, score: results.filter((row) => row.eligible).reduce((sum, row) => sum + row.score, 0), eligible: results.some((row) => row.eligible), exclusionReasons: results.some((row) => row.eligible) ? [] : ['NO_ELIGIBLE_CLOSED_MONTH'], months: results })
  }
  return { items: rankChapters(items), state: waitingKpi ? 'WAITING_KPI' : !missingTerm && terms.length && terms.every((term) => term.ends_at && term.ends_at <= at) ? 'FINALIZED' : 'OPEN' }
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
    // Each entire month belongs to the Chapter term whose interval contains its end.
    const months = await tx.competitionMonth.findMany({ where: { ends_at: { gt: period.starts_at, lte: period.ends_at! } }, orderBy: { ends_at: 'asc' } })
    const results = []
    let waiting = false
    for (const month of months) {
      const saved = await tx.learningSnapshot.findUnique({ where: { key: `ranking:CHAPTER:${month.id}` } })
      const payload = saved?.payload as any
      if (!payload || payload.state !== 'FINALIZED') waiting = true
      const item = payload?.items.find((row: any) => row.chapterId === chapterId)
      if (item) results.push({ monthId: month.id, month: month.key, score: item.score, eligible: item.eligible, exclusionReasons: item.exclusionReasons })
    }
    const chapter = await tx.chapter.findUnique({ where: { id: chapterId }, select: { name: true } })
    const payload = { group: 'CHAPTER', periodType: 'TERM', period, state: waiting ? 'WAITING_KPI' : 'FINALIZED', items: [{ chapterId, chapterName: chapter?.name || 'Chapter', score: results.filter((row) => row.eligible).reduce((sum, row) => sum + row.score, 0), months: results, rank: 1 }] }
    if (existing) await tx.learningSnapshot.update({ where: { id: existing.id }, data: { payload: JSON.parse(JSON.stringify(payload)) } })
    else await saveSnapshot(tx, key, payload, now)
  }, { timeout: 60_000 })
  return captured
}
