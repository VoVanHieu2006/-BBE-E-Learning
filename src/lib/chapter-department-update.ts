import { replaceUserPosition } from './position-replacement'
import { prisma } from './prisma'
import { lockLearningUser } from './learning-periods'
import { reconcileLearningAssignmentsForUser } from './learning-assignments'
import { hasActiveDnaAffiliation } from './affiliation-access'
import { OrganizationConflict } from './chapter-lead'
import { invalidateOrganizationViews } from './organization-view-cache'
import { ensureChapterStandardDepartments } from './chapter-departments'

/** President is a Chapter position; seven departments remain independent units. */
export async function updateChapterDepartment(input: { chapterId: string; userId: string; departmentUnitId: string | null; makeLead: boolean; actorId: string }) {
  const result = await prisma.$transaction(async (tx) => {
    if (!input.departmentUnitId) throw new OrganizationConflict('MemberPositionRequired', 'Vui lòng chọn chức vụ và ban mới; đổi chức vụ là thay thế.')
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
    if (input.departmentUnitId) {
      const position = await tx.position.upsert({ where: { code }, update: {}, create: { code, name: president ? 'Chủ tịch Chapter' : input.makeLead ? 'Trưởng ban' : 'Thành viên ban', scope: president ? 'CHAPTER' : 'DEPARTMENT', is_manager: false } })
      await replaceUserPosition(tx, { userId: input.userId, unitId: president ? chapter.organization_unit_id : input.departmentUnitId, positionId: position.id, actorId: input.actorId })
    } else {
      await tx.organizationMembership.updateMany({ where: { user_id: input.userId, unit_id: { in: departmentIds }, status: 'ACTIVE', ends_at: null }, data: { status: 'ENDED', ends_at: now } })
      await tx.positionAssignment.updateMany({ where: { user_id: input.userId, position: { code: { in: ['PRESIDENT', 'DEPARTMENT_LEAD', 'DEPARTMENT_MEMBER'] } }, ends_at: null }, data: { ends_at: now } })
    }
    await reconcileLearningAssignmentsForUser(input.userId, tx)
    await tx.auditLog.create({ data: { actor_user_id: input.actorId, action: 'UPDATE_CHAPTER_DEPARTMENT', entity_type: 'USER', entity_id: input.userId, metadata: { chapterId: chapter.id, departmentUnitId: president ? null : input.departmentUnitId, president, isLead: president || input.makeLead, effectiveAt: now.toISOString() } } })
    return { departmentUnitId: input.departmentUnitId, isLead: president || input.makeLead }
  }, { timeout: 30_000 })
  invalidateOrganizationViews()
  return result
}
