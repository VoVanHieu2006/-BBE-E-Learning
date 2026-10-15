import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { getOrganizationUnitTreeIds } from '@/lib/learning-assignments'
import { prisma } from '@/lib/prisma'
import { calculateChapterLeaderboardMetrics, calculateMandatoryCompletionPercentByUser, CHAPTER_LEADERBOARD_WEIGHTS, scoreChapterLeaderboard } from '@/lib/chapter-leaderboard-rules'
import { getCachedChapterLeaderboard, setCachedChapterLeaderboard } from '@/lib/chapter-leaderboard-cache'

export const dynamic = 'force-dynamic'

/** Completion is measured against active mandatory video and permitted quiz milestones. */
async function calculateMandatoryCompletion(memberIds: string[]): Promise<Map<string, number>> {
  if (!memberIds.length) return new Map()

  const assignments = await prisma.userLearningAssignment.findMany({
    where: {
      user_id: { in: memberIds },
      mandatory: true,
      can_view: true,
      ended_at: null,
      status: { notIn: ['WAIVED', 'ENDED'] },
      course: { status: 'PUBLISHED' },
    },
    select: {
      user_id: true,
      can_assess: true,
      course: {
        select: {
          final_assessment: { select: { id: true } },
          sessions: { select: { lessons: { select: { id: true, assessment: { select: { id: true } } } } } },
        },
      },
    },
  })

  const requirements = assignments.map((assignment) => {
    const lessons = assignment.course.sessions.flatMap((session) => session.lessons)
    return {
      userId: assignment.user_id,
      lessonIds: lessons.map((lesson) => lesson.id),
      lessonAssessmentIds: lessons.flatMap((lesson) => lesson.assessment ? [lesson.assessment.id] : []),
      finalAssessmentId: assignment.course.final_assessment?.id || null,
      canAssess: assignment.can_assess,
    }
  })
  const lessonIds = Array.from(new Set(requirements.flatMap((assignment) => assignment.lessonIds)))
  const assessmentIds = Array.from(new Set(requirements.flatMap((assignment) => [
    ...assignment.lessonAssessmentIds,
    ...(assignment.finalAssessmentId ? [assignment.finalAssessmentId] : []),
  ])))
  const [completedRows, passedRows] = await Promise.all([
    lessonIds.length
      ? prisma.lessonProgress.findMany({
          where: { user_id: { in: memberIds }, lesson_id: { in: lessonIds }, completed: true },
          select: { user_id: true, lesson_id: true },
        })
      : Promise.resolve([]),
    assessmentIds.length
      ? prisma.attempt.findMany({
          where: {
            user_id: { in: memberIds },
            assessment_id: { in: assessmentIds },
            passed: true,
            status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
          },
          select: { user_id: true, assessment_id: true },
        })
      : Promise.resolve([]),
  ])
  const completedByUser = new Map<string, Set<string>>()
  for (const row of completedRows) {
    const lessons = completedByUser.get(row.user_id) || new Set<string>()
    lessons.add(row.lesson_id)
    completedByUser.set(row.user_id, lessons)
  }
  const passedByUser = new Map<string, Set<string>>()
  for (const row of passedRows) {
    const assessments = passedByUser.get(row.user_id) || new Set<string>()
    assessments.add(row.assessment_id)
    passedByUser.set(row.user_id, assessments)
  }
  return calculateMandatoryCompletionPercentByUser(memberIds, requirements, completedByUser, passedByUser)
}

/** Only Chapters participate. A Chapter needs 20 members, 50% at >=70%, and a yellow or green KPI. */
export async function GET(request: NextRequest) {
  await authenticate(request).catch(() => null)

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const cachedData = getCachedChapterLeaderboard()
  if (cachedData) {
    return NextResponse.json(cachedData, { headers: { 'Cache-Control': 'private, max-age=15' } })
  }

  const [chapters, kpis] = await Promise.all([
    prisma.chapter.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true, name: true, description: true, organization_unit_id: true,
      },
    }),
    prisma.chapterMonthlyKpi.findMany({
      where: { month_start: { gte: monthStart, lt: nextMonth } },
      select: { chapter_id: true, status: true, updated_at: true },
    }),
  ])

  const chapterMembers = await Promise.all(chapters.map(async (chapter) => {
    const unitIds = chapter.organization_unit_id ? await getOrganizationUnitTreeIds(chapter.organization_unit_id) : []
    const membershipScopes: any[] = [{ chapter_members: { some: { chapter_id: chapter.id } } }]
    if (unitIds.length) {
      membershipScopes.push({
        organization_memberships: {
          some: {
            unit_id: { in: unitIds },
            status: 'ACTIVE',
            starts_at: { lte: now },
            OR: [{ ends_at: null }, { ends_at: { gt: now } }],
          },
        },
      })
    }
    const members = await prisma.user.findMany({
      where: { status: 'ACTIVE', role: 'MEMBER', OR: membershipScopes },
      select: { id: true },
    })
    return { chapter, memberIds: members.map((member) => member.id) }
  }))

  const allMemberIds = Array.from(new Set(chapterMembers.flatMap((item) => item.memberIds)))
  const [completionByUser, starRows] = await Promise.all([
    calculateMandatoryCompletion(allMemberIds),
    prisma.starLedger.groupBy({ where: { user_id: { in: allMemberIds } }, by: ['user_id'], _sum: { amount: true } }),
  ])
  const starsByUser = new Map(starRows.map((row) => [row.user_id, row._sum.amount || 0]))
  const kpiByChapter = new Map(kpis.map((kpi) => [kpi.chapter_id, kpi.status]))

  const candidates = chapterMembers.map(({ chapter, memberIds }) => {
    const completions = memberIds.map((id) => completionByUser.get(id) || 0)
    const averageStars = memberIds.length ? memberIds.reduce((sum, id) => sum + (starsByUser.get(id) || 0), 0) / memberIds.length : 0
    const kpiStatus = kpiByChapter.get(chapter.id) || 'YELLOW'
    return { chapter, ...calculateChapterLeaderboardMetrics(completions, averageStars, kpiStatus) }
  })

  // 90th-percentile-like cohort baseline: stars are per member, capped and not a head-count contest.
  const sortedStarAverages = candidates.filter((item) => item.eligible).map((item) => item.averageStars).sort((a, b) => a - b)
  const starBaseline = Math.max(1, sortedStarAverages[Math.max(0, Math.ceil(sortedStarAverages.length * 0.9) - 1)] || 1)
  const items = candidates.filter((item) => item.eligible).map((item) => {
    const { starScore, kpiBonus, score } = scoreChapterLeaderboard(item, starBaseline)
    return {
      chapterId: item.chapter.id, id: item.chapter.id, name: item.chapter.name, description: item.chapter.description,
      memberCount: item.memberCount,
      eligibility: { minimumMembers: true, completionThreshold: true, kpi: item.kpiStatus },
      completion: { averagePercent: Math.round(item.averageCompletion * 10) / 10, medianPercent: Math.round(item.medianCompletion * 10) / 10, atLeast70Percent: Math.round(item.at70Rate * 1000) / 10, score: Math.round(item.completionScore * 10) / 10 },
      stars: { averagePerMember: Math.round(item.averageStars * 10) / 10, score: Math.round(starScore * 10) / 10 },
      kpi: { status: item.kpiStatus, bonus: kpiBonus },
      size: { score: Math.round(item.sizeScore * 10) / 10, cappedAt: 51 },
      score: Math.round(score * 10) / 10,
    }
  }).sort((a, b) => b.score - a.score).map((item, index) => ({ ...item, rank: index + 1 }))

  const excluded = candidates.filter((item) => !item.eligible).map((item) => ({
    chapterId: item.chapter.id,
    name: item.chapter.name,
    memberCount: item.memberCount,
    atLeast70Percent: Math.round(item.at70Rate * 1000) / 10,
    kpiStatus: item.kpiStatus,
    reasons: [
      ...(item.memberCount < 20 ? ['MINIMUM_MEMBERS'] : []),
      ...(item.at70Rate < 0.5 ? ['COMPLETION_THRESHOLD'] : []),
      ...(item.kpiStatus === 'RED' || item.kpiStatus === 'BLACK' ? [`KPI_${item.kpiStatus}`] : []),
    ],
  }))
  const data = {
    month: monthStart.toISOString(),
    formulaVersion: 'chapter-v5',
    updatedAt: new Date().toISOString(),
    sourceUpdatedAt: kpis.reduce<string | null>((latest, kpi) => !latest || kpi.updated_at.toISOString() > latest ? kpi.updated_at.toISOString() : latest, null),
    weights: CHAPTER_LEADERBOARD_WEIGHTS,
    items,
    excluded,
  }
  setCachedChapterLeaderboard(data)
  return NextResponse.json(data, { headers: { 'Cache-Control': 'private, max-age=15' } })
}
