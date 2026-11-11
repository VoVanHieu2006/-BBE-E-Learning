import type { Prisma } from '@prisma/client'

type Placement = { user_id: string; department_unit_id: string | null; position_id: string | null; is_primary: boolean }

export function normalizeTransferPlacements<T extends { departmentUnitId?: string | null; positionId?: string | null }>(items: T[], presidentUnitIds: ReadonlySet<string>, presidentPositionId: string): T[] {
  return items.map(item => item.departmentUnitId && presidentUnitIds.has(item.departmentUnitId)
    ? { ...item, departmentUnitId: null, positionId: presidentPositionId } : item)
}

/** Caller owns the Chapter/user locks and transaction. Keep the Chapter affiliation. */
export async function replaceChapterPlacements(tx: Prisma.TransactionClient, chapterUnitId: string, departmentIds: string[], items: Placement[], now: Date, actorId: string) {
  const remaining = { OR: [{ ends_at: null }, { ends_at: { gt: now } }] }
  const memberships = await tx.organizationMembership.findMany({
    where: { unit_id: { in: departmentIds }, status: 'ACTIVE', ...remaining },
    select: { id: true, starts_at: true },
  })
  for (const row of memberships) await tx.organizationMembership.update({
    where: { id: row.id }, data: { status: 'ENDED', ends_at: row.starts_at > now ? row.starts_at : now },
  })
  const positions = await tx.positionAssignment.findMany({
    where: { unit_id: { in: [chapterUnitId, ...departmentIds] }, position: { code: { not: 'CHAPTER_LEAD' } }, ...remaining },
    select: { id: true, starts_at: true },
  })
  for (const row of positions) await tx.positionAssignment.update({
    where: { id: row.id }, data: { ends_at: row.starts_at > now ? row.starts_at : now },
  })
  const departmentItems = items.filter(item => item.department_unit_id)
  if (departmentItems.length) await tx.organizationMembership.createMany({ data: departmentItems.map(item => ({ user_id: item.user_id, unit_id: item.department_unit_id!, starts_at: now })) })
  const memberPosition = await tx.position.upsert({ where: { code: 'DEPARTMENT_MEMBER' }, update: {}, create: { code: 'DEPARTMENT_MEMBER', name: 'Thành viên ban', scope: 'DEPARTMENT' } })
  const positionedItems = items.filter(item => item.department_unit_id || item.position_id)
  if (positionedItems.length) await tx.positionAssignment.createMany({ data: positionedItems.map(item => ({ user_id: item.user_id, unit_id: item.department_unit_id || chapterUnitId, position_id: item.position_id || memberPosition.id, is_primary: item.is_primary, starts_at: now, appointed_by: actorId })) })
}
