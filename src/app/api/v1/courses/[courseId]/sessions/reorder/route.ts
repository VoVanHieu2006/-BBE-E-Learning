import { validSessionOrder, reorderCourseSessions } from '@/lib/session-reorder'
import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { invalidateCourseContentCaches } from '@/lib/course-edit-guard'
import { prisma } from '@/lib/prisma'

export async function PATCH(request: NextRequest, { params }: { params: { courseId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin' } }, { status: 403 })

  const courseId = params.courseId
  const body = await request.json().catch(() => null)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(courseId) || !validSessionOrder(body?.sessions)) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Danh s\u00e1ch bu\u1ed5i h\u1ecdc ho\u1eb7c th\u1ee9 t\u1ef1 kh\u00f4ng h\u1ee3p l\u1ec7.' } }, { status: 400 })
  }
  try {
    const error = await prisma.$transaction(tx => reorderCourseSessions(tx, courseId, body.sessions), { isolationLevel: 'Serializable' })
    if (error) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status })
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'P2034' || code === 'P2025') return NextResponse.json({ error: { code: 'ContentChanged', message: 'D\u1eef li\u1ec7u v\u1eeba thay \u0111\u1ed5i. Vui l\u00f2ng t\u1ea3i l\u1ea1i v\u00e0 th\u1eed l\u1ea1i.' } }, { status: 409 })
    console.error('[sessions/reorder] Failed to reorder sessions')
    return NextResponse.json({ error: { code: 'InternalError', message: 'Kh\u00f4ng th\u1ec3 s\u1eafp x\u1ebfp bu\u1ed5i h\u1ecdc. Vui l\u00f2ng th\u1eed l\u1ea1i.' } }, { status: 500 })
  }

  invalidateCourseContentCaches(courseId)
  return NextResponse.json({ success: true }, { status: 200 })
}
