import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessChapterPermission, resolveSingleManagedChapter } from '@/lib/authorization'
import { listChapterMembers } from '@/lib/chapter-members'

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

  // Collect all lessonIds for the current page courses
  const allLessonIds = courses.flatMap((c) => c.sessions.flatMap((s) => s.lessons.map((l) => l.id)))

  // Batch query all completed progresses for chapter student members
  const allCompletedProgress = (totalMembers > 0 && allLessonIds.length > 0)
    ? await prisma.lessonProgress.findMany({
        where: {
          user_id: { in: memberUserIds },
          lesson_id: { in: allLessonIds },
          completed: true,
        },
        select: {
          user_id: true,
          lesson_id: true,
        },
      })
    : []

  const completedSet = new Set(allCompletedProgress.map((p) => `${p.user_id}:${p.lesson_id}`))

  const items = courses.map((course) => {
    const lessonIds = course.sessions.flatMap((s) => s.lessons.map((l) => l.id))
    const totalLessons = lessonIds.length

    let completedCount = 0
    if (totalLessons > 0 && totalMembers > 0) {
      for (const userId of memberUserIds) {
        const allLessonsDone = lessonIds.every((lId) => completedSet.has(`${userId}:${lId}`))
        if (allLessonsDone) {
          completedCount++
        }
      }
    }

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
