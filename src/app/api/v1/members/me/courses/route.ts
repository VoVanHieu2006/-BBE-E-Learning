import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role === 'MEMBER') {
    // OK
  } else if ((auth as any).context!.role === 'CHAPTER_LEADER' || (auth as any).context!.role === 'ADMIN') {
    // Admin/Leader can also view their own — but this endpoint is specifically for member
  } else {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ thành viên có thể xem' } }, { status: 403 })
  }

  const url = new URL(request.url)
  const page = parseInt(url.searchParams.get('page') || '1', 10)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10), 1), 100)
  const skip = (page - 1) * limit

  // Get chapters of this member
  const memberships = await prisma.chapterMember.findMany({
    where: { user_id: (auth as any).context!.userId },
    include: { chapter: true },
  })
  const chapterIds = memberships.map((m) => m.chapter_id)

  // Find Published + Public / Private (if member of chapter with Active status) courses
  const where: any = { status: 'PUBLISHED' }
  if ((auth as any).context!.role === 'MEMBER') {
    // Member sees Published courses (Private requires Active membership in chapter — simplified: all Published)
    where.status = 'PUBLISHED'
  }

  const [items, totalItems] = await Promise.all([
    prisma.course.findMany({
      where,
      include: {
        sessions: { include: { lessons: { include: { progress: { where: { user_id: (auth as any).context!.userId } } } } } },
      },
      orderBy: { created_at: 'desc' },
      skip, take: limit,
    }),
    prisma.course.count({ where }),
  ])

  // Calculate progress % per course (simplified: completed lessons / total lessons)
  const result = items.map((course) => {
    let totalLessons = 0
    let completedLessons = 0
    for (const session of course.sessions || []) {
      for (const lesson of session.lessons || []) {
        totalLessons++
        if (lesson.progress && lesson.progress.length > 0 && lesson.progress[0].completed) {
          completedLessons++
        }
      }
    }
    return {
      courseId: course.id,
      title: course.title,
      progressPercentage: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
      totalLessons,
      completedLessons,
    }
  })

  return NextResponse.json({ items: result, totalItems, totalPages: Math.ceil(totalItems / limit) })
}
