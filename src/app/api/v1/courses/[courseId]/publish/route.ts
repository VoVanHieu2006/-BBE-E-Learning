import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest, { params }: { params: { courseId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin' } }, { status: 403 })

  const courseId = params.courseId

  const course = await prisma.course.findUnique({ where: { id: courseId }, include: { sessions: { include: { lessons: true } } } })
  if (!course) return NextResponse.json({ error: { code: 'CourseNotFound', message: 'Khóa học không tồn tại' } }, { status: 404 })

  if (course.sessions.length === 0) {
    return NextResponse.json({ error: { code: 'EmptyCourse', message: 'Không thể publish khóa học không có session nào' } }, { status: 400 })
  }

  for (const session of course.sessions) {
    if (session.lessons.length === 0) {
      return NextResponse.json({ error: { code: 'EmptySession', message: `Session "${session.title}" không có lesson nào` } }, { status: 400 })
    }
  }

  const updated = await prisma.course.update({ where: { id: courseId }, data: { status: 'PUBLISHED', published_at: new Date() } })

  return NextResponse.json({ courseId: updated.id, status: updated.status, publishedAt: updated.published_at }, { status: 200 })
}
