import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { invalidateCourseContentCaches } from '@/lib/course-edit-guard'
import { applyCourseDraft } from '@/lib/apply-course-draft'
import { assertDraftIdentity, assertDraftVersion, CourseDraftError, validateDraftContent } from '@/lib/course-draft'
import { finalExamBankError } from '@/lib/final-exam-bank'
import { executePublishCourseRequirements } from '@/lib/course-requirements'
import { lockLearningUser, lockCompetitionScope } from '@/lib/learning-periods'
import { courseDraftInclude, courseDraftSnapshot } from '@/lib/course-draft-snapshot'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest, { params }: { params: { courseId: string } }) {
  const courseId = params.courseId
  if (!UUID_REGEX.test(courseId)) {
    return NextResponse.json({ error: { code: 'CourseNotFound', message: 'Khóa học không tồn tại' } }, { status: 404 })
  }

  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền cập nhật khóa học' } }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  try {
    const updated = await prisma.$transaction(async (tx) => {
      // 1. Advisory Lock
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('learning-catalog-configuration'))::text`

      // Match learning writers: lock users before the course/exam bank to avoid deadlocks with attempts.
      const assignments = await tx.userLearningAssignment.findMany({
        where: { course_id: courseId, ended_at: null, mandatory: true },
        orderBy: { user_id: 'asc' },
      })
      for (const userId of Array.from(new Set(assignments.map((row) => row.user_id)))) {
        await lockLearningUser(tx, userId)
      }
      await tx.$queryRaw`SELECT id FROM courses WHERE id = ${courseId}::uuid FOR UPDATE`
      const course = await tx.course.findUnique({ where: { id: courseId }, include: courseDraftInclude })
      if (!course) throw new CourseDraftError('CourseNotFound', 'Khóa học không tồn tại.', 404)

      // 4. Find draft and verify base version
      const draft = await tx.courseDraft.findUnique({ where: { course_id: courseId } })
      if (!draft) {
        throw new Error('DraftNotFound')
      }
      assertDraftIdentity(body.expectedDraftId, draft.id)
      assertDraftVersion(body.expectedDraftVersion, draft.draft_version, draft.base_content_version, course.content_version)
      if (course.status !== 'PUBLISHED') throw new CourseDraftError('CourseNotPublished', 'Khóa học chưa xuất bản. Hãy tải lại trình chỉnh sửa.', 409)
      const content = validateDraftContent(draft.content, courseDraftSnapshot(course))
      await applyCourseDraft(tx, courseId, content, auth.context!.userId)

      // 6. Execute atomic publish requirements (increments content_version once, extends deadlines)
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
      const scope = await lockCompetitionScope(tx, clock.now)
      const now = scope.now
      const publishedCourse = await executePublishCourseRequirements(tx, courseId, now)

      // 7. Delete draft
      await tx.courseDraft.delete({ where: { course_id: courseId } })
      await tx.auditLog.create({ data: { actor_user_id: auth.context!.userId, action: 'COURSE_DRAFT_PUBLISHED', entity_type: 'Course', entity_id: courseId, metadata: { draftId: draft.id, draftVersion: draft.draft_version, baseContentVersion: draft.base_content_version } } })

      // Metadata-only edits must advance OCC too; requirement fingerprints remain idempotent.
      return tx.course.update({ where: { id: courseId }, data: { content_version: Math.max(course.content_version + 1, publishedCourse.content_version) } })
    }, { timeout: 60_000 })

    invalidateCourseContentCaches(courseId)

    return NextResponse.json({
      courseId: updated.id,
      status: updated.status,
      publishedAt: updated.published_at,
    }, { status: 200 })
  } catch (error: any) {
    if (error instanceof CourseDraftError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status })
    const bankError = finalExamBankError(error)
    if (bankError) return NextResponse.json(bankError, { status: 409 })
    if (error?.message === 'InvalidFinalExamSourceQuestion') return NextResponse.json({ error: { code: error.message, message: 'Có câu hỏi nguồn thiếu đáp án hợp lệ.' } }, { status: 400 })
    if (error?.message === 'DraftNotFound') {
      return NextResponse.json({ error: { code: 'DraftNotFound', message: 'Không tìm thấy bản nháp của khóa học' } }, { status: 404 })
    }
    if (error?.message === 'BaseVersionMismatch') {
      return NextResponse.json({
        error: {
          code: 'BaseVersionMismatch',
          message: 'Khóa học đã có thay đổi mới kể từ khi bản nháp được tạo. Vui lòng làm mới bản nháp.',
        },
      }, { status: 409 })
    }
    if (error?.message === 'PublishedCourseProgramRequired') {
      return NextResponse.json({
        error: {
          code: 'PublishedCourseProgramRequired',
          message: 'Hãy phân loại chương trình trước khi xuất bản.',
        },
      }, { status: 409 })
    }
    console.error('Draft publish error:', error)
    return NextResponse.json({ error: { code: 'PublishFailed', message: error?.message || 'Cập nhật thất bại' } }, { status: 500 })
  }
}
