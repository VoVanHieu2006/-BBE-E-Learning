import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessChapterPermission, resolveSingleManagedChapter } from '@/lib/authorization'
import { listChapterMembers } from '@/lib/chapter-members'
import { countCompletedLessonsByCourse } from '@/lib/progress/completed-lesson-counts'
import { getActiveMetricChapterIds } from '@/lib/active-chapters'

/**
 * GET /api/v1/chapters/[chapterId]/dashboard/courses
 * Optimized course completion stats for members of this chapter
 */
export async function GET(request: NextRequest, { params }: { params: { chapterId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  let chapterId = params.chapterId

  // Support "me" alias
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

  const url = new URL(request.url)
  const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10), 1)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10), 1), 100)
  const skip = (page - 1) * limit

  // Get active student members in this chapter (EXCLUDING BĐHU and Admin)
  const chapterMembers = await listChapterMembers(chapterId, { roles: ['MEMBER'], status: 'ACTIVE' })
  const memberUserIds = chapterMembers.map((member) => member.userId)
  const totalMembers = memberUserIds.length

  // Get published courses with pagination
  const [courses, totalItems] = await Promise.all([
    prisma.course.findMany({
      where: { status: 'PUBLISHED' },
      include: {
        sessions: {
          include: {
            lessons: { select: { id: true } },
          },
        },
      },
      orderBy: { created_at: 'desc' },
      skip,
      take: limit,
    }),
    prisma.course.count({ where: { status: 'PUBLISHED' } }),
  ])

  const completedRows = await countCompletedLessonsByCourse(memberUserIds, courses.map((course) => course.id))
  const completedByCourse = new Map<string, number>()
  const totalLessonsByCourse = new Map(courses.map((course) => [course.id, course.sessions.reduce((count, session) => count + session.lessons.length, 0)]))
  for (const row of completedRows) {
    if (Number(row.completed_count) === totalLessonsByCourse.get(row.course_id)) {
      completedByCourse.set(row.course_id, (completedByCourse.get(row.course_id) || 0) + 1)
    }
  }

  const items = courses.map((course) => {
    const lessonIds = course.sessions.flatMap((s) => s.lessons.map((l) => l.id))
    const totalLessons = lessonIds.length

    // Preserve the existing empty-course rule: every member counts as complete.
    const completedCount = totalLessons === 0 ? totalMembers : (completedByCourse.get(course.id) || 0)

    const completionRate = totalMembers > 0 ? Math.round((completedCount / totalMembers) * 100) : 0

    return {
      courseId: course.id,
      id: course.id,
      title: course.title,
      description: course.description,
      totalLessons,
      completedCount,
      totalMembers,
      completionRate,
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
