import { isLeadRole } from '@/lib/roles'
import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { AttemptStatus } from '@prisma/client'
import { calculateUserProgress } from '@/lib/progress/calculator'
import { buildLearningDetail, sumStarsBySource } from '@/lib/progress/learning-detail'
import { currentCycleAttemptFilter } from '@/lib/learning-periods'
import { hasChapterPermission, resolveSingleManagedChapter } from '@/lib/authorization'
import { getOrganizationUnitTreeIds } from '@/lib/learning-assignments'
import { canViewInactiveChapterMember } from '@/lib/inactive-member-access'
import { getActiveMetricChapterIds } from '@/lib/active-chapters'

/**
 * GET /api/v1/chapters/[chapterId]/members/[userId]/course-progress
 * Chi tiết tiến độ theo từng khóa học của một thành viên (trang chi tiết của BĐHU)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { chapterId: string; userId: string } }
) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  let chapterId = params.chapterId
  const isAdminAllScope = auth.context!.role === 'ADMIN' && chapterId === 'all'

  // Support "me" alias for chapter leader
  if (chapterId === 'me') {
    const resolved = await resolveSingleManagedChapter(auth.context!)
    if (!resolved) return NextResponse.json({ error: { code: 'ChapterScopeRequired', message: 'Không có Chapter duy nhất trong phạm vi; hãy gửi chapterId cụ thể.' } }, { status: 400 })
    chapterId = resolved
  }

  // Authorization check
  const isLeader = isLeadRole(auth.context!.role) && auth.context!.chapterId === chapterId
  const isAdmin = auth.context!.role === 'ADMIN'
  if (!isAdmin && !(await getActiveMetricChapterIds()).includes(chapterId)) {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }
  if (!isLeader && !isAdmin) {
    const hasPerm = await hasChapterPermission(auth.context!.userId, chapterId, 'VIEW_MEMBER_PROGRESS')
    if (!hasPerm) {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'Không có quyền' } }, { status: 403 })
    }
  }

  const targetUserId = params.userId
  const chapter = isAdminAllScope
    ? { name: null, organization_unit_id: null }
    : await prisma.chapter.findUnique({ where: { id: chapterId }, select: { name: true, organization_unit_id: true } })
  if (!chapter) return NextResponse.json({ error: { code: 'NotFound', message: 'Chapter không tồn tại' } }, { status: 404 })

  // Thành viên phải thuộc chapter này (cho phép cả INACTIVE để BĐHU vẫn xem được thành viên bị khóa)
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      email: true,
      display_name: true,
      status: true,
      role: true,
      created_at: true,
      chapter_members: { select: { chapter_id: true, joined_at: true } },
    },
  })

  if (!target || !['MEMBER', 'LEAD'].includes(target.role)) {
    return NextResponse.json({ error: { code: 'NotFound', message: 'Thành viên không thuộc chapter này' } }, { status: 404 })
  }
  if (target.status !== 'ACTIVE' && !await canViewInactiveChapterMember(auth.context!, chapterId)) {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Only Admin or this Chapter lead may view inactive accounts' } }, { status: 403 })
  }

  const legacyMembership = target.chapter_members.find((cm) => cm.chapter_id === chapterId)
  let joinedAt = legacyMembership?.joined_at || target.created_at
  const unitIds = chapter.organization_unit_id ? await getOrganizationUnitTreeIds(chapter.organization_unit_id) : []
  const organizationMemberships = unitIds.length
    ? await prisma.organizationMembership.findMany({
        where: {
          user_id: targetUserId,
          unit_id: { in: unitIds },
          status: 'ACTIVE',
          starts_at: { lte: new Date() },
          OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }],
        },
        select: { starts_at: true, unit: { select: { name: true, type: true } } },
      })
    : []
  if (!isAdminAllScope && !legacyMembership) {
    if (!organizationMemberships.length) {
      return NextResponse.json({ error: { code: 'NotFound', message: 'Thành viên không thuộc chapter này' } }, { status: 404 })
    }
    joinedAt = organizationMemberships[0].starts_at
  }
  const department = organizationMemberships.find((membership) => membership.unit.type === 'DEPARTMENT')?.unit

  const [userSummary, cycleFilter, activeCycle] = await Promise.all([
    calculateUserProgress(targetUserId),
    currentCycleAttemptFilter(prisma, targetUserId),
    prisma.learningCycle.findFirst({ where: { user_id: targetUserId, ends_at: null }, select: { id: true } }),
  ])
  const attemptWhere = { user_id: targetUserId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] as AttemptStatus[] }, ...cycleFilter }

  // This detail is deliberately built from the immutable progress/attempt records,
  // not from the client. It is used by Admin and BĐHU to audit every module/video.
  // It follows the active learning cycle, like calculateUserProgress, so the two never disagree.
  const [learningDetail, starEntries, cycleProgress] = await Promise.all([
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
                  where: { user_id: targetUserId },
                  select: {
                    completed: true,
                    completed_at: true,
                    furthest_watched_position_seconds: true,
                    last_watched_at: true,
                  },
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
    prisma.starLedger.findMany({
      where: { user_id: targetUserId },
      select: { amount: true, source_type: true, source_id: true, learning_cycle_id: true },
    }),
    activeCycle
      ? prisma.cycleLessonProgress.findMany({
          where: { user_id: targetUserId, learning_cycle_id: activeCycle.id },
          select: { lesson_id: true, furthest_seconds: true, completed_at: true },
        })
      : Promise.resolve(null),
  ])

  const cycleStarEntries = activeCycle
    ? starEntries.filter((entry) => entry.learning_cycle_id === activeCycle.id || entry.learning_cycle_id === null)
    : starEntries
  const detailedCourses = buildLearningDetail(learningDetail, sumStarsBySource(cycleStarEntries), cycleProgress)

  return NextResponse.json(
    {
      user: {
        userId: target.id,
        email: target.email,
        status: target.status,
        joinedAt,
        displayName: target.display_name,
        chapterName: chapter.name,
        departmentName: department?.name ?? null,
        completedLessons: userSummary.completedLessons,
        totalLessons: userSummary.totalLessons,
        overallProgressPercent: userSummary.overallProgressPercent,
      },
      summary: {
        totalCourses: userSummary.totalCourses,
        completedCourses: userSummary.completedCourses,
        completedLessons: userSummary.completedLessons,
        totalLessons: userSummary.totalLessons,
        avgProgress: userSummary.overallProgressPercent,
        avgCourseProgress: userSummary.avgCourseProgressPercent,
        avgQuizScore: userSummary.avgQuizScore,
        stars: starEntries.reduce((total, entry) => total + entry.amount, 0),
      },
      courses: userSummary.courses || [],
      learningDetail: detailedCourses,
    },
    { status: 200 }
  )
}
