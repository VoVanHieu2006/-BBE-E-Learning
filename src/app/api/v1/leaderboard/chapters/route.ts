import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPublishedSystemData, calculateBatchUsersProgress } from '@/lib/progress/calculator'

export const dynamic = 'force-dynamic'

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

  const sys = await getPublishedSystemData()

  // 1. Get chapters with active member user IDs
  const chapters = await prisma.chapter.findMany({
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
  })

  // 2. Batch calculate all members progress
  const allMemberUserIds = Array.from(
    new Set(chapters.flatMap((ch) => ch.chapter_members.map((cm) => cm.user_id)))
  )
  const progressMap = await calculateBatchUsersProgress(allMemberUserIds, sys)

  const results = chapters.map((ch) => {
    const memberUserIds = ch.chapter_members.map((cm) => cm.user_id)
    const memberCount = memberUserIds.length

    let totalPoints = 0
    let totalCompletedLessons = 0

    for (const userId of memberUserIds) {
      const p = progressMap.get(userId)
      const completed = p?.completedLessons || 0
      totalCompletedLessons += completed
      totalPoints += p?.leaderboardPoint || 0
    }

    const avgPoints = memberCount > 0 ? Math.round(totalPoints / memberCount) : 0

    return {
      chapterId: ch.id,
      id: ch.id,
      name: ch.name,
      description: ch.description,
      memberCount,
      totalCompletedLessons,
      totalLessons: sys.totalLessons,
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
