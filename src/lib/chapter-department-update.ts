import type { Prisma } from '@prisma/client'
import { demoteOtherDepartmentLeads, replaceUserPosition } from './position-replacement'
import { getSingleHolderSituation } from './president-invite'
import { cancelOtherSingleHolderInvitations } from './invitations'
import { DEPARTMENT_LEAD_APPOINT_CONFIRM_CODE, departmentLeadAppointmentWarning } from './department-lead-appointment'
import { prisma } from './prisma'
import { lockLearningUser } from './learning-periods'
import { reconcileLearningAssignmentsForUser } from './learning-assignments'
import { hasActiveDnaAffiliation } from './affiliation-access'
import { OrganizationConflict } from './chapter-lead'
import { invalidateOrganizationViews } from './organization-view-cache'
import { ensureChapterStandardDepartments } from './chapter-departments'

/**
 * Mỗi ban chỉ 1 Trưởng ban (bổ nhiệm tức thì). Gọi trong transaction đã khóa Chapter, trước replaceUserPosition của người mới.
 * - Bổ nhiệm lại chính Trưởng ban hiện tại: không hỏi, không hủy lời mời nào.
 * - Ban đang có Trưởng ban khác hoặc lời mời Trưởng ban chờ: 409 DepartmentLeadReplaceConfirmRequired cho tới khi `confirmReplace === true`.
 * - Đã xác nhận: hủy lời mời Trưởng ban chờ của ban (như ticket 01 khi gửi/kích hoạt lời mời) rồi hạ Trưởng ban khác xuống Thành viên ban.
 * Trả userId các Trưởng ban đã bị hạ.
 */
async function enforceSingleDepartmentLead(tx: Prisma.TransactionClient, input: { departmentUnitId: string; userId: string; actorId: string; confirmReplace?: boolean }) {
  const situation = await getSingleHolderSituation(input.departmentUnitId, 'DEPARTMENT_LEAD', undefined, tx)
  if (situation.currentHolder?.userId !== input.userId) {
    const appointee = await tx.user.findUniqueOrThrow({ where: { id: input.userId }, select: { display_name: true, email: true } })
    const warning = departmentLeadAppointmentWarning(situation, { userId: input.userId, name: appointee.display_name || appointee.email })
    if (warning && input.confirmReplace !== true) throw new OrganizationConflict(DEPARTMENT_LEAD_APPOINT_CONFIRM_CODE, warning)
    await cancelOtherSingleHolderInvitations(tx, input.departmentUnitId, 'DEPARTMENT_LEAD', {})
  }
  return demoteOtherDepartmentLeads(tx, input.departmentUnitId, input.userId, input.actorId)
}

/** President is a Chapter position; seven departments remain independent units. */
export async function updateChapterDepartment(input: { chapterId: string; userId: string; departmentUnitId: string | null; makeLead: boolean; actorId: string; confirmReplace?: boolean }) {
  const result = await prisma.$transaction(async (tx) => {
    // Clearing the department is allowed: the member stays in the Chapter with no department position (KHBB 2.3).
    // President replacement and transfers must acquire this scope before user locks.
    await tx.$queryRaw`SELECT id FROM chapters WHERE id = ${input.chapterId}::uuid FOR UPDATE`
    const now = await lockLearningUser(tx, input.userId)
    if (await hasActiveDnaAffiliation(input.userId, tx)) throw new OrganizationConflict('DnaMembershipConflict', 'Thành viên đang thuộc DNA; không thể thêm lại vào Ban của Chapter.')
    const member = await tx.chapterMember.findUnique({ where: { user_id: input.userId } })
    const chapter = await tx.chapter.findUniqueOrThrow({ where: { id: input.chapterId } })
    if (member?.chapter_id !== chapter.id || !chapter.organization_unit_id) throw new Error('MemberNotInChapter')
    await ensureChapterStandardDepartments(chapter.organization_unit_id, tx)
    const departments = await tx.organizationUnit.findMany({ where: { parent_id: chapter.organization_unit_id, type: 'DEPARTMENT' }, select: { id: true, name: true } })
    const target = departments.find((row) => row.id === input.departmentUnitId)
    const president = input.departmentUnitId === chapter.organization_unit_id || target?.name.toLocaleLowerCase('vi') === 'chủ tịch'
    if (input.departmentUnitId && !target && !president) throw new Error('InvalidDepartment')
    const departmentIds = departments.map((row) => row.id)

    const code = president ? 'PRESIDENT' : input.makeLead ? 'DEPARTMENT_LEAD' : 'DEPARTMENT_MEMBER'
    let demotedLeadUserIds: string[] = []
    if (input.departmentUnitId) {
      if (code === 'DEPARTMENT_LEAD') demotedLeadUserIds = await enforceSingleDepartmentLead(tx, { departmentUnitId: input.departmentUnitId, userId: input.userId, actorId: input.actorId, confirmReplace: input.confirmReplace })
      const position = await tx.position.upsert({ where: { code }, update: {}, create: { code, name: president ? 'Chủ tịch Chapter' : input.makeLead ? 'Trưởng ban' : 'Thành viên ban', scope: president ? 'CHAPTER' : 'DEPARTMENT', is_manager: false } })
      await replaceUserPosition(tx, { userId: input.userId, unitId: president ? chapter.organization_unit_id : input.departmentUnitId, positionId: position.id, actorId: input.actorId })
    } else {
      await tx.organizationMembership.updateMany({ where: { user_id: input.userId, unit_id: { in: departmentIds }, status: 'ACTIVE', ends_at: null }, data: { status: 'ENDED', ends_at: now } })
      await tx.positionAssignment.updateMany({ where: { user_id: input.userId, position: { code: { in: ['PRESIDENT', 'DEPARTMENT_LEAD', 'DEPARTMENT_MEMBER'] } }, ends_at: null }, data: { ends_at: now } })
    }
    await reconcileLearningAssignmentsForUser(input.userId, tx)
    await tx.auditLog.create({ data: { actor_user_id: input.actorId, action: 'UPDATE_CHAPTER_DEPARTMENT', entity_type: 'USER', entity_id: input.userId, metadata: { chapterId: chapter.id, departmentUnitId: president ? null : input.departmentUnitId, president, isLead: president || input.makeLead, demotedLeadUserIds, effectiveAt: now.toISOString() } } })
    return { departmentUnitId: input.departmentUnitId, isLead: president || input.makeLead, demotedLeadUserIds }
  }, { timeout: 30_000 })
  invalidateOrganizationViews()
  return result
}
