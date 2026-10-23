import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPublishedSystemData, calculateBatchUsersProgress } from '@/lib/progress/calculator'
import { getActiveMetricChapterIds } from '@/lib/active-chapters'
import { getCachedMemberLeaderboard, setCachedMemberLeaderboard } from '@/lib/member-leaderboard-cache'
import { periodLeaderboard } from '@/lib/period-leaderboard'

/**
 * GET /api/v1/leaderboard
 * Global member standings — ranking active members by Star balance, with learning metrics as tie-breakers.
 *
 * OPTIMIZED (Audit #2):
 * In-memory server cache with 30s TTL. All requests within 30s return instantly
 * (<1ms, 0 DB queries) while correctly handling pagination (page/limit).
 */
export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.has('group')) return periodLeaderboard(request)
  await authenticate(request).catch(() => null)

  const url = new URL(request.url)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10), 1), 100)
  const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10), 1)
  const skip = (page - 1) * limit

  let allResults: any[] = []
  const now = Date.now()
  const cached = getCachedMemberLeaderboard(now)
  if (cached) {
    allResults = cached
  } else {
    const sys = await getPublishedSystemData()

    // 1. Fetch ALL active members (no pagination here — sort must happen globally first)
    const activeChapterIds = await getActiveMetricChapterIds(new Date())
    const allMembers = await prisma.user.findMany({
      where: { status: 'ACTIVE', role: 'MEMBER', OR: [
        { chapter_members: { some: { chapter_id: { in: activeChapterIds } } } },
        { organization_memberships: { some: { status: 'ACTIVE', OR: [
          { unit: { chapter: { id: { in: activeChapterIds } } } },
          { unit: { parent: { chapter: { id: { in: activeChapterIds } } } } },
        ] } } },
      ], position_assignments: { none: { position: { code: { in: ['DNA_LEAD', 'DNA_MANAGER', 'CHAPTER_LEAD', 'CHAPTER_MANAGER', 'TT', 'TRAINEE'] } }, starts_at: { lte: new Date() }, OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }] } } },
      select: {
        id: true,
        email: true,
        display_name: true,
        chapter_members: {
          include: { chapter: true },
        },
      },
    })

    const memberUserIds = allMembers.map((m) => m.id)
    const [progressMap, starRows] = await Promise.all([
      calculateBatchUsersProgress(memberUserIds, sys),
      memberUserIds.length
        ? prisma.starLedger.findMany({ where: { user_id: { in: memberUserIds } }, select: { user_id: true, amount: true, awarded_at: true } })
        : Promise.resolve([]),
    ])
    const starsByUser = new Map<string, number>()
    const achievedAtByUser = new Map<string, Date>()
    for (const row of starRows) {
      starsByUser.set(row.user_id, (starsByUser.get(row.user_id) || 0) + row.amount)
      if (row.amount > 0 && (!achievedAtByUser.has(row.user_id) || row.awarded_at > achievedAtByUser.get(row.user_id)!)) achievedAtByUser.set(row.user_id, row.awarded_at)
    }

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
        displayName: m.display_name,
        chapterName,
        courseCompletionPercent: courseProgress,
        assessmentAverageScore: avgScore,
        avgScore,
        avgQuizScore: avgScore,
        stars: starsByUser.get(m.id) || 0,
        starsAchievedAt: achievedAtByUser.get(m.id)?.toISOString() || null,
        completedLessons,
        totalLessons,
        completedCourses,
        totalCourses,
      }
    })

    // Equal Star balances are won by the member who reached that balance first.
    allResults.sort((a, b) => b.stars - a.stars || new Date(a.starsAchievedAt || 8640000000000000).getTime() - new Date(b.starsAchievedAt || 8640000000000000).getTime() || a.userId.localeCompare(b.userId))
    setCachedMemberLeaderboard(allResults, now)
  }

  // 4. THEN paginate by slicing the globally-sorted array
  const totalCount = allResults.length
  const items = allResults.slice(skip, skip + limit)

  return NextResponse.json(
    { items, page, limit, totalCount },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  )
}
