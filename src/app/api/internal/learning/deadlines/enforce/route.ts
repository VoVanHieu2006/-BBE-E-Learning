import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { invalidateUserAuthCache } from '@/lib/auth'
import { enforceOverdueAssignments } from '@/lib/deadline-enforcement'
import { syncCourseAssignmentCompletion } from '@/lib/learning-assignments'

/**
 * Schedule daily. Each overdue mandatory assignment creates a durable lock audit record.
 * Quy tắc khóa/không khóa nằm trong `src/lib/deadline-enforcement.ts` (KHBB 7.1).
 */
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

  const summary = await enforceOverdueAssignments({
    db: prisma,
    now: new Date(),
    actorId,
    syncCompletion: (userId, courseId) => syncCourseAssignmentCompletion(userId, courseId),
    invalidateAuth: invalidateUserAuthCache,
  })
  return NextResponse.json(summary)
}

// Vercel Cron invokes GET; POST remains available for an Admin/manual job runner.
export async function GET(request: NextRequest) {
  return enforceDeadlines(request)
}

export async function POST(request: NextRequest) {
  return enforceDeadlines(request)
}
