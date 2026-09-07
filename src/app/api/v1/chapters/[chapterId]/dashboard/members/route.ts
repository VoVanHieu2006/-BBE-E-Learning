import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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
  // Chỉ tính thành viên học tập (MEMBER); tài khoản BĐHU không tính vào số thành viên chapter
  if ((auth as any).context!.role !== 'ADMIN') userFilter.role = 'MEMBER'

  const where: any = {
    chapter_id: chapterId,
    user: userFilter,
  }

  const [members, totalItems, publishedCourses] = await Promise.all([
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
    prisma.course.findMany({
      where: { status: 'PUBLISHED' },
      select: {
        id: true,
        sessions: {
          select: {
            lessons: { select: { id: true } },
          },
        },
      },
    }),
  ])

  const memberUserIds = members.map((m) => m.user.id)
  const totalPublishedCourses = publishedCourses.length

  // Batch query all completed progresses for these members in ONE query
  const allCompletedProgress = memberUserIds.length > 0
    ? await prisma.lessonProgress.findMany({
        where: {
          user_id: { in: memberUserIds },
          completed: true,
        },
        select: {
          user_id: true,
          lesson_id: true,
        },
      })
    : []

  // Build lookup set: "userId:lessonId"
  const completedSet = new Set(allCompletedProgress.map((p) => `${p.user_id}:${p.lesson_id}`))

  const items = members.map((m) => {
    const userId = m.user.id
    let completedCoursesCount = 0
    let completedLessonsTotal = 0
    let totalProgressSum = 0

    for (const course of publishedCourses) {
      const lessonIds = course.sessions.flatMap((s) => s.lessons.map((l) => l.id))
      if (lessonIds.length === 0) continue

      let completedLessonsCount = 0
      for (const lId of lessonIds) {
        if (completedSet.has(`${userId}:${lId}`)) {
          completedLessonsCount++
        }
      }

      const progressPercent = (completedLessonsCount / lessonIds.length) * 100
      totalProgressSum += progressPercent
      completedLessonsTotal += completedLessonsCount

      if (completedLessonsCount === lessonIds.length) {
        completedCoursesCount++
      }
    }

    const avgProgress = totalPublishedCourses > 0 ? Math.round(totalProgressSum / totalPublishedCourses) : 0

    return {
      userId: m.user.id,
      id: m.user.id,
      email: m.user.email,
      role: m.user.role,
      status: m.user.status,
      joinedAt: m.joined_at,
      completedCourses: completedCoursesCount,
      totalCourses: totalPublishedCourses,
      completedLessons: completedLessonsTotal,
      avgProgress,
    }
  })

  return NextResponse.json({
    items,
    totalItems,
    totalPages: Math.ceil(totalItems / limit),
    page,
    limit,
  }, { status: 200 })
}
