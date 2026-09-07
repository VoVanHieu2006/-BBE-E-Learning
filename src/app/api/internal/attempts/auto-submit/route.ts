import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/internal/attempts/auto-submit
 * Auto-submit all expired IN_PROGRESS attempts.
 * Protected by CRON_SECRET or Admin Bearer token.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  const cronSecret = process.env.CRON_SECRET

  const isValidSecret = cronSecret && (
    authHeader === `Bearer ${cronSecret}` ||
    request.headers.get('x-cron-secret') === cronSecret
  )

  if (!isValidSecret && authHeader) {
    // Also allow Admin token
    const { authenticate } = await import('@/lib/auth')
    const auth = await authenticate(request)
    if (!auth.ok || (auth as any).context?.role !== 'ADMIN') {
      return NextResponse.json({ error: { code: 'Unauthorized', message: 'Unauthorized cron job' } }, { status: 401 })
    }
  } else if (!isValidSecret) {
    return NextResponse.json({ error: { code: 'Unauthorized', message: 'Unauthorized cron job' } }, { status: 401 })
  }

  // Find all IN_PROGRESS attempts that have expired
  const now = new Date()
  const expiredAttempts = await prisma.attempt.findMany({
    where: {
      status: 'IN_PROGRESS',
      expires_at: { lt: now },
    },
    include: {
      attempt_questions: {
        include: { question: true },
      },
      attempt_answers: {
        include: { selected_option: true, question: true },
      },
    },
  })

  const results = []

  for (const attempt of expiredAttempts) {
    let totalPoints = 0
    let earnedPoints = 0

    for (const aq of attempt.attempt_questions) {
      totalPoints += aq.question.points || 1
    }

    for (const ans of attempt.attempt_answers) {
      if (ans.selected_option?.is_correct) {
        earnedPoints += ans.question.points || 1
      }
    }

    const scoreRatio = totalPoints > 0 ? earnedPoints / totalPoints : 0
    const passed = scoreRatio >= 0.85

    const updated = await prisma.attempt.update({
      where: { id: attempt.id },
      data: {
        status: 'AUTO_SUBMITTED',
        submitted_at: now,
        score: scoreRatio,
        passed,
      },
    })

    results.push({
      attemptId: updated.id,
      userId: updated.user_id,
      score: Math.round(scoreRatio * 100),
      passed,
      status: 'AUTO_SUBMITTED',
    })
  }

  return NextResponse.json({
    processed: results.length,
    attempts: results,
  }, { status: 200 })
}
