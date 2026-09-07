import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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

  const targetUserId = params.userId

  // Thành viên phải thuộc chapter này (cho phép cả INACTIVE để BĐHU vẫn xem được thành viên bị khóa)
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      email: true,
      status: true,
      role: true,
      created_at: true,
      chapter_members: { select: { chapter_id: true, joined_at: true } },
    },
  })

  if (!target || target.role !== 'MEMBER' || !target.chapter_members.some((cm) => cm.chapter_id === chapterId)) {
    return NextResponse.json({ error: { code: 'NotFound', message: 'Thành viên không thuộc chapter này' } }, { status: 404 })
  }

  const [publishedCourses, progressRows] = await Promise.all([
    prisma.course.findMany({
      where: { status: 'PUBLISHED' },
      select: {
        id: true,
        title: true,
        sessions: { select: { lessons: { select: { id: true } } } },
      },
    }),
    prisma.lessonProgress.findMany({
      where: { user_id: targetUserId, completed: true },
      select: { lesson_id: true },
    }),
  ])

  const completedLessonIds = new Set(progressRows.map((p) => p.lesson_id))

  const courses = publishedCourses.map((course) => {
    const lessonIds = course.sessions.flatMap((s) => s.lessons.map((l) => l.id))
    const completedLessons = lessonIds.filter((id) => completedLessonIds.has(id)).length
    const progressPercent = lessonIds.length > 0 ? Math.round((completedLessons / lessonIds.length) * 100) : 0
    const state = progressPercent >= 100 ? 'COMPLETED' : completedLessons > 0 ? 'IN_PROGRESS' : 'NOT_STARTED'

    return {
      courseId: course.id,
      title: course.title,
      totalLessons: lessonIds.length,
      completedLessons,
      progressPercent,
      state,
    }
  })

  const totalCourses = courses.length
  const completedCourses = courses.filter((c) => c.state === 'COMPLETED').length
  const avgProgress = totalCourses > 0 ? Math.round(courses.reduce((sum, c) => sum + c.progressPercent, 0) / totalCourses) : 0

  const membership = target.chapter_members.find((cm) => cm.chapter_id === chapterId)

  return NextResponse.json(
    {
      user: {
        userId: target.id,
        email: target.email,
        status: target.status,
        joinedAt: membership?.joined_at || target.created_at,
        completedLessons: courses.reduce((sum, c) => sum + c.completedLessons, 0),
      },
      summary: {
        totalCourses,
        completedCourses,
        avgProgress,
      },
      courses,
    },
    { status: 200 }
  )
}
