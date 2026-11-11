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
