import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessOrganizationUnitPermission } from '@/lib/authorization'
import { getOrganizationUnitTreeIds } from '@/lib/learning-assignments'
import { listChapterMembers } from '@/lib/chapter-members'
import { isOrganizationId } from '@/lib/organization-admin-rules'
import type { AttemptStatus } from '@prisma/client'
import { calculateUserProgress } from '@/lib/progress/calculator'
import { buildLearningDetail, sumStarsBySource } from '@/lib/progress/learning-detail'
import { currentCycleAttemptFilter } from '@/lib/learning-periods'
import { canViewInactiveChapterMember } from '@/lib/inactive-member-access'
import { getActiveMetricChapterIds, getParentChapterId } from '@/lib/active-chapters'

/** Detailed course/module/video/quiz/Star progress within an authorized organization scope. */
export async function GET(_request: NextRequest, { params }: { params: { unitId: string; userId: string } }) {
  const auth = await authenticate(_request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (!isOrganizationId(params.unitId) || !isOrganizationId(params.userId)) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
  if (!await canAccessOrganizationUnitPermission(auth.context!, params.unitId, 'VIEW_MEMBER_PROGRESS')) {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }

  const unit = await prisma.organizationUnit.findUnique({ where: { id: params.unitId }, select: { id: true, chapter: { select: { id: true } } } })
  if (!unit) return NextResponse.json({ error: { code: 'OrganizationUnitNotFound' } }, { status: 404 })
  const parentChapterId = await getParentChapterId(unit.id)
  if (parentChapterId && auth.context!.role !== 'ADMIN' && !(await getActiveMetricChapterIds()).includes(parentChapterId)) {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }
  const target = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, email: true, status: true, role: true, created_at: true },
  })
  if (!target || target.role !== 'MEMBER') return NextResponse.json({ error: { code: 'MemberNotFound' } }, { status: 404 })
  if (target.status !== 'ACTIVE' && !(auth.context!.role === 'ADMIN' || (parentChapterId && await canViewInactiveChapterMember(auth.context!, parentChapterId)))) {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }

  const now = new Date()
  let joinedAt: Date | null = null
  if (unit.chapter) {
    const roster = await listChapterMembers(unit.chapter.id, { roles: ['MEMBER'], search: target.email })
    joinedAt = roster.find((member) => member.userId === target.id)?.joinedAt || null
  } else {
    const unitIds = await getOrganizationUnitTreeIds(unit.id)
    const membership = await prisma.organizationMembership.findFirst({
      where: { user_id: target.id, unit_id: { in: unitIds }, status: 'ACTIVE', starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
      orderBy: { starts_at: 'asc' },
      select: { starts_at: true },
    })
    joinedAt = membership?.starts_at || null
  }
  if (!joinedAt) return NextResponse.json({ error: { code: 'MemberNotFound' } }, { status: 404 })

  const [cycleFilter, activeCycle] = await Promise.all([
    currentCycleAttemptFilter(prisma, target.id),
    prisma.learningCycle.findFirst({ where: { user_id: target.id, ends_at: null }, select: { id: true } }),
  ])
  const attemptWhere = { user_id: target.id, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] as AttemptStatus[] }, ...cycleFilter }
  // Detail follows the active learning cycle, like calculateUserProgress, so the two never disagree.
  const [summary, courses, starEntries, cycleProgress] = await Promise.all([
    calculateUserProgress(target.id),
    prisma.course.findMany({
      where: { status: 'PUBLISHED' },
      select: {
        id: true,
        title: true,
        final_assessment: {
          select: {
            id: true,
            title: true,
            attempts: {
              where: attemptWhere,
              orderBy: { submitted_at: 'desc' },
              select: { id: true, attempt_number: true, score: true, passed: true, status: true, submitted_at: true },
            },
          },
        },
        sessions: {
          orderBy: { sort_order: 'asc' },
          select: {
            id: true,
            title: true,
            sort_order: true,
            lessons: {
              orderBy: { sort_order: 'asc' },
              select: {
                id: true,
                title: true,
                sort_order: true,
                video: { select: { id: true, title: true, duration_seconds: true } },
                progress: {
                  where: { user_id: target.id },
                  select: { completed: true, completed_at: true, furthest_watched_position_seconds: true, last_watched_at: true },
                  take: 1,
                },
                assessment: {
                  select: {
                    id: true,
                    title: true,
                    attempts: {
                      where: attemptWhere,
                      orderBy: { submitted_at: 'desc' },
                      select: { id: true, attempt_number: true, score: true, passed: true, status: true, submitted_at: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { created_at: 'asc' },
    }),
    prisma.starLedger.findMany({ where: { user_id: target.id }, select: { amount: true, source_type: true, source_id: true, learning_cycle_id: true } }),
    activeCycle
      ? prisma.cycleLessonProgress.findMany({
          where: { user_id: target.id, learning_cycle_id: activeCycle.id },
          select: { lesson_id: true, furthest_seconds: true, completed_at: true },
        })
      : Promise.resolve(null),
  ])

  const cycleStarEntries = activeCycle
    ? starEntries.filter((entry) => entry.learning_cycle_id === activeCycle.id || entry.learning_cycle_id === null)
    : starEntries
  const learningDetail = buildLearningDetail(courses, sumStarsBySource(cycleStarEntries), cycleProgress)

  return NextResponse.json({
    user: { userId: target.id, email: target.email, status: target.status, joinedAt },
    summary: {
      totalCourses: summary.totalCourses,
      completedCourses: summary.completedCourses,
      completedLessons: summary.completedLessons,
      totalLessons: summary.totalLessons,
      avgProgress: summary.overallProgressPercent,
      avgCourseProgress: summary.avgCourseProgressPercent,
      avgQuizScore: summary.avgQuizScore,
      stars: starEntries.reduce((total, entry) => total + entry.amount, 0),
    },
    courses: summary.courses || [],
    learningDetail,
  })
}
