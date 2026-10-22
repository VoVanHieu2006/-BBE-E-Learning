import { Prisma } from '@prisma/client'
import { CourseBudget, budgetFingerprint, calculateSharedDeadline } from './learning-cycle-rules'

/** Caller holds the learning user lock and passes the complete new required set. */
export async function reconcileSharedPath(tx: Prisma.TransactionClient, userId: string, cycleId: string, now: Date) {
  const assignments = await tx.userLearningAssignment.findMany({ where: {
    user_id: userId, learning_cycle_id: cycleId, mandatory: true, ended_at: null,
  }, include: { course: { select: { mandatory_default_due_days: true } } } })
  const next: CourseBudget[] = assignments.map((row) => ({ courseId: row.course_id, days: row.course.mandatory_default_due_days, completed: Boolean(row.completed_at) }))
  const path = await tx.learningPath.upsert({ where: { learning_cycle_id: cycleId }, update: {}, create: {
    user_id: userId, learning_cycle_id: cycleId, starts_at: now,
  } })
  const fingerprint = budgetFingerprint(next)
  const previous = (path.budget as unknown as CourseBudget[]) || []
  let due = path.due_at
  if (path.budget_fingerprint !== fingerprint) {
    const reduced = next.some((course) => previous.some((old) => old.courseId === course.courseId && old.days > course.days))
    let reason: 'CYCLE_INITIALIZED' | 'ADMIN_BUDGET_SHORTENED' | 'MANDATORY_COURSE_ADDED' | 'MANDATORY_COURSE_REMOVED' = 'MANDATORY_COURSE_ADDED'
    if (!previous.length) {
      reason = 'CYCLE_INITIALIZED'
    } else if (reduced) {
      reason = 'ADMIN_BUDGET_SHORTENED'
    } else if (next.some((c) => !previous.some((p) => p.courseId === c.courseId))) {
      reason = 'MANDATORY_COURSE_ADDED'
    } else if (previous.some((p) => !next.some((c) => c.courseId === p.courseId))) {
      reason = 'MANDATORY_COURSE_REMOVED'
    }

    due = calculateSharedDeadline({
      startsAt: path.starts_at,
      changedAt: now,
      currentDueAt: path.due_at,
      previous,
      next,
      reason,
      budgetReduction: reduced,
    })
    // Imported deadlines are a floor for the transition import only.
    const priorChanges = await tx.learningPathChange.count({ where: { path_id: path.id } })
    if (priorChanges === 0 && path.imported_due_at && due) due = new Date(Math.max(due.getTime(), path.imported_due_at.getTime()))
    await tx.learningPath.update({ where: { id: path.id }, data: { budget_fingerprint: fingerprint, budget: next as unknown as Prisma.InputJsonValue, due_at: due } })
    await tx.learningPathChange.create({ data: { path_id: path.id, changed_at: now, previous_budget: path.budget, next_budget: next as unknown as Prisma.InputJsonValue, due_at: due, reason: reduced ? 'COURSE_BUDGET_REDUCED' : 'REQUIRED_SET_CHANGED' } })
  }
  await tx.userLearningAssignment.updateMany({ where: {
    user_id: userId, learning_cycle_id: cycleId, mandatory: true, ended_at: null, completed_at: null,
  }, data: { due_at: due } })
  return { ...path, due_at: next.length && next.some((course) => !course.completed) ? due : null }
}
