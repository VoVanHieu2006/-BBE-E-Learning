import type { Prisma, PrismaClient } from '@prisma/client'
import { LEAD_POSITION_CODES, deadlineLockExemption, type DeadlineLockExemption } from './account-restriction-rules'

/** Số assignment quá hạn đọc mỗi lượt. Mỗi người được xử lý trong try/catch riêng. */
export const ENFORCE_BATCH_SIZE = 100
const MAX_REPORTED_ERRORS = 20

export interface EnforceDeps {
  db: PrismaClient
  now: Date
  /** Admin chạy tay thì ghi lại người chạy; cron thì null. */
  actorId: string | null
  /** Đồng bộ trạng thái hoàn thành trước khi khóa (assignment có thể chậm hơn tiến độ thật). */
  syncCompletion: (userId: string, courseId: string) => Promise<unknown>
  invalidateAuth: (userId: string) => void
  batchSize?: number
}

/**
 * Khóa tài khoản quá hạn (KHBB 7.1). Không khóa: ADMIN, LEAD (role hoặc chức vụ), tài khoản INACTIVE,
 * và assignment của khóa không còn PUBLISHED. Những assignment đó không bị đổi sang OVERDUE.
 */
export async function enforceOverdueAssignments({ db, now, actorId, syncCompletion, invalidateAuth, batchSize = ENFORCE_BATCH_SIZE }: EnforceDeps) {
  const lockedUsers = new Set<string>()
  const completionChecked = new Set<string>()
  const leadPositionCache = new Map<string, string[]>()
  const skipped: Record<DeadlineLockExemption, number> = { ADMIN: 0, LEAD: 0, INACTIVE: 0 }
  const errors: { assignmentId: string; message: string }[] = []
  let evaluated = 0, processed = 0, unchanged = 0, failed = 0
  let lastId: string | undefined

  const activeLeadPositionCodes = async (userId: string) => {
    const cached = leadPositionCache.get(userId)
    if (cached) return cached
    const rows = await db.positionAssignment.findMany({
      where: {
        user_id: userId,
        starts_at: { lte: now },
        OR: [{ ends_at: null }, { ends_at: { gt: now } }],
        position: { code: { in: LEAD_POSITION_CODES } },
      },
      select: { position: { select: { code: true } } },
    })
    const codes = rows.map((row) => row.position.code)
    leadPositionCache.set(userId, codes)
    return codes
  }

  for (;;) {
    const batch = await db.userLearningAssignment.findMany({
      where: {
        mandatory: true,
        due_at: { lt: now },
        ended_at: null,
        status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
        course: { status: 'PUBLISHED' },
        ...(lastId ? { id: { gt: lastId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, user_id: true, course_id: true, course: { select: { title: true } }, user: { select: { role: true, status: true } } },
    })
    if (!batch.length) break
    lastId = batch[batch.length - 1].id

    for (const assignment of batch) {
      evaluated++
      try {
        const exemption = deadlineLockExemption(assignment.user, await activeLeadPositionCodes(assignment.user_id))
        if (exemption) { skipped[exemption]++; continue }

        const completionKey = `${assignment.user_id}:${assignment.course_id}`
        if (!completionChecked.has(completionKey)) {
          completionChecked.add(completionKey)
          // The assignment status can lag behind recently-completed progress. Sync
          // the video + lesson quiz + course-final requirements before enforcing.
          await syncCompletion(assignment.user_id, assignment.course_id)
        }
        const source = `learning-assignment:${assignment.id}`
        const outcome = await db.$transaction(async (tx: Prisma.TransactionClient) => {
          // A parallel learner completion may have finished this assignment after
          // the initial scan. Only the still-overdue transition may trigger a lock.
          const transitioned = await tx.userLearningAssignment.updateMany({
            where: {
              id: assignment.id,
              mandatory: true,
              due_at: { lt: now },
              ended_at: null,
              status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
              course: { status: 'PUBLISHED' },
            },
            data: { status: 'OVERDUE' },
          })
          if (!transitioned.count) return { transitioned: false, createdRestriction: false, newlyLocked: false }

          // Re-read the account inside the transaction: it may have been deactivated meanwhile.
          const target = await tx.user.findUnique({ where: { id: assignment.user_id }, select: { role: true, status: true } })
          if (!target || deadlineLockExemption(target, await activeLeadPositionCodes(assignment.user_id))) {
            return { transitioned: true, createdRestriction: false, newlyLocked: false }
          }

          // ACTIVE -> LOCKED only: an INACTIVE account stays INACTIVE, and an account locked for
          // another cause keeps its own lock_reason (the DEADLINE restriction below still records this one).
          const lock = await tx.user.updateMany({
            where: { id: assignment.user_id, role: { notIn: ['ADMIN', 'CHAPTER_LEADER'] }, status: 'ACTIVE' },
            data: { status: 'LOCKED', lock_reason: 'OVERDUE_LOCK', auth_version: { increment: 1 } },
          })

          const existing = await tx.accessRestriction.findFirst({ where: { user_id: assignment.user_id, source_reference: source, lifted_at: null }, select: { id: true } })
          if (!existing) {
            await tx.accessRestriction.create({
              data: {
                user_id: assignment.user_id,
                type: 'DEADLINE',
                reason: `Overdue required course: ${assignment.course.title}`,
                source_reference: source,
                created_by_user_id: actorId,
              },
            })
          }
          return { transitioned: true, createdRestriction: !existing, newlyLocked: lock.count > 0 }
        })
        if (outcome.transitioned) processed++; else unchanged++
        if (outcome.newlyLocked) lockedUsers.add(assignment.user_id)
        if (outcome.createdRestriction || outcome.newlyLocked) invalidateAuth(assignment.user_id)
      } catch (error) {
        // One learner's failure must not abort the whole run; the next run retries it.
        failed++
        if (errors.length < MAX_REPORTED_ERRORS) {
          errors.push({ assignmentId: assignment.id, message: error instanceof Error ? error.message.slice(0, 300) : 'UnknownError' })
        }
        console.error(`[deadline-enforce] assignment ${assignment.id} failed:`, error)
      }
    }
  }

  return {
    evaluated,
    processed,
    unchanged,
    skipped: { ...skipped, total: skipped.ADMIN + skipped.LEAD + skipped.INACTIVE },
    failed,
    errors,
    lockedUsers: Array.from(lockedUsers),
    adminAssignmentsSkipped: skipped.ADMIN,
  }
}
