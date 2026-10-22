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

  if (course.status === 'PUBLISHED') {
    return NextResponse.json({
      error: { code: 'CoursePublished', message: 'Khóa học đã xuất bản. Vui lòng sử dụng luồng Bản thảo (Draft) để chỉnh sửa.' },
    }, { status: 409 })
  }

  const session = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM courses WHERE id = ${courseId}::uuid FOR UPDATE`
    let finalOrder = sortOrder
    if (finalOrder === undefined || finalOrder === null) {
      const maxAgg = await tx.session.aggregate({
        where: { course_id: courseId },
        _max: { sort_order: true },
      })
      finalOrder = (maxAgg._max.sort_order ?? 0) + 1
    }
    return tx.session.create({
      data: {
        course_id: courseId,
        title: title.trim(),
        description: description?.trim() || null,
        sort_order: finalOrder,
      },
    })
  })

  return NextResponse.json({
    sessionId: session.id,
    id: session.id,
    courseId: session.course_id,
    title: session.title,
    description: session.description,
    sortOrder: session.sort_order,
  }, { status: 201 })
}
