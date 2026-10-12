import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getOrganizationUnitTreeIds, reconcileLearningAssignmentsForUser } from '@/lib/learning-assignments'

/** Applies scheduled Chapter department/LT changes atomically, then rebuilds learning paths. */
export async function applyDueChapterReorganizations(now = new Date()): Promise<number> {
  const due = await prisma.chapterReorganization.findMany({
    where: { status: 'SCHEDULED', effective_at: { lte: now } },
    include: { items: true },
    orderBy: { effective_at: 'asc' },
  })
  let applied = 0
  for (const batch of due) {
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.chapterReorganization.updateMany({
        where: { id: batch.id, status: 'SCHEDULED' }, data: { status: 'APPLIED', applied_at: now },
      })
      if (!claimed.count) return false
      const chapter = await tx.chapter.findUnique({ where: { id: batch.chapter_id }, select: { organization_unit_id: true } })
      if (!chapter?.organization_unit_id) throw new Error('ChapterOrganizationUnitNotFound')
      const unitIds = await getOrganizationUnitTreeIds(chapter.organization_unit_id)
      const userIds = batch.items.map((item) => item.user_id)
      await tx.organizationMembership.updateMany({
        where: { user_id: { in: userIds }, unit_id: { in: unitIds }, status: 'ACTIVE', ends_at: null },
        data: { status: 'ENDED', ends_at: now },
      })
      await tx.positionAssignment.updateMany({
        where: { user_id: { in: userIds }, unit_id: { in: unitIds }, ends_at: null }, data: { ends_at: now },
      })
      await tx.organizationMembership.createMany({ data: batch.items.map((item) => ({ user_id: item.user_id, unit_id: item.department_unit_id, starts_at: now })) })
      await tx.positionAssignment.createMany({ data: batch.items.filter((item) => item.position_id).map((item) => ({ user_id: item.user_id, unit_id: item.department_unit_id, position_id: item.position_id!, is_primary: item.is_primary, starts_at: now, appointed_by: batch.created_by_user_id })) })
      return true
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    if (result) {
      await Promise.all(batch.items.map((item) => reconcileLearningAssignmentsForUser(item.user_id)))
      applied++
    }
  }
  return applied
}
