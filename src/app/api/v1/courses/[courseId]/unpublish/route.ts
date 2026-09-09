import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { invalidateSystemDataCache } from '@/lib/progress/calculator'

export async function POST(request: NextRequest, { params }: { params: { courseId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin' } }, { status: 403 })
  }

  const courseId = params.courseId
  const course = await prisma.course.findUnique({ where: { id: courseId } })
  if (!course) return NextResponse.json({ error: { code: 'CourseNotFound', message: 'Khóa học không tồn tại' } }, { status: 404 })

  if (course.status !== 'PUBLISHED') {
    return NextResponse.json({ error: { code: 'AlreadyDraft', message: 'Khóa học đã ở trạng thái bản nháp.' } }, { status: 400 })
  }

  // Check for active in-progress attempts before unpublishing (issue #5 — warning)
  const activeAttempts = await prisma.attempt.count({
    where: {
      assessment: { course_id: courseId },
      status: 'IN_PROGRESS',
    },
  })

  // Check members with progress < 100%
  const inProgressLearners = await prisma.lessonProgress.findMany({
    where: {
      lesson: {
        session: { course_id: courseId },
      },
      completed: false,
    },
    select: { user_id: true },
    distinct: ['user_id'],
  })

  // We allow unpublish but warn admin about learners
  const updated = await prisma.course.update({
    where: { id: courseId },
    data: { status: 'DRAFT', published_at: null },
  })
  invalidateSystemDataCache()

  return NextResponse.json({
    courseId: updated.id,
    status: updated.status,
    warnings: [
      ...(activeAttempts > 0
        ? [`⚠️ Có ${activeAttempts} bài kiểm tra đang diễn ra sẽ bị ảnh hưởng.`]
        : []),
      ...(inProgressLearners.length > 0
        ? [`⚠️ Có ${inProgressLearners.length} học viên đang trong tiến trình học. Họ sẽ không thể tiếp tục cho đến khi khóa học được công khai lại.`]
        : []),
    ],
  }, { status: 200 })
}
