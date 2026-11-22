import type { AuthContext } from './auth'
import { prisma } from './prisma'
import { canAccessOrganizationUnitPermission, memberManagementPermission } from './authorization'

/** All invitation operations use the permission of the actual target unit. */
export async function canManageInvitationUnit(context: AuthContext, unitId: string) {
  if (context.role === 'ADMIN') return true
  const unit = await prisma.organizationUnit.findUnique({ where: { id: unitId }, select: { type: true, status: true } })
  if (!unit || unit.status !== 'ACTIVE' || !['CHAPTER', 'DEPARTMENT', 'DNA', 'DNA_GROUP'].includes(unit.type)) return false
  return canAccessOrganizationUnitPermission(context, unitId, memberManagementPermission(unit.type))
}

/** Whether the actor may manage (cancel, replace) an invitation: Admin always, others only through its target unit. */
export async function canManageInvitation(context: AuthContext, invitation: { chapter_id: string | null; organization_unit_id: string | null }) {
  if (context.role === 'ADMIN') return true
  let unitId = invitation.organization_unit_id
  if (!unitId && invitation.chapter_id) {
    unitId = (await prisma.chapter.findUnique({ where: { id: invitation.chapter_id }, select: { organization_unit_id: true } }))?.organization_unit_id ?? null
  }
  // A Lead invitation for a Chapter that does not exist yet has no unit: only Admin manages it.
  return unitId ? canManageInvitationUnit(context, unitId) : false
}
