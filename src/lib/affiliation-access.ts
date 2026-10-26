import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getParentChapterId } from './active-chapters'

type Db = Prisma.TransactionClient | typeof prisma

/** Current organization evidence takes precedence over the transitional Chapter index. */
export async function currentLearningAffiliation(userId: string, at = new Date()) {
  const [memberships, legacy, intervals] = await Promise.all([
    prisma.organizationMembership.findMany({ where: { user_id: userId, unit: { type: { in: ['CHAPTER', 'DEPARTMENT', 'DNA', 'DNA_GROUP'] } } }, include: { unit: { select: { type: true, status: true } } } }),
    prisma.chapterMember.findUnique({ where: { user_id: userId } }),
    prisma.chapterAffiliationInterval.findMany({ where: { user_id: userId } }),
  ])
  const effective = (row: { starts_at: Date; ends_at: Date | null }) => row.starts_at <= at && (!row.ends_at || row.ends_at > at)
  const current = memberships.filter(row => row.status === 'ACTIVE' && row.unit.status === 'ACTIVE' && effective(row))
  const dnaUnitIds = current.filter(row => ['DNA', 'DNA_GROUP'].includes(row.unit.type)).map(row => row.unit_id)
  if (dnaUnitIds.length) return { chapterId: null, dnaUnitIds }
  const chapterIds = Array.from(new Set((await Promise.all(current.map(row => getParentChapterId(row.unit_id)))).filter((id): id is string => Boolean(id))))
  if (chapterIds.length) return { chapterId: chapterIds.length === 1 ? chapterIds[0] : null, dnaUnitIds: [] }
  const validLegacy = legacy && legacy.joined_at <= at && !memberships.length &&
    (!intervals.length || intervals.some(row => row.chapter_id === legacy.chapter_id && effective(row)))
  return { chapterId: validLegacy ? legacy.chapter_id : null, dnaUnitIds: [] }
}

/**
 * Admin status is the global switch. Learners and managers may sign in while
 * at least one Chapter or DNA affiliation is active.
 */
export async function hasActiveAffiliation(userId: string, role: string, db: Db = prisma): Promise<boolean> {
  if (role === 'ADMIN') return true
  const now = new Date()
  const user = await db.user.findFirst({
    where: {
      id: userId,
      OR: [
        { organization_memberships: { some: { status: 'ACTIVE', starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] } } },
        { position_assignments: { some: { starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] } } },
        { chapter_members: { some: {} } },
      ],
    },
    select: { id: true },
  })
  return Boolean(user)
}

/** Active DNA membership grants the full learner capability set. */
export async function hasActiveDnaAffiliation(userId: string, db: Db = prisma): Promise<boolean> {
  const now = new Date()
  const memberships = await db.organizationMembership.findMany({
    where: { user_id: userId, status: 'ACTIVE', starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
    select: { unit: { select: { type: true, parent: { select: { type: true } } } } },
  })
  return memberships.some(({ unit }) => unit.type === 'DNA' || (unit.type === 'DNA_GROUP' && unit.parent?.type === 'DNA'))
}
