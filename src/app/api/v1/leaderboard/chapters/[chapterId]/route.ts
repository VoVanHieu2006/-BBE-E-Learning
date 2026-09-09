import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPublishedSystemData, calculateBatchUsersProgress } from '@/lib/progress/calculator'

/**
 * GET /api/v1/leaderboard/chapters/[chapterId]
 * Bảng xếp hạng thành viên trong một chapter — cùng công thức với /api/v1/leaderboard (global)
 */
export async function GET(request: NextRequest, { params }: { params: { chapterId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const userRole = (auth as any).context!.role
  const userId = (auth as any).context!.userId

  if (userRole === 'MEMBER' || userRole === 'CHAPTER_LEADER') {
    const membership = await prisma.chapterMember.findFirst({ where: { chapter_id: params.chapterId, user_id: userId } })
    if (!membership && userRole !== 'ADMIN') {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'Không có quyền truy cập chapter này' } }, { status: 403 })
    }
  }

  const members = await prisma.user.findMany({
    where: { status: 'ACTIVE', role: 'MEMBER', chapter_members: { some: { chapter_id: params.chapterId } } },
    include: {
      attempts: {
        where: { status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
        select: { score: true },
      },
    },
    take: 50,
  })

  const memberIds = members.map((m) => m.id)
  const sys = await getPublishedSystemData()
  const progressMap = await calculateBatchUsersProgress(memberIds, sys)

  const results = members.map((m) => {
    const p = progressMap.get(m.id)
    const completedLessons = p?.completedLessons || 0
    const courseProgress = p?.overallProgressPercent || 0
    const avgScore = p?.avgQuizScore || 0
    const leaderboardPoint = p?.leaderboardPoint || 0

    return {
      userId: m.id,
      email: m.email,
      completedLessons,
      totalLessons: sys.totalLessons,
      completedCourses: p?.completedCourses || 0,
      totalCourses: sys.totalCourses,
      courseProgress,
      avgScore,
      leaderboardPoint,
    }
  })

  results.sort((a, b) => b.leaderboardPoint - a.leaderboardPoint)
  return NextResponse.json({ chapterId: params.chapterId, items: results })
}
