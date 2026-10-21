import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/auth'
import { submitQuiz } from '@/lib/quiz-submission'

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const validSecret = Boolean(secret && (request.headers.get('authorization') === `Bearer ${secret}` || request.headers.get('x-cron-secret') === secret))
  if (!validSecret) {
    const auth = await authenticate(request)
    if (!auth.ok || auth.context?.role !== 'ADMIN') return NextResponse.json({ error: { code: 'Unauthorized' } }, { status: 401 })
  }
  const candidates = await prisma.attempt.findMany({ where: { status: 'IN_PROGRESS', expires_at: { lte: new Date() } }, select: { id: true }, take: 200 })
  const attempts = []
  for (const candidate of candidates) {
    const result = await submitQuiz({ attemptId: candidate.id, auto: true })
    if (!('error' in result) && !result.repeated) attempts.push({ attemptId: candidate.id, passed: result.grading.passed, score: Math.round(result.grading.scoreRatio * 100), status: 'AUTO_SUBMITTED' })
  }
  return NextResponse.json({ processed: attempts.length, attempts })
}
export const GET = POST
