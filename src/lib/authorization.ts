import { prisma } from '@/lib/prisma'
import { hasPermissionInOrganizationScope, isLegacyChapterCompatibilityPermission } from '@/lib/authorization-rules'

type LegacyAuthContext = { userId: string; role: 'ADMIN' | 'CHAPTER_LEADER' | 'MEMBER'; chapterId?: string }

export interface ManagedOrganizationUnit {
  id: string
  name: string
  type: 'DNA' | 'CHAPTER' | 'DEPARTMENT'
  canManageMembers: boolean
  chapterId: string | null
}

/** Resolves the target unit and all ancestors, which are the only assignment scopes that can grant access downward. */
async function getOrganizationUnitAncestors(unitId: string): Promise<string[] | null> {
  const ancestors: string[] = []
  const visited = new Set<string>()
  let currentId: string | null = unitId
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const unit: { id: string; parent_id: string | null; status: string } | null = await prisma.organizationUnit.findUnique({
      where: { id: currentId },
      select: { id: true, parent_id: true, status: true },
    })
    if (!unit) return null
    if (unit.status !== 'ACTIVE') return null
    ancestors.push(unit.id)
    currentId = unit.parent_id
  }
  return visited.has(currentId || '') ? null : ancestors
}

async function getOwningChapterId(unitId: string): Promise<string | null> {
  const visited = new Set<string>()
  let currentId: string | null = unitId
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const unit = await prisma.organizationUnit.findUnique({
      where: { id: currentId },
      select: { type: true, parent_id: true, chapter: { select: { id: true } } },
    })
    if (!unit) return null
    if (unit.type === 'CHAPTER') return unit.chapter?.id || null
    currentId = unit.parent_id
  }
  return null
}

async function hasScopedUnitPermission(userId: string, ancestorIds: string[], permissionCode: string): Promise<boolean> {
  const now = new Date()
  const assignments = await prisma.positionAssignment.findMany({
    where: {
      user_id: userId,
      starts_at: { lte: now },
      OR: [{ ends_at: null }, { ends_at: { gt: now } }],
      unit_id: { in: ancestorIds },
      position: { permissions: { some: { permission: { code: permissionCode } } } },
    },
    select: { unit_id: true },
  })
  return hasPermissionInOrganizationScope(assignments.map((assignment) => assignment.unit_id), ancestorIds)
}

/** Permission follows the organization tree downward, never sideways or upward. */
export async function canAccessOrganizationUnitPermission(
  context: LegacyAuthContext,
  unitId: string,
  permissionCode: string,
): Promise<boolean> {
  if (context.role === 'ADMIN') return true

  const ancestorIds = await getOrganizationUnitAncestors(unitId)
  if (!ancestorIds) return false

  // Preserve only the two old Chapter permissions, and only within that Chapter tree.
  if (context.role === 'CHAPTER_LEADER' && context.chapterId && isLegacyChapterCompatibilityPermission(permissionCode)) {
    const chapter = await prisma.chapter.findUnique({ where: { id: context.chapterId }, select: { organization_unit_id: true } })
    if (chapter?.organization_unit_id && ancestorIds.includes(chapter.organization_unit_id)) return true
  }

  return hasScopedUnitPermission(context.userId, ancestorIds, permissionCode)
}

/** Lists only active unit scopes for which the caller currently has the requested permission. */
export async function listManagedOrganizationUnits(
  context: LegacyAuthContext,
  permissionCode = 'VIEW_MEMBER_PROGRESS',
): Promise<ManagedOrganizationUnit[]> {
  const units = context.role === 'ADMIN'
    ? await prisma.organizationUnit.findMany({
        where: { type: { in: ['DNA', 'CHAPTER', 'DEPARTMENT'] }, status: 'ACTIVE' },
        include: { chapter: { select: { id: true } } },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      })
    : await prisma.organizationUnit.findMany({
        where: {
          status: 'ACTIVE',
          type: { in: ['DNA', 'CHAPTER', 'DEPARTMENT'] },
        },
        include: { chapter: { select: { id: true } } },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      })

  const result = (await Promise.all(units.map(async (unit) => {
    const canView = context.role === 'ADMIN' || await canAccessOrganizationUnitPermission(context, unit.id, permissionCode)
    if (!canView) return null
    return {
      id: unit.id,
      name: unit.name,
      type: unit.type as ManagedOrganizationUnit['type'],
      chapterId: unit.chapter?.id || await getOwningChapterId(unit.id),
      canManageMembers: context.role === 'ADMIN' || await canAccessOrganizationUnitPermission(context, unit.id, 'MANAGE_CHAPTER_MEMBERS'),
    }
  }))).filter((unit): unit is NonNullable<typeof unit> => Boolean(unit))
  return result
}

/** RBAC permission checked through an active, scoped position assignment. */
export async function hasChapterPermission(userId: string, chapterId: string, permissionCode: string): Promise<boolean> {
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId }, select: { organization_unit_id: true } })
  if (!chapter?.organization_unit_id) return false
  const ancestorIds = await getOrganizationUnitAncestors(chapter.organization_unit_id)
  if (!ancestorIds) return false
  return hasScopedUnitPermission(userId, ancestorIds, permissionCode)
}

/**
 * Transitional policy: legacy BĐHU remains compatible, while new managers are
 * authorized by their active, scoped PositionAssignment + Permission.
 */
export async function canAccessChapterPermission(context: LegacyAuthContext, chapterId: string, permissionCode: string): Promise<boolean> {
  if (context.role === 'ADMIN') return true
  if (context.role === 'CHAPTER_LEADER' && context.chapterId === chapterId && isLegacyChapterCompatibilityPermission(permissionCode)) return true
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId }, select: { organization_unit_id: true } })
  if (!chapter?.organization_unit_id) return false
  return canAccessOrganizationUnitPermission(context, chapter.organization_unit_id, permissionCode)
}

/** Lists only real Chapters for which this caller has the requested permission. */
export async function listAccessibleChapterIds(context: LegacyAuthContext, permissionCode: string): Promise<string[]> {
  const chapters = await prisma.chapter.findMany({ select: { id: true }, orderBy: { id: 'asc' } })
  if (context.role === 'ADMIN') return chapters.map((chapter) => chapter.id)

  const checks = await Promise.all(chapters.map(async ({ id }) =>
    await canAccessChapterPermission(context, id, permissionCode) ? id : null,
  ))
  return checks.filter((id): id is string => Boolean(id))
}

/** Resolve /chapters/me only when the caller has one unambiguous Chapter scope. */
export async function resolveSingleManagedChapter(context: LegacyAuthContext): Promise<string | null> {
  if (context.role === 'CHAPTER_LEADER' && context.chapterId) return context.chapterId
  if (context.role === 'ADMIN') return null
  const scopedIds = await listAccessibleChapterIds(context, 'VIEW_MEMBER_PROGRESS')
  return scopedIds.length === 1 ? scopedIds[0] : null
}
