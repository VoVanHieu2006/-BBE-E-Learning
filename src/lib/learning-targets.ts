import { Prisma } from '@prisma/client'
import { LEARNING_TARGETS } from './learning-catalog'
import { isLearnerRole } from './roles'

export async function learningTargetsForUser(tx: Prisma.TransactionClient, userId: string, now: Date) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } })
  const codes = new Set<string>()
  if (!isLearnerRole(user?.role)) return codes
  const positions = await tx.positionAssignment.findMany({
    where: { user_id: userId, starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }], unit: { status: 'ACTIVE' } },
    include: { position: true, unit: true },
  })
  if (positions.length > 1) throw new Error('SinglePositionRequired')
  const current = positions[0]
  if (!current) return codes
  const code = current.position.code
  const target = code === 'PRESIDENT' && current.unit.type === 'CHAPTER' ? 'PRESIDENT'
    : ['DEPARTMENT_MEMBER', 'DEPARTMENT_LEAD'].includes(code) && current.unit.type === 'DEPARTMENT' ? code + '_' + current.unit.code
    : code === 'DNA_MEMBER' && current.unit.type === 'DNA_GROUP' ? 'DNA_MEMBER_' + current.unit.code : null
  if (target && LEARNING_TARGETS.some(row => row.code === target)) codes.add(target)
  return codes
}
