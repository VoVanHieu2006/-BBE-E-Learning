import { Prisma } from '@prisma/client'

/**
 * Xuất bản / hủy xuất bản khóa (KHBB 6.3): mọi người từng có nghĩa vụ với khóa phải được tính lại
 * bộ khóa và hạn chung. Việc tính lại chạy qua `learning_outbox` giống `mandatory-matrix`.
 * Gọi trong cùng transaction với lúc đổi `courses.status`.
 */
export async function enqueueCourseStatusReconcile(
  tx: Prisma.TransactionClient,
  courseId: string,
  status: 'PUBLISHED' | 'DRAFT',
  now: Date,
): Promise<number> {
  const rows = await tx.userLearningAssignment.findMany({
    where: { course_id: courseId },
    select: { user_id: true },
    distinct: ['user_id'],
  })
  const data = rows.map((row) => ({
    event_key: `course-status:${courseId}:${status}:${now.toISOString()}:${row.user_id}`,
    kind: 'RECONCILE_ASSIGNMENTS' as const,
    user_id: row.user_id,
    payload: {},
  }))
  for (let index = 0; index < data.length; index += 1000) {
    await tx.learningOutbox.createMany({ data: data.slice(index, index + 1000), skipDuplicates: true })
  }
  return data.length
}
