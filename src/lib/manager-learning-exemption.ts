import { Prisma } from '@prisma/client'
import { hasActiveAccountRestrictions } from './account-restrictions'

/** Caller holds the user lock. Keep learning evidence and every non-deadline lock. */
export async function endManagerLearning(tx: Prisma.TransactionClient, userId: string, now: Date) {
  const pending = await tx.userLearningAssignment.updateMany({ where: { user_id: userId, ended_at: null, completed_at: null }, data: { mandatory: false, ended_at: now, status: 'ENDED', due_at: null } })
  const completed = await tx.userLearningAssignment.updateMany({ where: { user_id: userId, ended_at: null, completed_at: { not: null } }, data: { mandatory: false, ended_at: now, due_at: null } })
  await tx.supplementalLearningRequirement.updateMany({ where: { user_id: userId, ended_at: null }, data: { ended_at: now } })
  await tx.learningPath.updateMany({ where: { user_id: userId, learning_cycle: { ends_at: null } }, data: { due_at: null, imported_due_at: null, budget: [], budget_fingerprint: '' } })
  await tx.accessRestriction.updateMany({ where: { user_id: userId, type: 'DEADLINE', lifted_at: null }, data: { lifted_at: now } })
  if (!await hasActiveAccountRestrictions(userId, tx)) {
    await tx.user.updateMany({ where: { id: userId, status: 'LOCKED', lock_reason: { in: ['OVERDUE_LOCK', 'DEADLINE'] } }, data: { status: 'ACTIVE', lock_reason: null, auth_version: { increment: 1 } } })
  }
  return { created: 0, ended: pending.count + completed.count }
}
