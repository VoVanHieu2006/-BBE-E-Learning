import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(request: NextRequest, { params }: { params: { courseId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin' } }, { status: 403 })

  const courseId = params.courseId
  const body = await request.json()
  const { sessions } = body

  if (!Array.isArray(sessions) || sessions.length === 0) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'sessions array bắt buộc' } }, { status: 400 })
  }

  // Verify course
  const course = await prisma.course.findUnique({ where: { id: courseId } })
  if (!course) return NextResponse.json({ error: { code: 'CourseNotFound', message: 'Không tồn tại' } }, { status: 404 })

  // Update in transaction
  await prisma.$transaction(
    sessions.map((s: { sessionId: string; sortOrder: number }) =>
      prisma.session.update({ where: { id: s.sessionId }, data: { sort_order: s.sortOrder } })
    )
  )

  return NextResponse.json({ success: true }, { status: 200 })
}
