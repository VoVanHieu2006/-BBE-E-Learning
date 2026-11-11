import { Prisma } from '@prisma/client'
import { lockLearningUser, enqueueAssignmentSync } from './learning-periods'
import { assertLeadAppointment, OrganizationConflict } from './chapter-lead'
import { canHoldPosition } from './roles'
import { prepareOrganizationTransition } from './organization-transition'

/** Preserve history; cancel a future row with a zero-length interval. */
export function replacementEnd(startsAt: Date, effectiveAt: Date) {
  return startsAt > effectiveAt ? startsAt : effectiveAt
}

/** Caller owns the transaction. Replace all current/future tenures, never append. */
export async function replaceUserPosition(tx: Prisma.TransactionClient, input: {
  userId: string; unitId: string; positionId: string; actorId?: string
  startsAt?: Date; endsAt?: Date | null; isPrimary?: boolean
}) {
  const position = await tx.position.findUniqueOrThrow({ where: { id: input.positionId } })
  const unit = await tx.organizationUnit.findUniqueOrThrow({ where: { id: input.unitId } })
  // Match transfer lock order: Chapter before any of its users. In particular,
  // reappointing the incumbent must not hold that user while waiting on Chapter.
  if (position.code === 'PRESIDENT') await tx.$queryRaw`SELECT id FROM chapters WHERE organization_unit_id = ${unit.id}::uuid FOR UPDATE`
  const now = await lockLearningUser(tx, input.userId)
  if (input.startsAt && input.startsAt > now) throw new OrganizationConflict('FutureAppointmentNotAllowed', 'Bổ nhiệm chỉ có hiệu lực ngay; không hỗ trợ lên lịch tương lai.')
  const at = now
  const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { role: true } })
  if (!canHoldPosition(user.role, position.code)) throw new OrganizationConflict('PositionRoleMismatch', 'Chức vụ không phù hợp vai trò; không đổi MEMBER thành LEAD.')
  const expectedType = position.code === 'DNA_MEMBER' ? 'DNA_GROUP' : position.scope
  if (unit.type !== expectedType || unit.status !== 'ACTIVE') throw new OrganizationConflict('PositionScopeMismatch', 'Chức vụ không phù hợp đơn vị đang hoạt động.')
  if (input.endsAt && input.endsAt <= at) throw new OrganizationConflict('InvalidPositionDates', 'Ngày kết thúc phải sau ngày bắt đầu.')
  await prepareOrganizationTransition(tx, input.userId, input.unitId, input.actorId)

  if (position.code === 'PRESIDENT') {
    const incumbents = await tx.positionAssignment.findMany({
      where: { unit_id: unit.id, user_id: { not: input.userId }, position: { code: 'PRESIDENT' }, OR: [{ ends_at: null }, { ends_at: { gt: at } }] },
      select: { id: true, user_id: true, starts_at: true }, orderBy: { user_id: 'asc' },
    })
    for (const userId of Array.from(new Set(incumbents.map(row => row.user_id)))) {
      await lockLearningUser(tx, userId)
      for (const row of incumbents.filter(row => row.user_id === userId)) await tx.positionAssignment.update({ where: { id: row.id }, data: { ends_at: replacementEnd(row.starts_at, at) } })
      await tx.user.update({ where: { id: userId }, data: { auth_version: { increment: 1 } } })
      await enqueueAssignmentSync(tx, userId, `president-replaced:${unit.id}:${userId}:${now.toISOString()}`)
    }
  }

  const previous = await tx.positionAssignment.findMany({ where: { user_id: input.userId, OR: [{ ends_at: null }, { ends_at: { gt: at } }] }, select: { id: true, starts_at: true } })
  for (const row of previous) await tx.positionAssignment.update({ where: { id: row.id }, data: { ends_at: replacementEnd(row.starts_at, at) } })
  await assertLeadAppointment(tx, input.userId, position.code, input.unitId, at, input.endsAt || null)

  // Parent memberships are affiliation indexes; only the selected leaf grants a position.
  const allowed = new Set([unit.id])
  let parentId = unit.parent_id
  while (parentId && !allowed.has(parentId)) {
    allowed.add(parentId)
    parentId = (await tx.organizationUnit.findUnique({ where: { id: parentId }, select: { parent_id: true } }))?.parent_id || null
  }
  const memberships = await tx.organizationMembership.findMany({ where: { user_id: input.userId, status: 'ACTIVE', OR: [{ ends_at: null }, { ends_at: { gt: at } }] }, select: { id: true, unit_id: true, starts_at: true, ends_at: true } })
  for (const row of memberships.filter(row => !allowed.has(row.unit_id) || row.starts_at > at)) {
    await tx.organizationMembership.update({ where: { id: row.id }, data: { ends_at: replacementEnd(row.starts_at, at), status: 'ENDED' } })
  }
  if (!memberships.some(row => row.unit_id === unit.id && row.starts_at <= at)) {
    await tx.organizationMembership.create({ data: { user_id: input.userId, unit_id: unit.id, starts_at: at, ends_at: input.endsAt || null } })
  }
  const assignment = await tx.positionAssignment.create({ data: { user_id: input.userId, position_id: position.id, unit_id: unit.id, starts_at: at, ends_at: input.endsAt || null, appointed_by: input.actorId, is_primary: input.isPrimary ?? true } })
  await tx.user.update({ where: { id: input.userId }, data: { auth_version: { increment: 1 } } })
  return assignment
}

/** Adding a learner to a leaf unit also supplies their one canonical position. */
export async function assignMembershipPosition(tx: Prisma.TransactionClient, userId: string, unitId: string, actorId?: string) {
  const unit = await tx.organizationUnit.findUniqueOrThrow({ where: { id: unitId } })
  if (!['DEPARTMENT', 'DNA_GROUP'].includes(unit.type)) throw new OrganizationConflict('MemberPositionRequired', 'Vui lòng chọn một ban hoặc nhóm DNA cho thành viên.')
  const code = unit.type === 'DEPARTMENT' ? 'DEPARTMENT_MEMBER' : 'DNA_MEMBER'
  const position = await tx.position.upsert({ where: { code }, update: {}, create: { code, name: code === 'DNA_MEMBER' ? 'Thành viên DNA' : 'Thành viên ban', scope: unit.type === 'DEPARTMENT' ? 'DEPARTMENT' : 'DNA' } })
  await replaceUserPosition(tx, { userId, unitId, positionId: position.id, actorId })
}
