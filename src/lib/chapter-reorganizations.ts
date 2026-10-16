import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { reconcileLearningAssignmentsForUser } from '@/lib/learning-assignments'

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
      // Department units under this chapter
      const deptUnits = await tx.organizationUnit.findMany({
        where: { parent_id: chapter.organization_unit_id, type: 'DEPARTMENT' },
        select: { id: true },
      })
      const deptUnitIds = deptUnits.map((u) => u.id)

      const renamedItems = batch.items.filter((item) => item.display_name)
      if (renamedItems.length) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE users AS target SET display_name = source.display_name
          FROM (VALUES ${Prisma.join(renamedItems.map((item) => Prisma.sql`(${item.user_id}::uuid, ${item.display_name}::text)`))})
            AS source(user_id, display_name)
          WHERE target.id = source.user_id
        `)
      }

      // Kết thúc toàn bộ ban và chức vụ cũ trong các Ban của Chapter
      // Thành viên không có tên trong sheet chuyển giao sẽ mất ban và chuyển về chưa phân ban
      if (deptUnitIds.length) {
        await tx.organizationMembership.updateMany({
          where: { unit_id: { in: deptUnitIds }, status: 'ACTIVE', ends_at: null },
          data: { status: 'ENDED', ends_at: now },
        })
        await tx.positionAssignment.updateMany({
          where: { unit_id: { in: deptUnitIds }, ends_at: null },
          data: { ends_at: now },
        })
      }
      await tx.organizationMembership.createMany({ data: batch.items.map((item) => ({ user_id: item.user_id, unit_id: item.department_unit_id, starts_at: now })) })
      await tx.positionAssignment.createMany({ data: batch.items.filter((item) => item.position_id).map((item) => ({ user_id: item.user_id, unit_id: item.department_unit_id, position_id: item.position_id!, is_primary: item.is_primary, starts_at: now, appointed_by: batch.created_by_user_id })) })
      return true
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 })
    if (result) {
      await Promise.all(batch.items.map((item) => reconcileLearningAssignmentsForUser(item.user_id)))
      applied++
    }
  }
  return applied
}
