import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertDraftIdentity, assertDraftVersion, CourseDraftError, DRAFT_UUID, validateDraftContent } from '@/lib/course-draft'
import { courseDraftInclude, courseDraftSnapshot } from '@/lib/course-draft-snapshot'
import { Prisma } from '@prisma/client'

const jsonError = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status })
const conflict = (e: unknown) => e instanceof CourseDraftError ? jsonError(e.code, e.message, e.status) : null
const draftResponse = (draft: { id: string; course_id: string; base_content_version: number; draft_version: number; content: unknown }) => ({
  id: draft.id, courseId: draft.course_id, baseContentVersion: draft.base_content_version, draftVersion: draft.draft_version, content: draft.content,
})
async function authorize(request: NextRequest, courseId: string) {
  if (!DRAFT_UUID.test(courseId)) return { response: jsonError('CourseNotFound', 'Khóa học không tồn tại.', 404) }
  const auth = await authenticate(request)
  if (!auth.ok) return { response: NextResponse.json({ error: auth.error }, { status: 401 }) }
  if (auth.context!.role !== 'ADMIN') return { response: jsonError('AccessDenied', 'Chỉ Admin được chỉnh sửa bản nháp.', 403) }
  return { userId: auth.context!.userId }
}

export async function GET(request: NextRequest, { params }: { params: { courseId: string } }) {
  const auth = await authorize(request, params.courseId)
  if (auth.response) return auth.response
  const course = await prisma.course.findUnique({ where: { id: params.courseId }, include: { ...courseDraftInclude, draft: true } })
  if (!course) return jsonError('CourseNotFound', 'Khóa học không tồn tại.', 404)
  let draftError: string | null = null
  const initialContent = courseDraftSnapshot(course)
  if (course.draft) {
    try { validateDraftContent(course.draft.content, initialContent) }
    catch (e) { if (!(e instanceof CourseDraftError)) throw e; draftError = e.message }
  }
  return NextResponse.json({
    draft: course.draft ? draftResponse(course.draft) : null,
    draftError,
    initialContent,
    course: { id: course.id, title: course.title, contentVersion: course.content_version, status: course.status },
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}

/** The course row serializes first-save, save, discard and publish, including the no-draft case. */
export async function PUT(request: NextRequest, { params }: { params: { courseId: string } }) {
  const auth = await authorize(request, params.courseId)
  if (auth.response) return auth.response
  const body = await request.json().catch(() => ({}))
  try {
    const draft = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM courses WHERE id = ${params.courseId}::uuid FOR UPDATE`
      const course = await tx.course.findUnique({ where: { id: params.courseId }, include: courseDraftInclude })
      if (!course) throw new CourseDraftError('CourseNotFound', 'Khóa học không tồn tại.', 404)
      if (course.status !== 'PUBLISHED') throw new CourseDraftError('CourseNotPublished', 'Khóa học chưa xuất bản. Hãy tải lại trình chỉnh sửa.', 409)
      const existing = await tx.courseDraft.findUnique({ where: { course_id: course.id } })
      assertDraftIdentity(body.expectedDraftId, existing?.id || null)
      assertDraftVersion(body.expectedDraftVersion, existing?.draft_version || 0, body.baseContentVersion, course.content_version)
      if (existing && existing.base_content_version !== course.content_version) throw new CourseDraftError('BaseVersionMismatch', 'Bản xuất bản đã đổi. Hãy tải lại và bỏ bản nháp cũ trước khi chỉnh sửa.', 409)
      const content = validateDraftContent(body.content, courseDraftSnapshot(course))
      return existing
        ? tx.courseDraft.update({ where: { id: existing.id }, data: { content: content as unknown as Prisma.InputJsonValue, draft_version: { increment: 1 } } })
        : tx.courseDraft.create({ data: { course_id: course.id, base_content_version: course.content_version, draft_version: 1, content: content as unknown as Prisma.InputJsonValue, created_by_user_id: auth.userId! } })
    })
    return NextResponse.json({ draft: draftResponse(draft) })
  } catch (e) { const response = conflict(e); if (response) return response; throw e }
}

export async function DELETE(request: NextRequest, { params }: { params: { courseId: string } }) {
  const auth = await authorize(request, params.courseId)
  if (auth.response) return auth.response
  const body = await request.json().catch(() => ({}))
  try {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM courses WHERE id = ${params.courseId}::uuid FOR UPDATE`
      const course = await tx.course.findUnique({ where: { id: params.courseId } })
      if (!course) throw new CourseDraftError('CourseNotFound', 'Khóa học không tồn tại.', 404)
      const draft = await tx.courseDraft.findUnique({ where: { course_id: course.id } })
      assertDraftIdentity(body.expectedDraftId, draft?.id || null)
      assertDraftVersion(body.expectedDraftVersion, draft?.draft_version || 0, body.baseContentVersion, course.content_version)
      if (draft) await tx.courseDraft.delete({ where: { id: draft.id } })
    })
    return NextResponse.json({ success: true })
  } catch (e) { const response = conflict(e); if (response) return response; throw e }
}
