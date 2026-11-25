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

/**
 * Khóa dòng Chapter chứa đơn vị: chính nó nếu là đơn vị CHAPTER, Chapter cha nếu là ban.
 * Mọi thao tác trên chức vụ "chỉ một người giữ" (Chủ tịch, Trưởng ban) và lời mời vào chức vụ đó
 * khóa Chapter trước tiên, trước bất kỳ người dùng hay lời mời nào, để hai lượt đồng thời chạy lần lượt.
 */
export async function lockUnitChapter(tx: Prisma.TransactionClient, unitId: string) {
  await tx.$queryRaw`SELECT c.id FROM chapters c JOIN organization_units u ON c.organization_unit_id = CASE WHEN u.type = 'CHAPTER' THEN u.id ELSE u.parent_id END WHERE u.id = ${unitId}::uuid FOR UPDATE OF c`
}

/**
 * Mỗi ban chỉ 1 Trưởng ban: mọi Trưởng ban khác (đang tại nhiệm hoặc đã lên lịch) của ban, trừ `keepUserId`,
 * xuống Thành viên của chính ban đó. Lịch sử chức vụ giữ nguyên (chỉ đóng ngày kết thúc qua replaceUserPosition),
 * phiên được làm mới quyền (auth_version tăng), lộ trình học được đồng bộ lại.
 * Caller sở hữu transaction. Khóa Chapter trước người dùng (cùng thứ tự với nhánh Chủ tịch của replaceUserPosition).
 * Trả danh sách userId đã bị hạ.
 */
export async function demoteOtherDepartmentLeads(tx: Prisma.TransactionClient, departmentUnitId: string, keepUserId: string, actorId?: string): Promise<string[]> {
  const unit = await tx.organizationUnit.findUniqueOrThrow({ where: { id: departmentUnitId } })
  if (unit.type !== 'DEPARTMENT') throw new OrganizationConflict('PositionScopeMismatch', 'Trưởng ban phải thuộc một ban.')
  await lockUnitChapter(tx, unit.id)
  const now = new Date()
  const incumbents = await tx.positionAssignment.findMany({
    where: { unit_id: unit.id, user_id: { not: keepUserId }, position: { code: 'DEPARTMENT_LEAD' }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
    select: { user_id: true }, orderBy: { user_id: 'asc' },
  })
  const userIds = Array.from(new Set(incumbents.map(row => row.user_id)))
  if (!userIds.length) return []
  const member = await tx.position.upsert({ where: { code: 'DEPARTMENT_MEMBER' }, update: {}, create: { code: 'DEPARTMENT_MEMBER', name: 'Thành viên ban', scope: 'DEPARTMENT' } })
  for (const userId of userIds) {
    await replaceUserPosition(tx, { userId, unitId: unit.id, positionId: member.id, actorId })
    await enqueueAssignmentSync(tx, userId, `department-lead-replaced:${unit.id}:${userId}:${now.toISOString()}`)
  }
  return userIds
}

/** Adding a learner to a leaf unit also supplies their one canonical position. */
export async function assignMembershipPosition(tx: Prisma.TransactionClient, userId: string, unitId: string, actorId?: string) {
  const unit = await tx.organizationUnit.findUniqueOrThrow({ where: { id: unitId } })
  if (!['DEPARTMENT', 'DNA_GROUP'].includes(unit.type)) throw new OrganizationConflict('MemberPositionRequired', 'Vui lòng chọn một ban hoặc nhóm DNA cho thành viên.')
  const code = unit.type === 'DEPARTMENT' ? 'DEPARTMENT_MEMBER' : 'DNA_MEMBER'
  const position = await tx.position.upsert({ where: { code }, update: {}, create: { code, name: code === 'DNA_MEMBER' ? 'Thành viên DNA' : 'Thành viên ban', scope: unit.type === 'DEPARTMENT' ? 'DEPARTMENT' : 'DNA' } })
  await replaceUserPosition(tx, { userId, unitId, positionId: position.id, actorId })
}

/**
 * Chức vụ cho người vừa kích hoạt lời mời thành viên. Không có position_code: như cũ (thành viên ban/DNA).
 * PRESIDENT trỏ vào đơn vị CHAPTER; replaceUserPosition tự kết thúc Chủ tịch cũ (thành thành viên chưa phân Ban).
 * DEPARTMENT_LEAD trỏ vào một ban; Trưởng ban cũ của ban xuống Thành viên ban (demoteOtherDepartmentLeads).
 */
export async function assignInvitedPosition(tx: Prisma.TransactionClient, userId: string, unitId: string, positionCode: string | null, actorId?: string) {
  if (!positionCode) return assignMembershipPosition(tx, userId, unitId, actorId)
  const unit = await tx.organizationUnit.findUniqueOrThrow({ where: { id: unitId } })
  if (positionCode === 'PRESIDENT') {
    if (unit.type !== 'CHAPTER') throw new OrganizationConflict('PositionScopeMismatch', 'Lời mời Chủ tịch phải trỏ vào đơn vị Chapter.')
    const position = await tx.position.upsert({ where: { code: 'PRESIDENT' }, update: {}, create: { code: 'PRESIDENT', name: 'Chủ tịch Chapter', scope: 'CHAPTER', is_manager: false } })
    return replaceUserPosition(tx, { userId, unitId, positionId: position.id, actorId })
  }
  if (positionCode === 'DEPARTMENT_LEAD') {
    if (unit.type !== 'DEPARTMENT') throw new OrganizationConflict('PositionScopeMismatch', 'Lời mời Trưởng ban phải trỏ vào một ban.')
    const position = await tx.position.upsert({ where: { code: 'DEPARTMENT_LEAD' }, update: {}, create: { code: 'DEPARTMENT_LEAD', name: 'Trưởng ban', scope: 'DEPARTMENT', is_manager: false } })
    await demoteOtherDepartmentLeads(tx, unit.id, userId, actorId)
    return replaceUserPosition(tx, { userId, unitId, positionId: position.id, actorId })
  }
  throw new OrganizationConflict('PositionRoleMismatch', 'Chức vụ trong lời mời không hợp lệ.')
}
