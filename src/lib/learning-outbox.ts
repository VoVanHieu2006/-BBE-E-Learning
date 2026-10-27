import { prisma } from './prisma'
import { reconcileLearningAssignmentsForUser, syncCourseAssignmentCompletion } from './learning-assignments'

/** Row locks and SKIP LOCKED let several workers retry safely. Failed work stays durable. */
export async function processLearningOutbox(limit = 100) {
  let processed = 0, failed = 0
  for (let index = 0; index < limit; index++) {
    const result = await prisma.$transaction(async (tx) => {
      const [event] = await tx.$queryRaw<{ id: string; user_id: string; attempts: number }[]>`
        SELECT id, user_id, attempts FROM learning_outbox
        WHERE processed_at IS NULL AND available_at <= clock_timestamp()
        ORDER BY available_at, id FOR UPDATE SKIP LOCKED LIMIT 1`
      if (!event) return null
      // A savepoint keeps the event and retry state when a reconciliation statement fails.
      await tx.$executeRawUnsafe('SAVEPOINT learning_work')
      try {
        await reconcileLearningAssignmentsForUser(event.user_id, tx)
        const assignments = await tx.userLearningAssignment.findMany({ where: { user_id: event.user_id, ended_at: null }, select: { course_id: true }, distinct: ['course_id'] })
        for (const assignment of assignments) await syncCourseAssignmentCompletion(event.user_id, assignment.course_id, tx)
        await tx.learningOutbox.update({ where: { id: event.id }, data: { processed_at: new Date(), last_error: null, attempts: { increment: 1 } } })
        return true
      } catch (error) {
        await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT learning_work')
        await tx.learningOutbox.update({ where: { id: event.id }, data: {
          attempts: { increment: 1 }, last_error: error instanceof Error ? error.message.slice(0, 2000) : 'UnknownError',
          available_at: new Date(Date.now() + Math.min(3600, 2 ** Math.min(event.attempts + 1, 12)) * 1000),
        } })
        return false
      }
    }, { timeout: 30_000 })
    if (result === null) break
    if (result) processed++; else failed++
  }
  return { processed, failed }
}

/**
 * Instant read-through synchronization for a single learner.
 * Reconciliation owns its transaction so a slow assignment sync cannot close an
 * outer read transaction; pending events are marked done only after success.
 */
export async function reconcileLearnerReadThrough(userId: string): Promise<boolean> {
  const pending = await prisma.learningOutbox.findFirst({
    where: { user_id: userId, processed_at: null },
    select: { id: true },
  })
  if (!pending) return false

  try {
    // Run the reconciliation in its own transaction. Wrapping the whole
    // reconciliation in a short outer transaction caused Prisma to close the
    // transaction while assignment synchronization was still running.
    await reconcileLearningAssignmentsForUser(userId)
    await prisma.learningOutbox.updateMany({
      where: { user_id: userId, processed_at: null },
      data: { processed_at: new Date(), last_error: null, attempts: { increment: 1 } },
    })
    return true
  } catch (err) {
    console.error('Learner read-through error:', err)
    await prisma.learningOutbox.updateMany({
      where: { user_id: userId, processed_at: null },
      data: {
        attempts: { increment: 1 },
        last_error: err instanceof Error ? err.message.slice(0, 2000) : 'ReadThroughError',
      },
    }).catch(() => {})
    return false
  }
}

