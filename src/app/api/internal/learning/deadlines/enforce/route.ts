import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { invalidateUserAuthCache } from '@/lib/auth'
import { canDeadlineLockAccount } from '@/lib/account-restriction-rules'
import { syncCourseAssignmentCompletion } from '@/lib/learning-assignments'

/** Schedule daily. Each overdue mandatory assignment creates a durable lock audit record. */
async function enforceDeadlines(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  const validCron = Boolean(process.env.CRON_SECRET) && (
    authHeader === `Bearer ${process.env.CRON_SECRET}` || request.headers.get('x-cron-secret') === process.env.CRON_SECRET
  )
  let actorId: string | null = null
  if (!validCron) {
    const { authenticate } = await import('@/lib/auth')
    const auth = await authenticate(request)
    if (!auth.ok || auth.context?.role !== 'ADMIN') return NextResponse.json({ error: { code: 'Unauthorized' } }, { status: 401 })
    actorId = auth.context.userId
  }

  const now = new Date()
  const overdue = await prisma.userLearningAssignment.findMany({
    where: { mandatory: true, due_at: { lt: now }, ended_at: null, status: { in: ['ASSIGNED', 'IN_PROGRESS'] } },
    select: { id: true, user_id: true, course_id: true, due_at: true, course: { select: { title: true } } },
  })
  const lockedUsers = new Set<string>()
  const completionChecked = new Set<string>()
  let adminAssignmentsSkipped = 0
  for (const assignment of overdue) {
    const completionKey = `${assignment.user_id}:${assignment.course_id}`
    if (!completionChecked.has(completionKey)) {
      completionChecked.add(completionKey)
      // The assignment status can lag behind recently-completed progress. Sync
      // the video + lesson quiz + course-final requirements before enforcing.
      await syncCourseAssignmentCompletion(assignment.user_id, assignment.course_id)
    }
    const source = `learning-assignment:${assignment.id}`
    const outcome = await prisma.$transaction(async (tx) => {
      // A parallel learner completion may have finished this assignment after
      // the initial scan. Only the still-overdue transition may trigger a lock.
      const transitioned = await tx.userLearningAssignment.updateMany({
        where: {
          id: assignment.id,
          mandatory: true,
          due_at: { lt: now },
          ended_at: null,
          status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
        },
        data: { status: 'OVERDUE' },
      })
      if (!transitioned.count) return { createdRestriction: false, newlyLocked: false, skippedAdmin: false }

      const target = await tx.user.findUnique({ where: { id: assignment.user_id }, select: { id: true, role: true } })
      if (!target || !canDeadlineLockAccount(target.role)) {
        // Keep the learning record accurate, but an automated deadline must
        // never lock an Admin account.
        return { createdRestriction: false, newlyLocked: false, skippedAdmin: target?.role === 'ADMIN' }
      }

      const lock = await tx.user.updateMany({
        where: { id: assignment.user_id, role: { not: 'ADMIN' }, status: { not: 'LOCKED' } },
        data: { status: 'LOCKED', auth_version: { increment: 1 } },
      })
      const currentTarget = await tx.user.findUnique({ where: { id: assignment.user_id }, select: { id: true, role: true } })
      if (!currentTarget || !canDeadlineLockAccount(currentTarget.role)) {
        return { createdRestriction: false, newlyLocked: lock.count > 0, skippedAdmin: currentTarget?.role === 'ADMIN' }
      }

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
      return { createdRestriction: !existing, newlyLocked: lock.count > 0, skippedAdmin: false }
    })
    if (outcome.skippedAdmin) adminAssignmentsSkipped++
    if (outcome.newlyLocked) lockedUsers.add(assignment.user_id)
    if (outcome.createdRestriction || outcome.newlyLocked) invalidateUserAuthCache(assignment.user_id)
  }
  return NextResponse.json({ evaluated: overdue.length, lockedUsers: Array.from(lockedUsers), adminAssignmentsSkipped })
}

// Vercel Cron invokes GET; POST remains available for an Admin/manual job runner.
export async function GET(request: NextRequest) {
  return enforceDeadlines(request)
}

export async function POST(request: NextRequest) {
  return enforceDeadlines(request)
}
