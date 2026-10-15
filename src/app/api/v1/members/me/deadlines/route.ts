import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const assignments = await prisma.userLearningAssignment.findMany({
    where: {
      user_id: auth.context!.userId,
      mandatory: true,
      ended_at: null,
      status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
    },
    select: { course_id: true, due_at: true, status: true },
    orderBy: [{ due_at: 'asc' }, { assigned_at: 'asc' }],
  })

  return NextResponse.json({
    items: assignments.map((assignment) => ({
      courseId: assignment.course_id,
      dueAt: assignment.due_at?.toISOString() || null,
      status: assignment.status,
    })),
  })
}
