import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/v1/leaderboard
 * Global leaderboard — ranking active members by course completion % and quiz score
 */
export async function GET(request: NextRequest) {
  await authenticate(request).catch(() => null)

  const url = new URL(request.url)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10), 1), 100)
  const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10), 1)
  const skip = (page - 1) * limit

  // 1. Fetch total published lessons count ONCE
  const totalLessonsCount = await prisma.lesson.count({
    where: { session: { course: { status: 'PUBLISHED' } } },
  })
  const totalLessons = totalLessonsCount || 1

  // 2. Fetch ACTIVE members
  const members = await prisma.user.findMany({
    where: { status: 'ACTIVE', role: 'MEMBER' },
    include: {
      chapter_members: { include: { chapter: true } },
      lessonProgress: { where: { completed: true }, select: { lesson_id: true } },
      attempts: {
        where: { status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
        select: { score: true },
      },
    },
    take: limit,
    skip,
  })

  // 3. Compute score in memory (0ms)
  const results = members.map((m) => {
    const completedLessons = m.lessonProgress.length
    const courseProgress = Math.min(100, Math.round((completedLessons / totalLessons) * 100))

    let totalScore = 0
    let attemptCount = 0
    for (const attempt of m.attempts) {
      totalScore += Number(attempt.score || 0) * 100
      attemptCount++
    }
    const avgScore = attemptCount > 0 ? Math.round(totalScore / attemptCount) : 0

    // Leaderboard formula: 40% course progress + 60% quiz score
    const leaderboardPoint = Math.round(courseProgress * 0.4 + avgScore * 0.6)
    const chapterName = m.chapter_members[0]?.chapter?.name || 'BBE Core'

    return {
      userId: m.id,
      email: m.email,
      chapterName,
      courseCompletionPercent: courseProgress,
      assessmentAverageScore: avgScore,
      leaderboardPoint,
      completedLessons,
      totalLessons,
    }
  })

  results.sort((a, b) => b.leaderboardPoint - a.leaderboardPoint)

  return NextResponse.json({ items: results, page, limit })
}
