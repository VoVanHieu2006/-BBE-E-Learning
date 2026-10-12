import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPublishedSystemData, calculateBatchUsersProgress } from '@/lib/progress/calculator'

interface CachedLeaderboard {
  timestamp: number
  allResults: any[]
}

let leaderboardCache: CachedLeaderboard | null = null
const LEADERBOARD_CACHE_TTL_MS = 30_000 // 30 seconds in-memory cache

/**
 * GET /api/v1/leaderboard
 * Global member standings — ranking active members by Star balance, with learning metrics as tie-breakers.
 *
 * OPTIMIZED (Audit #2):
 * In-memory server cache with 30s TTL. All requests within 30s return instantly
 * (<1ms, 0 DB queries) while correctly handling pagination (page/limit).
 */
export async function GET(request: NextRequest) {
  await authenticate(request).catch(() => null)

  const url = new URL(request.url)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10), 1), 100)
  const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10), 1)
  const skip = (page - 1) * limit

  let allResults: any[] = []
  const now = Date.now()

  if (leaderboardCache && now - leaderboardCache.timestamp < LEADERBOARD_CACHE_TTL_MS) {
    allResults = leaderboardCache.allResults
  } else {
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
    const [progressMap, starRows] = await Promise.all([
      calculateBatchUsersProgress(memberUserIds, sys),
      memberUserIds.length
        ? prisma.starLedger.groupBy({ where: { user_id: { in: memberUserIds } }, by: ['user_id'], _sum: { amount: true } })
        : Promise.resolve([]),
    ])
    const starsByUser = new Map(starRows.map((row) => [row.user_id, row._sum.amount || 0]))

    // 2. Format and compute leaderboard points for ALL members
    allResults = allMembers.map((m) => {
      const p = progressMap.get(m.id)
      const completedLessons = p?.completedLessons || 0
      const totalLessons = sys.totalLessons
      const courseProgress = p?.overallProgressPercent || 0
      const avgScore = p?.avgQuizScore || 0
      const completedCourses = p?.completedCourses || 0
      const totalCourses = sys.totalCourses
      const chapterName = m.chapter_members[0]?.chapter?.name || 'BBE Core'

      return {
        userId: m.id,
        email: m.email,
        chapterName,
        courseCompletionPercent: courseProgress,
        assessmentAverageScore: avgScore,
        avgScore,
        avgQuizScore: avgScore,
        stars: starsByUser.get(m.id) || 0,
        completedLessons,
        totalLessons,
        completedCourses,
        totalCourses,
      }
    })

    // 3. Sort by Star balance, then learning progress and quiz average.
    allResults.sort((a, b) => b.stars - a.stars || b.courseCompletionPercent - a.courseCompletionPercent || b.avgScore - a.avgScore)

    leaderboardCache = {
      timestamp: now,
      allResults,
    }
  }

  // 4. THEN paginate by slicing the globally-sorted array
  const totalCount = allResults.length
  const items = allResults.slice(skip, skip + limit)

  return NextResponse.json(
    { items, page, limit, totalCount },
    {
      headers: {
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=120',
      },
    }
  )
}
