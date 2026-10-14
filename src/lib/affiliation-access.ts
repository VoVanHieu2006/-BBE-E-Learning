import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

type Db = Prisma.TransactionClient | typeof prisma

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
