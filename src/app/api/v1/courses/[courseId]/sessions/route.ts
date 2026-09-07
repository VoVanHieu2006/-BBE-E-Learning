import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest, { params }: { params: { courseId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin' } }, { status: 403 })

  const courseId = params.courseId
  const body = await request.json()
  const { title, description, sortOrder } = body

  if (!title || title.trim().length < 2) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Tiêu đề session bắt buộc' } }, { status: 400 })
  }

  const course = await prisma.course.findUnique({ where: { id: courseId } })
  if (!course) return NextResponse.json({ error: { code: 'CourseNotFound', message: 'Khóa học không tồn tại' } }, { status: 404 })

  const session = await prisma.session.create({
    data: {
      course_id: courseId,
      title: title.trim(),
      description: description?.trim() || null,
      sort_order: sortOrder ?? 0,
    },
  })

  return NextResponse.json({ sessionId: session.id, courseId: session.course_id, title: session.title, sortOrder: session.sort_order }, { status: 201 })
}
