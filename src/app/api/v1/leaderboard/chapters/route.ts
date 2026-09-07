import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface LeaderboardCache {
  data: any
  timestamp: number
}

let serverLeaderboardCache: LeaderboardCache | null = null
const LEADERBOARD_CACHE_TTL = 30000 // 30 seconds — leaderboard data rarely changes

/**
 * GET /api/v1/leaderboard/chapters
 * Chapter leaderboard — ranking all active chapters by member completion and score
 * 
 * Optimized: uses aggregate queries instead of loading all nested records,
 * plus 30s server-side cache.
 */
export async function GET(request: NextRequest) {
  await authenticate(request).catch(() => null)

  // Server-side cache
  const now = Date.now()
  if (serverLeaderboardCache && now - serverLeaderboardCache.timestamp < LEADERBOARD_CACHE_TTL) {
    return NextResponse.json(serverLeaderboardCache.data, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=15, stale-while-revalidate=60',
      },
    })
  }

  // Optimized: fetch chapters with member counts, then aggregate scores separately
  const [chapters, lessonCounts, scoreSums] = await Promise.all([
    // 1. Get chapters with active member user IDs
    prisma.chapter.findMany({
      where: { status: 'ACTIVE' },
      include: {
        chapter_members: {
          where: {
            user: { status: 'ACTIVE', role: 'MEMBER' },
          },
          select: {
            user_id: true,
          },
        },
      },
    }),
    // 2. Aggregate completed lessons per user (single query)
    prisma.lessonProgress.groupBy({
      by: ['user_id'],
      where: { completed: true },
      _count: { id: true },
    }),
    // 3. Aggregate attempt scores per user (single query)
    prisma.attempt.groupBy({
      by: ['user_id'],
      where: { status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
      _avg: { score: true },
    }),
  ])

  // Build lookup maps for O(1) access
  const lessonCountMap = new Map<string, number>()
  for (const lc of lessonCounts) {
    lessonCountMap.set(lc.user_id, lc._count.id)
  }

  const scoreMap = new Map<string, number>()
  for (const s of scoreSums) {
    scoreMap.set(s.user_id, Math.round(Number(s._avg.score || 0) * 100))
  }

  const results = chapters.map((ch) => {
    const memberUserIds = ch.chapter_members.map((cm) => cm.user_id)
    const memberCount = memberUserIds.length

    let totalPoints = 0
    let totalCompletedLessons = 0

    for (const userId of memberUserIds) {
      const completed = lessonCountMap.get(userId) || 0
      totalCompletedLessons += completed

      const avgScore = scoreMap.get(userId) || 0
      const point = Math.round(Math.min(100, completed * 10) * 0.4 + avgScore * 0.6)
      totalPoints += point
    }

    const avgPoints = memberCount > 0 ? Math.round(totalPoints / memberCount) : 0

    return {
      chapterId: ch.id,
      id: ch.id,
      name: ch.name,
      description: ch.description,
      memberCount,
      totalCompletedLessons,
      avgPoints,
      leaderboardPoint: avgPoints,
    }
  })

  results.sort((a, b) => b.avgPoints - a.avgPoints)

  const responseData = { items: results }
  serverLeaderboardCache = { data: responseData, timestamp: now }

  return NextResponse.json(responseData, {
    status: 200,
    headers: {
      'Cache-Control': 'private, max-age=15, stale-while-revalidate=60',
    },
  })
}
