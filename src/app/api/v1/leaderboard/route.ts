import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPublishedSystemData, calculateBatchUsersProgress } from '@/lib/progress/calculator'

/**
 * GET /api/v1/leaderboard
 * Global leaderboard — ranking active members by course completion % and quiz score
 *
 * FIX (POTENTIAL-01): Fetch ALL active members first, compute scores, sort globally,
 * THEN slice for pagination. Prevents top-scorer on DB page 2 from missing page 1.
 */
export async function GET(request: NextRequest) {
  await authenticate(request).catch(() => null)

  const url = new URL(request.url)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10), 1), 100)
  const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10), 1)
  const skip = (page - 1) * limit

  const sys = await getPublishedSystemData()

  // 1. Fetch ALL active members (no pagination here — sort must happen globally first)
  const allMembers = await prisma.user.findMany({
    where: { status: 'ACTIVE', role: 'MEMBER' },
    select: {
      id: true,
      email: true,
      chapter_members: {
        include: { chapter: true },
      },
    },
  })

  const memberUserIds = allMembers.map((m) => m.id)
  const progressMap = await calculateBatchUsersProgress(memberUserIds, sys)

  // 2. Format and compute leaderboard points for ALL members
  const allResults = allMembers.map((m) => {
    const p = progressMap.get(m.id)
    const completedLessons = p?.completedLessons || 0
    const totalLessons = sys.totalLessons
    const courseProgress = p?.overallProgressPercent || 0
    const avgScore = p?.avgQuizScore || 0
    const leaderboardPoint = p?.leaderboardPoint || 0
    const completedCourses = p?.completedCourses || 0
    const totalCourses = sys.totalCourses
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
      completedCourses,
      totalCourses,
    }
  })

  // 3. Sort globally by leaderboard points FIRST
  allResults.sort((a, b) => b.leaderboardPoint - a.leaderboardPoint)

  // 4. THEN paginate by slicing the globally-sorted array
  const totalCount = allResults.length
  const items = allResults.slice(skip, skip + limit)

  return NextResponse.json({ items, page, limit, totalCount })
}

