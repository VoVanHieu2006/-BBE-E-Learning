import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPublishedSystemData, calculateBatchUsersProgress } from '@/lib/progress/calculator'

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
    if ((auth as any).context!.role === 'CHAPTER_LEADER' && (auth as any).context!.chapterId) {
      chapterId = (auth as any).context!.chapterId
    } else {
      return NextResponse.json({ error: { code: 'ValidationError', message: 'ChapterId không hợp lệ' } }, { status: 400 })
    }
  }

  // Authorization check
  if ((auth as any).context!.role === 'CHAPTER_LEADER') {
    if ((auth as any).context!.chapterId !== chapterId) {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'BĐHU chỉ có quyền xem chapter của mình' } }, { status: 403 })
    }
  } else if ((auth as any).context!.role !== 'ADMIN') {
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

  const [members, totalItems] = await Promise.all([
    prisma.chapterMember.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            status: true,
            role: true,
            created_at: true,
          },
        },
      },
      orderBy: { joined_at: 'desc' },
      skip,
      take: limit,
    }),
    prisma.chapterMember.count({ where }),
  ])

  const memberUserIds = members.map((m) => m.user.id)
  const progressMap = await calculateBatchUsersProgress(memberUserIds, sys)

  const items = members.map((m) => {
    const p = progressMap.get(m.user.id)

    return {
      userId: m.user.id,
      id: m.user.id,
      email: m.user.email,
      role: m.user.role,
      status: m.user.status,
      joinedAt: m.joined_at,
      completedCourses: p?.completedCourses || 0,
      totalCourses: sys.totalCourses,
      completedLessons: p?.completedLessons || 0,
      totalLessons: sys.totalLessons,
      avgProgress: p?.overallProgressPercent || 0,
      avgCourseProgress: p?.avgCourseProgressPercent || 0,
      avgQuizScore: p?.avgQuizScore || 0,
      leaderboardPoint: p?.leaderboardPoint || 0,
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
