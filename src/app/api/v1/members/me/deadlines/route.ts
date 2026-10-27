import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { reconcileLearnerReadThrough } from '@/lib/learning-outbox'

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const userId = auth.context!.userId
  await reconcileLearnerReadThrough(userId).catch(() => false)

  const [activeAssignments, allMandatoryAssignments] = await Promise.all([
    prisma.userLearningAssignment.findMany({
      where: {
        user_id: userId,
        mandatory: true,
        ended_at: null,
        status: { in: ['ASSIGNED', 'IN_PROGRESS', 'OVERDUE'] },
      },
      select: { course_id: true, due_at: true, status: true },
      orderBy: [{ due_at: 'asc' }, { assigned_at: 'asc' }],
    }),
    prisma.userLearningAssignment.findMany({
      where: {
        user_id: userId,
        mandatory: true,
        ended_at: null,
      },
      select: { course_id: true, status: true },
    }),
  ])

  // Find the active deadlines
  const dates = activeAssignments.map((a) => a.due_at).filter((d): d is Date => Boolean(d))
  const earliestDueAt = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null
  const latestDueAt = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null

  const totalMandatory = allMandatoryAssignments.length
  const completedMandatory = allMandatoryAssignments.filter((a) => a.status === 'COMPLETED').length

  return NextResponse.json({
    summary: {
      earliestDueAt: earliestDueAt?.toISOString() || null,
      latestDueAt: latestDueAt?.toISOString() || null,
      totalMandatoryCourses: totalMandatory,
      completedMandatoryCourses: completedMandatory,
    },
    items: activeAssignments.map((assignment) => ({
      courseId: assignment.course_id,
      dueAt: assignment.due_at?.toISOString() || null,
      status: assignment.status,
    })),
  })
}
