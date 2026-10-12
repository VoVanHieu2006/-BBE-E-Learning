import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPublishedSystemData, calculateBatchUsersProgress } from '@/lib/progress/calculator'
import { canAccessChapterPermission, resolveSingleManagedChapter } from '@/lib/authorization'
import { listChapterMembers } from '@/lib/chapter-members'

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

  const url = new URL(request.url)
  const search = url.searchParams.get('search') || ''
  const includeInactive = url.searchParams.get('includeInactive') === '1'
  const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10), 1)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10), 1), 100)
  const skip = (page - 1) * limit

  const userFilter: any = {
    // Mặc định chỉ lấy ACTIVE; ?includeInactive=1 để BĐHU thấy cả thành viên bị vô hiệu hóa
    ...(includeInactive ? {} : { status: 'ACTIVE' }),
    ...(search ? { email: { contains: search, mode: 'insensitive' } } : {}),
  }
  // Chỉ tính thành viên học tập (MEMBER); tài khoản BĐHU (CHAPTER_LEADER / ADMIN) không tính vào tiến trình thành viên chapter
  userFilter.role = 'MEMBER'

  const where: any = {
    chapter_id: chapterId,
    user: userFilter,
  }

  const sys = await getPublishedSystemData()

  const allMembers = await listChapterMembers(chapterId, {
    roles: ['MEMBER'],
    status: includeInactive ? undefined : 'ACTIVE',
    search,
  })
  const totalItems = allMembers.length
  const members = allMembers.slice(skip, skip + limit)

  const memberUserIds = members.map((member) => member.userId)
  const [progressMap, starRows] = await Promise.all([
    calculateBatchUsersProgress(memberUserIds, sys),
    memberUserIds.length
      ? prisma.starLedger.groupBy({ where: { user_id: { in: memberUserIds } }, by: ['user_id'], _sum: { amount: true } })
      : Promise.resolve([]),
  ])
  const starsByUser = new Map(starRows.map((row) => [row.user_id, row._sum.amount || 0]))

  const items = members.map((m) => {
    const p = progressMap.get(m.userId)

    return {
      userId: m.userId,
      id: m.userId,
      email: m.email,
      role: m.role,
      status: m.status,
      joinedAt: m.joinedAt,
      completedCourses: p?.completedCourses || 0,
      totalCourses: sys.totalCourses,
      completedLessons: p?.completedLessons || 0,
      totalLessons: sys.totalLessons,
      avgProgress: p?.overallProgressPercent || 0,
      avgCourseProgress: p?.avgCourseProgressPercent || 0,
      avgQuizScore: p?.avgQuizScore || 0,
      stars: starsByUser.get(m.userId) || 0,
    }
  })

  return NextResponse.json({
    items,
    totalItems,
    totalPages: Math.ceil(totalItems / limit),
    page,
    limit,
    totalLessonsSystem: sys.totalLessons,
    totalCoursesSystem: sys.totalCourses,
  }, { status: 200 })
}
