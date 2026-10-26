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

    // Check if member is already in target department with exact same lead status (idempotent noop)
    const currentDeptMembership = await tx.organizationMembership.findFirst({
      where: { user_id: input.userId, unit_id: { in: departmentIds }, status: 'ACTIVE', ends_at: null },
      select: { unit_id: true },
    })
    const currentLeadPos = await tx.positionAssignment.findFirst({
      where: {
        user_id: input.userId,
        position: { code: { in: ['DEPARTMENT_LEAD', 'CHAPTER_PRESIDENT'] } },
        ends_at: null,
      },
      select: { position: { select: { code: true } }, unit_id: true },
    })

    const targetUnitId = president ? chapter.organization_unit_id : input.departmentUnitId
    const currentUnitId = president ? (currentLeadPos?.position.code === 'CHAPTER_PRESIDENT' ? currentLeadPos.unit_id : null) : (currentDeptMembership?.unit_id || null)
    const isCurrentlyLead = Boolean(currentLeadPos && (president ? currentLeadPos.position.code === 'CHAPTER_PRESIDENT' : currentLeadPos.position.code === 'DEPARTMENT_LEAD'))
    const willBeLead = Boolean(president || input.makeLead)

    if (currentUnitId === targetUnitId && isCurrentlyLead === willBeLead) {
      return { departmentUnitId: input.departmentUnitId, isLead: willBeLead }
    }

    await tx.organizationMembership.updateMany({ where: { user_id: input.userId, unit_id: { in: departmentIds }, status: 'ACTIVE', ends_at: null }, data: { status: 'ENDED', ends_at: now } })
    await tx.positionAssignment.updateMany({ where: { user_id: input.userId, OR: [{ unit_id: { in: departmentIds } }, { unit_id: chapter.organization_unit_id, position: { code: 'CHAPTER_PRESIDENT' } }], ends_at: null }, data: { ends_at: now } })
    if (input.departmentUnitId) {
      if (!president) await tx.organizationMembership.create({ data: { user_id: input.userId, unit_id: input.departmentUnitId, starts_at: now } })
      if (president || input.makeLead) {
        const code = president ? 'CHAPTER_PRESIDENT' : 'DEPARTMENT_LEAD'
        const position = await tx.position.upsert({ where: { code }, update: {}, create: { code, name: president ? 'Chủ tịch Chapter' : 'LT Ban', scope: president ? 'CHAPTER' : 'DEPARTMENT', is_manager: !president } })
        const unitId = president ? chapter.organization_unit_id : input.departmentUnitId
        await tx.positionAssignment.updateMany({ where: { unit_id: unitId, position_id: position.id, ends_at: null }, data: { ends_at: now } })
        await tx.positionAssignment.create({ data: { user_id: input.userId, unit_id: unitId, position_id: position.id, is_primary: true, starts_at: now, appointed_by: input.actorId } })
      }
    }
    await reconcileLearningAssignmentsForUser(input.userId, tx)
    await tx.auditLog.create({ data: { actor_user_id: input.actorId, action: 'UPDATE_CHAPTER_DEPARTMENT', entity_type: 'USER', entity_id: input.userId, metadata: { chapterId: chapter.id, departmentUnitId: president ? null : input.departmentUnitId, president, isLead: president || input.makeLead, effectiveAt: now.toISOString() } } })
    return { departmentUnitId: input.departmentUnitId, isLead: president || input.makeLead }
  }, { timeout: 30_000 })
  invalidateOrganizationViews()
  return result
}
