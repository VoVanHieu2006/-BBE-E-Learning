import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/** Return one row per learner and course, without loading every completed lesson. */
export async function countCompletedLessonsByCourse(userIds: string[], courseIds: string[]) {
  if (!userIds.length || !courseIds.length) return []

  return prisma.$queryRaw<Array<{ user_id: string; course_id: string; completed_count: bigint }>>(
    Prisma.sql`
      SELECT lp.user_id, s.course_id, COUNT(*)::bigint AS completed_count
      FROM lesson_progress lp
      JOIN lessons l ON l.id = lp.lesson_id
      JOIN sessions s ON s.id = l.session_id
      WHERE lp.completed = true
        AND lp.user_id IN (${Prisma.join(userIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND s.course_id IN (${Prisma.join(courseIds.map((id) => Prisma.sql`${id}::uuid`))})
      GROUP BY lp.user_id, s.course_id
    `,
  )
}
