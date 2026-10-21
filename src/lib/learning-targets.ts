import { Prisma } from '@prisma/client'

export async function learningTargetsForUser(tx: Prisma.TransactionClient, userId: string, now: Date) {
  const [memberships, positions] = await Promise.all([
    tx.organizationMembership.findMany({ where: { user_id: userId, status: 'ACTIVE', starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] }, include: { unit: true } }),
    tx.positionAssignment.findMany({ where: { user_id: userId, starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] }, include: { position: true } }),
  ])
  const codes = new Set<string>()
  for (const membership of memberships) {
    const unit = membership.unit
    if (unit.type === 'DEPARTMENT' && unit.code) {
      const lead = positions.some((position) => position.unit_id === unit.id && ['DEPARTMENT_LEAD', 'DEPARTMENT_LEADER'].includes(position.position.code))
      codes.add(`${lead ? 'LEADER' : 'MEMBER'}_${unit.code}`)
    }
    if (unit.type === 'DNA_GROUP' && unit.code) codes.add(`DNA_${unit.code}`)
  }
  if (positions.some((position) => position.position.code === 'CHAPTER_PRESIDENT')) codes.add('CHAPTER_PRESIDENT')
  return codes
}
