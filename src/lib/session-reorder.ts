import type { Prisma } from '@prisma/client'
import { lockCourseExamBank } from './final-exam-bank'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export type SessionOrder = { sessionId: string; sortOrder: number }
export function validSessionOrder(value: unknown): value is SessionOrder[] {
  if (!Array.isArray(value) || !value.length || value.length > 1000) return false
  return value.every(row => row && typeof row.sessionId === 'string' && UUID.test(row.sessionId) && Number.isInteger(row.sortOrder) && row.sortOrder >= 0 && row.sortOrder <= 2147483647)
    && new Set(value.map(row => row.sessionId.toLowerCase())).size === value.length
    && new Set(value.map(row => row.sortOrder)).size === value.length
}

export async function reorderCourseSessions(tx: Prisma.TransactionClient, courseId: string, sessions: SessionOrder[]) {
  await lockCourseExamBank(tx, courseId)
  const course = await tx.course.findUnique({ where: { id: courseId }, select: { status: true } })
  if (!course) return { status: 404, code: 'CourseNotFound', message: 'Khóa học không tồn tại.' }
  if (course.status === 'PUBLISHED') return { status: 409, code: 'CoursePublished', message: 'Khóa học đã xuất bản. Hãy sắp xếp trong bản nháp thay đổi.' }
  const ids = sessions.map(row => row.sessionId)
  const rows = await tx.session.findMany({ where: { course_id: courseId, id: { in: ids } }, select: { id: true } })
  if (rows.length !== ids.length) return { status: 400, code: 'SessionCourseMismatch', message: 'Danh sách chứa buổi học không thuộc khóa học này hoặc không tồn tại.' }
  for (const row of sessions) await tx.session.update({ where: { id: row.sessionId, course_id: courseId }, data: { sort_order: row.sortOrder } })
  return null
}
