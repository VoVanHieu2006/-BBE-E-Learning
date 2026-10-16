import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { calculateChapterLeaderboardMetrics, calculateMandatoryCompletionPercentByUser, CHAPTER_LEADERBOARD_WEIGHTS, parseChapterKpiMonthStart, scoreChapterLeaderboard } from '@/lib/chapter-leaderboard-rules'
import { getCachedChapterLeaderboard, setCachedChapterLeaderboard } from '@/lib/chapter-leaderboard-cache'
import { getActiveMetricChapterIds } from '@/lib/active-chapters'

export const dynamic = 'force-dynamic'

async function calculateMandatoryCompletion(memberIds: string[], asOf: Date): Promise<Map<string, number>> {
  if (!memberIds.length) return new Map()
  const assignments = await prisma.userLearningAssignment.findMany({
    where: { user_id: { in: memberIds }, mandatory: true, can_view: true, assigned_at: { lte: asOf }, course: { status: 'PUBLISHED' } },
    select: { user_id: true, can_assess: true, course: { select: { final_assessment: { select: { id: true } }, sessions: { select: { lessons: { select: { id: true, assessment: { select: { id: true } } } } } } } } },
  })
  const requirements = assignments.map((assignment) => {
    const lessons = assignment.course.sessions.flatMap((session) => session.lessons)
    return { userId: assignment.user_id, lessonIds: lessons.map((lesson) => lesson.id), lessonAssessmentIds: lessons.flatMap((lesson) => lesson.assessment ? [lesson.assessment.id] : []), finalAssessmentId: assignment.course.final_assessment?.id || null, canAssess: assignment.can_assess }
  })
  const lessonIds = Array.from(new Set(requirements.flatMap((item) => item.lessonIds)))
  const assessmentIds = Array.from(new Set(requirements.flatMap((item) => [...item.lessonAssessmentIds, ...(item.finalAssessmentId ? [item.finalAssessmentId] : [])])))
  const [completedRows, passedRows] = await Promise.all([
    lessonIds.length ? prisma.lessonProgress.findMany({ where: { user_id: { in: memberIds }, lesson_id: { in: lessonIds }, completed: true, completed_at: { lte: asOf } }, select: { user_id: true, lesson_id: true } }) : Promise.resolve([]),
    assessmentIds.length ? prisma.attempt.findMany({ where: { user_id: { in: memberIds }, assessment_id: { in: assessmentIds }, passed: true, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] }, submitted_at: { lte: asOf } }, select: { user_id: true, assessment_id: true } }) : Promise.resolve([]),
  ])
  const completedByUser = new Map<string, Set<string>>()
  for (const row of completedRows) { const set = completedByUser.get(row.user_id) || new Set<string>(); set.add(row.lesson_id); completedByUser.set(row.user_id, set) }
  const passedByUser = new Map<string, Set<string>>()
  for (const row of passedRows) { const set = passedByUser.get(row.user_id) || new Set<string>(); set.add(row.assessment_id); passedByUser.set(row.user_id, set) }
  return calculateMandatoryCompletionPercentByUser(memberIds, requirements, completedByUser, passedByUser)
}

export async function GET(request: NextRequest) {
  await authenticate(request).catch(() => null)
  const requestedMonth = parseChapterKpiMonthStart(new URL(request.url).searchParams.get('month'))
  const latestKpi = requestedMonth ? null : await prisma.chapterMonthlyKpi.findFirst({ orderBy: { month_start: 'desc' }, select: { month_start: true } })
  const now = new Date()
  const monthStart = requestedMonth || latestKpi?.month_start || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1))
  const asOf = new Date(nextMonth.getTime() - 1)
  const cacheKey = monthStart.toISOString().slice(0, 7)
  const cachedData = getCachedChapterLeaderboard(cacheKey)
  if (cachedData) return NextResponse.json(cachedData, { headers: { 'Cache-Control': 'no-store' } })
  const activeChapterIds = await getActiveMetricChapterIds(now)

  const [chapters, kpis, availableMonths] = await Promise.all([
    prisma.chapter.findMany({ where: { id: { in: activeChapterIds } }, select: { id: true, name: true, description: true, organization_unit_id: true } }),
    prisma.chapterMonthlyKpi.findMany({ where: { month_start: { gte: monthStart, lt: nextMonth } }, select: { chapter_id: true, status: true, updated_at: true } }),
    prisma.chapterMonthlyKpi.findMany({ distinct: ['month_start'], orderBy: { month_start: 'desc' }, select: { month_start: true } }),
  ])
  const units = await prisma.organizationUnit.findMany({ select: { id: true, parent_id: true } })
  const childrenByParent = new Map<string, string[]>()
  for (const unit of units) {
    if (!unit.parent_id) continue
    const children = childrenByParent.get(unit.parent_id) || []
    children.push(unit.id)
    childrenByParent.set(unit.parent_id, children)
  }
  const chaptersByUnit = new Map<string, Set<string>>()
  for (const chapter of chapters) {
    if (!chapter.organization_unit_id) continue
    const seen = new Set<string>()
    const frontier = [chapter.organization_unit_id]
    while (frontier.length) {
      const unitId = frontier.pop()!
      if (seen.has(unitId)) continue
      seen.add(unitId)
      const owners = chaptersByUnit.get(unitId) || new Set<string>()
      owners.add(chapter.id)
      chaptersByUnit.set(unitId, owners)
      frontier.push(...(childrenByParent.get(unitId) || []))
    }
  }
  const chapterIds = chapters.map((chapter) => chapter.id)
  const membershipFilter = { unit_id: { in: Array.from(chaptersByUnit.keys()) }, status: 'ACTIVE' as const, starts_at: { lte: asOf }, OR: [{ ends_at: null }, { ends_at: { gt: monthStart } }] }
  const eligibleUsers = chapterIds.length ? await prisma.user.findMany({
    where: {
      status: 'ACTIVE', role: 'MEMBER',
      OR: [
        { chapter_members: { some: { chapter_id: { in: chapterIds } } } },
        { organization_memberships: { some: membershipFilter } },
      ],
      position_assignments: { none: { position: { code: 'DNA_LEAD' }, starts_at: { lte: asOf }, OR: [{ ends_at: null }, { ends_at: { gt: monthStart } }] } },
    },
    select: {
      id: true,
      chapter_members: { where: { chapter_id: { in: chapterIds } }, select: { chapter_id: true } },
      organization_memberships: { where: membershipFilter, select: { unit_id: true } },
    },
  }) : []
  const memberIdsByChapter = new Map(chapterIds.map((id) => [id, new Set<string>()]))
  for (const user of eligibleUsers) {
    for (const membership of user.chapter_members) memberIdsByChapter.get(membership.chapter_id)?.add(user.id)
    for (const membership of user.organization_memberships) {
      for (const chapterId of Array.from(chaptersByUnit.get(membership.unit_id) || [])) memberIdsByChapter.get(chapterId)?.add(user.id)
    }
  }
  const chapterMembers = chapters.map((chapter) => ({ chapter, memberIds: Array.from(memberIdsByChapter.get(chapter.id) || []) }))
  const allMemberIds = Array.from(new Set(chapterMembers.flatMap((item) => item.memberIds)))
  const [completionByUser, starRows] = await Promise.all([
    calculateMandatoryCompletion(allMemberIds, asOf),
    prisma.starLedger.findMany({ where: { user_id: { in: allMemberIds }, awarded_at: { lt: nextMonth } }, select: { user_id: true, amount: true, awarded_at: true } }),
  ])
  const starsByUser = new Map<string, number>()
  const achievedAtByUser = new Map<string, Date>()
  for (const row of starRows) {
    starsByUser.set(row.user_id, (starsByUser.get(row.user_id) || 0) + row.amount)
    if (row.amount > 0 && (!achievedAtByUser.has(row.user_id) || row.awarded_at > achievedAtByUser.get(row.user_id)!)) achievedAtByUser.set(row.user_id, row.awarded_at)
  }
  const kpiByChapter = new Map(kpis.map((kpi) => [kpi.chapter_id, kpi]))
  const candidates = chapterMembers.map(({ chapter, memberIds }) => {
    const completions = memberIds.map((id) => completionByUser.get(id) || 0)
    const averageStars = memberIds.length ? memberIds.reduce((sum, id) => sum + (starsByUser.get(id) || 0), 0) / memberIds.length : 0
    const kpi = kpiByChapter.get(chapter.id)
    const metrics = calculateChapterLeaderboardMetrics(completions, averageStars, kpi?.status || 'YELLOW')
    const starAchievedAt = memberIds.reduce<Date | null>((latest, id) => { const date = achievedAtByUser.get(id); return date && (!latest || date > latest) ? date : latest }, null)
    return { chapter, ...metrics, eligible: Boolean(kpi) && metrics.eligible, kpi, starAchievedAt }
  })
  const items = candidates.filter((item) => item.eligible).map((item) => {
    const { starScore, kpiBonus, score } = scoreChapterLeaderboard(item)
    return { chapterId: item.chapter.id, id: item.chapter.id, name: item.chapter.name, description: item.chapter.description, memberCount: item.memberCount, completion: { averagePercent: Math.round(item.averageCompletion * 10) / 10, atLeast70Percent: Math.round(item.at70Rate * 1000) / 10 }, stars: { averagePerMember: Math.round(item.averageStars * 10) / 10, score: Math.round(starScore * 10) / 10, achievedAt: item.starAchievedAt?.toISOString() || null }, kpi: { status: item.kpi!.status, bonus: kpiBonus }, size: { score: Math.round(item.sizeScore * 10) / 10, cappedAt: 51 }, score: Math.round(score * 10) / 10 }
  }).sort((a, b) => b.score - a.score || new Date(a.stars.achievedAt || 8640000000000000).getTime() - new Date(b.stars.achievedAt || 8640000000000000).getTime() || a.name.localeCompare(b.name, 'vi')).map((item, index) => ({ ...item, rank: index + 1 }))
  const excluded = candidates.filter((item) => !item.eligible).map((item) => ({ chapterId: item.chapter.id, id: item.chapter.id, name: item.chapter.name, description: item.chapter.description, memberCount: item.memberCount, atLeast70Percent: Math.round(item.at70Rate * 1000) / 10, kpiStatus: item.kpi?.status || null, reasons: [...(!item.kpi ? ['KPI_MISSING'] : []), ...(item.memberCount < 20 ? ['MINIMUM_MEMBERS'] : []), ...(item.at70Rate < .5 ? ['COMPLETION_THRESHOLD'] : []), ...(item.kpi?.status === 'RED' || item.kpi?.status === 'BLACK' ? [`KPI_${item.kpi.status}`] : [])] }))
  const data = { month: monthStart.toISOString(), availableMonths: availableMonths.map((item) => item.month_start.toISOString().slice(0, 7)), formulaVersion: 'chapter-v6', updatedAt: new Date().toISOString(), sourceUpdatedAt: kpis.reduce<string | null>((latest, kpi) => !latest || kpi.updated_at.toISOString() > latest ? kpi.updated_at.toISOString() : latest, null), weights: CHAPTER_LEADERBOARD_WEIGHTS, items, excluded }
  setCachedChapterLeaderboard(data, cacheKey)
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
