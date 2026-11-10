import { NextResponse } from 'next/server'
import { prisma } from './prisma'
import { invalidateCoursesServerCache, invalidateLessonDetailServerCache } from './server-cache'
import { invalidateSystemDataCache } from './progress/calculator'

/**
 * Khóa đã xuất bản chỉ được sửa nội dung qua bản nháp thay đổi + nút "Cập nhật khóa học" (KHBB 6.2).
 * Các route sửa trực tiếp trả 409 `CoursePublished`; khóa bản nháp (`DRAFT`) vẫn sửa trực tiếp như cũ.
 */
export const COURSE_PUBLISHED_ERROR = {
  error: {
    code: 'CoursePublished',
    message: 'Khóa học đã xuất bản. Hãy sửa trong bản nháp thay đổi rồi bấm "Cập nhật khóa học" (API: /api/v1/courses/{courseId}/draft).',
  },
} as const

export function courseEditBlock(status: string | null | undefined): { status: 409; body: typeof COURSE_PUBLISHED_ERROR } | null {
  return status === 'PUBLISHED' ? { status: 409, body: COURSE_PUBLISHED_ERROR } : null
}

const toResponse = (block: ReturnType<typeof courseEditBlock>) => (block ? NextResponse.json(block.body, { status: block.status }) : null)

/** Trả về response 409 nếu khóa đã xuất bản; `null` nếu được sửa trực tiếp (hoặc không tìm thấy, để route tự trả 404). */
export async function guardCourseEditable(courseId: string) {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { status: true } })
  return toResponse(courseEditBlock(course?.status))
}
export async function guardCourseEditableBySession(sessionId: string) {
  const row = await prisma.session.findUnique({ where: { id: sessionId }, select: { course: { select: { status: true } } } })
  return toResponse(courseEditBlock(row?.course?.status))
}
export async function guardCourseEditableByLesson(lessonId: string) {
  const row = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { session: { select: { course: { select: { status: true } } } } } })
  return toResponse(courseEditBlock(row?.session?.course?.status))
}
export async function guardCourseEditableByAssessment(assessmentId: string) {
  const row = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: { course: { select: { status: true } }, lesson: { select: { session: { select: { course: { select: { status: true } } } } } } },
  })
  return toResponse(courseEditBlock(row?.course?.status ?? row?.lesson?.session?.course?.status))
}
export async function guardCourseEditableByDocument(documentId: string) {
  const row = await prisma.document.findUnique({ where: { id: documentId }, select: { lesson: { select: { session: { select: { course: { select: { status: true } } } } } } } })
  return toResponse(courseEditBlock(row?.lesson?.session?.course?.status))
}

/** Mọi thao tác ghi nội dung phải làm mới cache chi tiết khóa, danh sách, dữ liệu hệ thống và chi tiết bài học. */
export function invalidateCourseContentCaches(courseId?: string, lessonId?: string) {
  invalidateCoursesServerCache(courseId)
  invalidateSystemDataCache()
  invalidateLessonDetailServerCache(lessonId)
}
