import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: { courseId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const courseId = params.courseId

  const course = await prisma.course.findUnique({ where: { id: courseId } })
  if (!course) return NextResponse.json({ error: { code: 'CourseNotFound', message: 'Khóa học không tồn tại' } }, { status: 404 })
  
  const role = (auth as any).context!.role
  if (course.status !== 'PUBLISHED' && role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Khóa học chưa publish' } }, { status: 403 })
  }

  const user = await prisma.user.findUnique({ where: { id: (auth as any).context!.userId } })
  if (!user || user.status !== 'ACTIVE') return NextResponse.json({ error: { code: 'AccessDenied', message: 'Tài khoản phải Active' } }, { status: 403 })

  const detail = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      sessions: {
        orderBy: { sort_order: 'asc' },
        include: {
          lessons: {
            orderBy: { sort_order: 'asc' },
            include: {
              video: { select: { id: true, duration_seconds: true } },
              progress: { where: { user_id: (auth as any).context!.userId } },
            },
          },
        },
      },
    },
  })

  let totalLessons = 0
  let completedLessons = 0
  const sessions = detail!.sessions.map((s) => {
    return {
      sessionId: s.id,
      id: s.id,
      title: s.title,
      sortOrder: s.sort_order,
      lessons: s.lessons.map((l) => {
        totalLessons++
        const prog = l.progress && l.progress.length > 0 ? l.progress[0] : null
        if (prog?.completed) completedLessons++
        return {
          lessonId: l.id,
          id: l.id,
          title: l.title,
          completed: prog?.completed || false,
          furthestWatchedPositionSeconds: prog?.furthest_watched_position_seconds || null,
          lastPositionSeconds: prog?.last_position_seconds || null,
        }
      }),
    }
  })

  const progressPercentage = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0

  return NextResponse.json({
    courseId,
    id: courseId,
    progressPercentage,
    percentage: progressPercentage,
    totalLessons,
    completedLessons,
    sessions,
  })
}
