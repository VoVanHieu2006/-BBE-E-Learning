import { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { collectChapterAccountIds } from '@/lib/account-restriction-rules'

type RestrictionDb = Prisma.TransactionClient | typeof prisma

const activeAt = (now: Date) => ({
  starts_at: { lte: now },
  OR: [{ ends_at: null }, { ends_at: { gt: now } }],
})

async function getOrganizationSubtreeIds(rootUnitId: string, db: RestrictionDb): Promise<string[]> {
  const ids = new Set([rootUnitId])
  let frontier = [rootUnitId]
  while (frontier.length) {
    const children = await db.organizationUnit.findMany({
      where: { parent_id: { in: frontier }, id: { notIn: Array.from(ids) } },
      select: { id: true },
    })
    frontier = children.map((child) => child.id)
    frontier.forEach((id) => ids.add(id))
  }
  return Array.from(ids)
}

/** All current Chapter affiliates, including org-only members and position holders. */
export async function getChapterAccountUserIds(chapterId: string, db: RestrictionDb = prisma): Promise<string[]> {
  const chapter = await db.chapter.findUnique({
    where: { id: chapterId },
    select: { organization_unit_id: true, chapter_members: { select: { user_id: true } } },
  })
  if (!chapter) return []

  const now = new Date()
  const unitIds = chapter.organization_unit_id
    ? await getOrganizationSubtreeIds(chapter.organization_unit_id, db)
    : []
  const [memberships, assignments] = unitIds.length
    ? await Promise.all([
        db.organizationMembership.findMany({
          where: { unit_id: { in: unitIds }, status: 'ACTIVE', ...activeAt(now) },
          select: { user_id: true },
        }),
        db.positionAssignment.findMany({
          where: { unit_id: { in: unitIds }, ...activeAt(now) },
          select: { user_id: true },
        }),
      ])
    : [[], []]

  return collectChapterAccountIds(
    chapter.chapter_members.map((member) => member.user_id),
    memberships.map((membership) => membership.user_id),
    assignments.map((assignment) => assignment.user_id),
  )
}

/** Resolves legacy BĐHU and current Chapter-scoped managers by active position permission. */
export async function getUserManagedChapterScopes(
  userId: string,
  includeLegacyChapterRole: boolean,
  db: RestrictionDb = prisma,
): Promise<Array<{ chapterId: string; organizationUnitId: string | null }>> {
  const now = new Date()
  const [legacyChapters, assignments] = await Promise.all([
    includeLegacyChapterRole
      ? db.chapter.findMany({
          where: { chapter_members: { some: { user_id: userId } } },
          select: { id: true, organization_unit_id: true },
        })
      : Promise.resolve([]),
    db.positionAssignment.findMany({
      where: { user_id: userId, ...activeAt(now) },
      select: {
        position: { select: { scope: true, permissions: { select: { permission: { select: { code: true } } } } } },
        unit: { select: { id: true, type: true, chapter: { select: { id: true, organization_unit_id: true } } } },
      },
    }),
  ])

  const scopes = new Map<string, { chapterId: string; organizationUnitId: string | null }>()
  for (const chapter of legacyChapters) {
    scopes.set(chapter.id, { chapterId: chapter.id, organizationUnitId: chapter.organization_unit_id })
  }
  for (const assignment of assignments) {
    const managesChapter = assignment.position.scope === 'CHAPTER'
      && assignment.unit.type === 'CHAPTER'
      && assignment.position.permissions.some((grant) => grant.permission.code === 'MANAGE_CHAPTER_MEMBERS')
    const chapter = assignment.unit.chapter
    if (managesChapter && chapter) {
      scopes.set(chapter.id, { chapterId: chapter.id, organizationUnitId: chapter.organization_unit_id || assignment.unit.id })
    }
  }
  return Array.from(scopes.values())
}

/** Active direct or Chapter-cascade restrictions for each requested account. */
export async function getUsersWithActiveAccountRestrictions(
  userIds: string[],
  db: RestrictionDb = prisma,
): Promise<Set<string>> {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)))
  if (!uniqueIds.length) return new Set()
  const now = new Date()
  const [direct, memberships, assignments, legacyMemberships] = await Promise.all([
    db.accessRestriction.findMany({ where: { user_id: { in: uniqueIds }, lifted_at: null }, select: { user_id: true } }),
    db.organizationMembership.findMany({
      where: { user_id: { in: uniqueIds }, status: 'ACTIVE', ...activeAt(now) },
      select: { user_id: true, unit_id: true },
    }),
    db.positionAssignment.findMany({
      where: { user_id: { in: uniqueIds }, ...activeAt(now) },
      select: { user_id: true, unit_id: true },
    }),
    db.chapterMember.findMany({
      where: { user_id: { in: uniqueIds } },
      select: { user_id: true, chapter: { select: { organization_unit_id: true } } },
    }),
  ])

  const unitsByUser = new Map<string, Set<string>>(uniqueIds.map((userId) => [userId, new Set<string>()]))
  for (const row of memberships) unitsByUser.get(row.user_id)?.add(row.unit_id)
  for (const row of assignments) unitsByUser.get(row.user_id)?.add(row.unit_id)
  for (const row of legacyMemberships) {
    if (row.chapter.organization_unit_id) unitsByUser.get(row.user_id)?.add(row.chapter.organization_unit_id)
  }

  const allUnitIds = Array.from(new Set(Array.from(unitsByUser.values()).flatMap((ids) => Array.from(ids))))
  const result = new Set(direct.map((restriction) => restriction.user_id).filter((id): id is string => Boolean(id)))
  if (!allUnitIds.length) return result

  // Organization trees are small; load parent links once, then resolve each
  // user's complete active scope without N database round-trips.
  const units = await db.organizationUnit.findMany({ select: { id: true, parent_id: true } })
  const parentById = new Map(units.map((unit) => [unit.id, unit.parent_id]))
  const ancestorsByUser = new Map<string, Set<string>>()
  const allAncestorIds = new Set<string>()
  for (const userId of uniqueIds) {
    const ancestors = new Set<string>()
    for (const startingId of Array.from(unitsByUser.get(userId) || [])) {
      const visited = new Set<string>()
      let currentId: string | null = startingId
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId)
        ancestors.add(currentId)
        currentId = parentById.get(currentId) || null
      }
    }
    ancestorsByUser.set(userId, ancestors)
    ancestors.forEach((id) => allAncestorIds.add(id))
  }

  const cascadeRestrictions = await db.accessRestriction.findMany({
    where: {
      type: 'CHAPTER_CASCADE',
      lifted_at: null,
      organization_unit_id: { in: Array.from(allAncestorIds) },
    },
    select: { organization_unit_id: true },
  })
  const restrictedUnitIds = new Set(cascadeRestrictions.map((restriction) => restriction.organization_unit_id).filter((id): id is string => Boolean(id)))
  for (const userId of uniqueIds) {
    if (Array.from(ancestorsByUser.get(userId) || []).some((unitId) => restrictedUnitIds.has(unitId))) result.add(userId)
  }
  return result
}

export async function hasActiveAccountRestrictions(userId: string, db: RestrictionDb = prisma): Promise<boolean> {
  return (await getUsersWithActiveAccountRestrictions([userId], db)).has(userId)
}

/**
 * Persist both the Chapter-level cause and the exact accounts affected at lock
 * time. Target rows prevent password reset or membership changes from silently
 * erasing the reason an account was cascade-locked.
 */
export async function createChapterCascadeRestrictions(
  db: Prisma.TransactionClient,
  input: {
    organizationUnitId: string
    userIds: string[]
    reason: string
    createdByUserId: string
    sourceReference: string
  },
) {
  const rootSource = input.sourceReference.length <= 175
    ? input.sourceReference
    : `${input.sourceReference.slice(0, 140)}:${createHash('sha256').update(input.sourceReference).digest('hex').slice(0, 24)}`
  const targets = Array.from(new Set(input.userIds))
  const rootRef = rootSource
  const targetRefs = targets.map((userId) => `${rootSource}:user:${userId}`)
  const refs = [rootRef, ...targetRefs]
  const existing = await db.accessRestriction.findMany({
    where: { organization_unit_id: input.organizationUnitId, type: 'CHAPTER_CASCADE', source_reference: { in: refs }, lifted_at: null },
    select: { source_reference: true },
  })
  const existingRefs = new Set(existing.map((restriction) => restriction.source_reference).filter((ref): ref is string => Boolean(ref)))
  const rows: Prisma.AccessRestrictionCreateManyInput[] = []
  if (!existingRefs.has(rootRef)) {
    rows.push({
      organization_unit_id: input.organizationUnitId,
      type: 'CHAPTER_CASCADE',
      reason: input.reason,
      source_reference: rootRef,
      created_by_user_id: input.createdByUserId,
    })
  }
  targets.forEach((userId, index) => {
    if (!existingRefs.has(targetRefs[index])) {
      rows.push({
        user_id: userId,
        organization_unit_id: input.organizationUnitId,
        type: 'CHAPTER_CASCADE',
        reason: input.reason,
        source_reference: targetRefs[index],
        created_by_user_id: input.createdByUserId,
      })
    }
  })
  if (rows.length) await db.accessRestriction.createMany({ data: rows })
  return db.accessRestriction.findFirst({ where: { organization_unit_id: input.organizationUnitId, type: 'CHAPTER_CASCADE', source_reference: rootRef, lifted_at: null } })
}
