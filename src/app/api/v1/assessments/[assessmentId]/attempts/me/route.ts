import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: { assessmentId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'MEMBER') return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })

  const attempts: any[] = await prisma.attempt.findMany({
    where: { assessment_id: params.assessmentId, user_id: (auth as any).context!.userId },
    orderBy: { started_at: 'desc' },
    select: { id: true, attempt_number: true, status: true, score: true, passed: true, submitted_at: true },
  })
  return NextResponse.json({
    items: attempts.map((a: any) => ({
      attemptId: a.id,
      attemptNumber: a.attempt_number,
      status: a.status,
      score: a.score ? Number(a.score) * 100 : null,
      passed: a.passed,
      submittedAt: a.submitted_at,
    })),
  })
}
