import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { listAccessibleChapterIds } from '@/lib/authorization'
import { listChapterMembers } from '@/lib/chapter-members'

/**
 * GET /api/v1/courses/[courseId]/students
 * Danh sách học viên của khóa + tiến độ từng người.
 * - CHAPTER_LEADER: chỉ member ACTIVE thuộc chapter của mình (FR-DB-01)
 * - ADMIN: mọi member đã có tương tác học với khóa này
 */
export async function GET(request: NextRequest, { params }: { params: { courseId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const context = auth.context!
  const isAdmin = context.role === 'ADMIN'
  const requestedChapterId = new URL(request.url).searchParams.get('chapterId')
  const accessibleChapterIds = isAdmin ? [] : requestedChapterId
    ? (await listAccessibleChapterIds(context, 'VIEW_MEMBER_PROGRESS')).filter((id) => id === requestedChapterId)
    : await listAccessibleChapterIds(context, 'VIEW_MEMBER_PROGRESS')
  if (!isAdmin && accessibleChapterIds.length === 0) {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Không có quyền' } }, { status: 403 })
  }

  const courseId = params.courseId

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      title: true,
      status: true,
      sessions: { select: { lessons: { select: { id: true } } } },
    },
  })
  if (!course) {
    return NextResponse.json({ error: { code: 'CourseNotFound', message: 'Khóa học không tồn tại' } }, { status: 404 })
  }

  const lessonIds = course.sessions.flatMap((s) => s.lessons.map((l) => l.id))

  let users: Array<{ id: string; email: string; display_name: string | null; status: string }>

  if (isAdmin) {
    const [assigned, withProgress] = await Promise.all([
      prisma.userLearningAssignment.findMany({
        where: { course_id: courseId, ended_at: null, user: { role: 'MEMBER' } },
        select: { user_id: true },
      }),
      lessonIds.length > 0
        ? prisma.user.findMany({
            where: { role: 'MEMBER', lessonProgress: { some: { lesson_id: { in: lessonIds } } } },
            select: { id: true },
          })
        : Promise.resolve([]),
    ])
    const userIds = Array.from(new Set([...assigned.map((row) => row.user_id), ...withProgress.map((row) => row.id)]))
    users = userIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: userIds }, role: 'MEMBER' },
          select: { id: true, email: true, display_name: true, status: true },
          orderBy: { email: 'asc' },
        })
      : []
  } else {
    const membersByChapter = await Promise.all(accessibleChapterIds.map((chapterId) =>
      listChapterMembers(chapterId, { roles: ['MEMBER'], status: 'ACTIVE' }),
    ))
    const memberIds = Array.from(new Set(membersByChapter.reduce<string[]>(
      (ids, members) => ids.concat(members.map((member) => member.userId)),
      [],
    )))
    users = memberIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: memberIds }, status: 'ACTIVE', role: 'MEMBER' },
          select: { id: true, email: true, display_name: true, status: true },
          orderBy: { email: 'asc' },
        })
      : []
  }

  const userIds = users.map((u) => u.id)
  const progressRows =
    userIds.length > 0 && lessonIds.length > 0
      ? await prisma.lessonProgress.findMany({
          where: { user_id: { in: userIds }, lesson_id: { in: lessonIds }, completed: true },
          select: { user_id: true, lesson_id: true },
        })
      : []
  const completedSet = new Set(progressRows.map((p) => `${p.user_id}:${p.lesson_id}`))

  const items = users.map((u) => {
    const completedLessons = lessonIds.filter((l) => completedSet.has(`${u.id}:${l}`)).length
    const progressPercent = lessonIds.length > 0 ? Math.round((completedLessons / lessonIds.length) * 100) : 0
    const state = progressPercent >= 100 ? 'COMPLETED' : completedLessons > 0 ? 'IN_PROGRESS' : 'NOT_STARTED'

    return {
      userId: u.id,
      email: u.email,
      displayName: u.display_name,
      status: u.status,
      completedLessons,
      totalLessons: lessonIds.length,
      progressPercent,
      state,
    }
  })

  return NextResponse.json({
    courseId,
    courseTitle: course.title,
    totalLessons: lessonIds.length,
    summary: {
      totalStudents: items.length,
      completed: items.filter((i) => i.state === 'COMPLETED').length,
      inProgress: items.filter((i) => i.state === 'IN_PROGRESS').length,
      notStarted: items.filter((i) => i.state === 'NOT_STARTED').length,
    },
    items,
  })
}
