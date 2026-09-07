import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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

  const [totalLessonsCount, completedGroups] = await Promise.all([
    prisma.lesson.count({ where: { session: { course: { status: 'PUBLISHED' } } } }),
    prisma.lessonProgress.groupBy({
      by: ['user_id'],
      where: { user_id: { in: memberIds }, completed: true },
      _count: { _all: true },
    }),
  ])

  const totalLessons = totalLessonsCount || 1
  const completedMap = new Map(completedGroups.map((g) => [g.user_id, g._count._all]))

  // Cùng công thức với global: 40% tiến độ khóa học + 60% điểm quiz trung bình
  const results = members.map((m) => {
    const completedLessons = completedMap.get(m.id) || 0
    const courseProgress = Math.min(100, Math.round((completedLessons / totalLessons) * 100))

    let totalScore = 0
    let attemptCount = 0
    for (const attempt of m.attempts) {
      totalScore += Number(attempt.score || 0) * 100
      attemptCount++
    }
    const avgScore = attemptCount > 0 ? Math.round(totalScore / attemptCount) : 0

    const leaderboardPoint = Math.round(courseProgress * 0.4 + avgScore * 0.6)

    return {
      userId: m.id,
      email: m.email,
      completedLessons,
      courseProgress,
      avgScore,
      leaderboardPoint,
    }
  })

  results.sort((a, b) => b.leaderboardPoint - a.leaderboardPoint)
  return NextResponse.json({ chapterId: params.chapterId, items: results })
}
