import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPublishedSystemData, calculateBatchUsersProgress } from '@/lib/progress/calculator'
import { canAccessChapterPermission, resolveSingleManagedChapter } from '@/lib/authorization'
import { listChapterMembers } from '@/lib/chapter-members'
import { canViewInactiveChapterMember } from '@/lib/inactive-member-access'
import { getActiveMetricChapterIds } from '@/lib/active-chapters'

/**
 * GET /api/v1/chapters/[chapterId]/dashboard/members
 * Optimized progress overview of all members in the chapter
 */
export async function GET(request: NextRequest, { params }: { params: { chapterId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  let chapterId = params.chapterId

  // Support "me" alias for chapter leader
  if (chapterId === 'me') {
    const resolved = await resolveSingleManagedChapter(auth.context!)
    if (!resolved) return NextResponse.json({ error: { code: 'ChapterScopeRequired', message: 'Không có Chapter duy nhất trong phạm vi; hãy gửi chapterId cụ thể.' } }, { status: 400 })
    chapterId = resolved
  }

  // Position-based managers are checked against the exact requested Chapter.
  if (!await canAccessChapterPermission(auth.context!, chapterId, 'VIEW_MEMBER_PROGRESS')) {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Không có quyền' } }, { status: 403 })
  }
  if (auth.context!.role !== 'ADMIN' && !(await getActiveMetricChapterIds()).includes(chapterId)) {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }

  // Tự động kiểm tra và áp dụng chuyển giao nhiệm kỳ nếu đã đến hạn


  const url = new URL(request.url)
  const search = url.searchParams.get('search') || ''
  const departmentParam = url.searchParams.get('department') || ''
  const roleTypeParam = url.searchParams.get('roleType') || ''
  const includeInactive = url.searchParams.get('includeInactive') === '1'
  const mayViewInactive = await canViewInactiveChapterMember(auth.context!, chapterId)
  if (includeInactive && !mayViewInactive) return NextResponse.json({ error: { code: 'AccessDenied', message: 'Only Admin or this Chapter lead may view inactive accounts' } }, { status: 403 })
  const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10), 1)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10), 1), 100)
  const skip = (page - 1) * limit

  const [sys, chapter, rawMembers] = await Promise.all([
    getPublishedSystemData(),
    prisma.chapter.findUnique({ where: { id: chapterId }, select: { organization_unit_id: true } }),
    listChapterMembers(chapterId, {
      roles: ['MEMBER'],
      status: includeInactive ? undefined : 'ACTIVE',
      search,
    }),
  ])

  const leadAssignments = chapter?.organization_unit_id
    ? await prisma.positionAssignment.findMany({
        where: {
          position: { code: { in: ['DEPARTMENT_LEAD', 'CHAPTER_MANAGER'] } },
          starts_at: { lte: new Date() },
          OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }],
        },
        select: { user_id: true },
      })
    : []
  const leadUserIds = new Set(leadAssignments.map((a) => a.user_id))

  // Lọc theo Ban và Chức vụ
  const filteredMembers = rawMembers.filter((m) => {
    if (departmentParam) {
      if (departmentParam === 'unassigned') {
        if (m.department?.name) return false
      } else {
        if (!m.department?.name || m.department.name.toLowerCase() !== departmentParam.toLowerCase()) {
          return false
        }
      }
    }
    if (roleTypeParam) {
      const isLead = leadUserIds.has(m.userId)
      if (roleTypeParam === 'LT' && !isLead) return false
      if (roleTypeParam === 'MEMBER' && isLead) return false
    }
    return true
  })

  const totalItems = filteredMembers.length
  const members = filteredMembers.slice(skip, skip + limit)
  const allChapterUserIds = rawMembers.filter((member) => member.status === 'ACTIVE').map((member) => member.userId)
  const [progressMap, overallProgressRows, allStarRows] = await Promise.all([
    calculateBatchUsersProgress(members.map((member) => member.userId), sys),
    allChapterUserIds.length && sys.allLessonIdSet.size
      ? prisma.lessonProgress.groupBy({
          where: { user_id: { in: allChapterUserIds }, lesson_id: { in: Array.from(sys.allLessonIdSet) }, completed: true },
          by: ['user_id'],
          _count: { id: true },
        })
      : Promise.resolve([]),
    allChapterUserIds.length
      ? prisma.starLedger.groupBy({ where: { user_id: { in: allChapterUserIds } }, by: ['user_id'], _sum: { amount: true } })
      : Promise.resolve([]),
  ])
  const overallProgressByUser = new Map(overallProgressRows.map((row) => [row.user_id, sys.totalLessons ? Math.round((row._count.id / sys.totalLessons) * 100) : 0]))
  const starsByUser = new Map(allStarRows.map((row) => [row.user_id, row._sum.amount || 0]))
  const totalStars = allStarRows.reduce((sum, row) => sum + (row._sum.amount || 0), 0)

  const activeRawMembers = rawMembers.filter((m) => m.status === 'ACTIVE')
  const allProgressValues = activeRawMembers.map((m) => overallProgressByUser.get(m.userId) || 0)
  const avgChapterProgress = allProgressValues.length > 0
    ? Math.round(allProgressValues.reduce((a, b) => a + b, 0) / allProgressValues.length)
    : 0

  const membersOver70 = activeRawMembers.filter((m) => (overallProgressByUser.get(m.userId) || 0) >= 70).length

  const summary = {
    totalMembers: activeRawMembers.length,
    activeMembers: rawMembers.filter((m) => m.status === 'ACTIVE').length,
    avgChapterProgress,
    totalStars,
    membersOver70,
  }

  const items = members.map((m) => {
    const p = progressMap.get(m.userId)

    return {
      userId: m.userId,
      id: m.userId,
      email: m.email,
      displayName: m.displayName,
      department: m.department,
      role: m.role,
      isLead: leadUserIds.has(m.userId),
      status: m.status,
      joinedAt: m.joinedAt,
      deactivatedByUserId: m.deactivatedByUserId,
      deactivatedByRole: m.deactivatedByRole,
      cascadeLeadId: m.cascadeLeadId,
      completedCourses: p?.completedCourses || 0,
      totalCourses: sys.totalCourses,
      completedLessons: p?.completedLessons || 0,
      totalLessons: sys.totalLessons,
      avgProgress: p?.overallProgressPercent || 0,
      avgCourseProgress: p?.avgCourseProgressPercent || 0,
      stars: starsByUser.get(m.userId) || 0,
    }
  })

  return NextResponse.json({
    items,
    summary,
    totalItems,
    totalPages: Math.ceil(totalItems / limit),
    page,
    limit,
    totalLessonsSystem: sys.totalLessons,
    totalCoursesSystem: sys.totalCourses,
  }, { status: 200 })
}
