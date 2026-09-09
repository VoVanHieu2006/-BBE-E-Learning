import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { calculateUserProgress } from '@/lib/progress/calculator'

/**
 * GET /api/v1/chapters/[chapterId]/members/[userId]/course-progress
 * Chi tiết tiến độ theo từng khóa học của một thành viên (trang chi tiết của BĐHU)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { chapterId: string; userId: string } }
) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  let chapterId = params.chapterId

  // Support "me" alias for chapter leader
  if (chapterId === 'me') {
    if ((auth as any).context!.role === 'CHAPTER_LEADER' && (auth as any).context!.chapterId) {
      chapterId = (auth as any).context!.chapterId
    } else {
      return NextResponse.json({ error: { code: 'ValidationError', message: 'ChapterId không hợp lệ' } }, { status: 400 })
    }
  }

  // Authorization check
  if ((auth as any).context!.role === 'CHAPTER_LEADER') {
    if ((auth as any).context!.chapterId !== chapterId) {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'BĐHU chỉ có quyền xem chapter của mình' } }, { status: 403 })
    }
  } else if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Không có quyền' } }, { status: 403 })
  }

  const targetUserId = params.userId

  // Thành viên phải thuộc chapter này (cho phép cả INACTIVE để BĐHU vẫn xem được thành viên bị khóa)
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      email: true,
      status: true,
      role: true,
      created_at: true,
      chapter_members: { select: { chapter_id: true, joined_at: true } },
    },
  })

  if (!target || target.role !== 'MEMBER' || !target.chapter_members.some((cm) => cm.chapter_id === chapterId)) {
    return NextResponse.json({ error: { code: 'NotFound', message: 'Thành viên không thuộc chapter này' } }, { status: 404 })
  }

  const userSummary = await calculateUserProgress(targetUserId)
  const membership = target.chapter_members.find((cm) => cm.chapter_id === chapterId)

  return NextResponse.json(
    {
      user: {
        userId: target.id,
        email: target.email,
        status: target.status,
        joinedAt: membership?.joined_at || target.created_at,
        completedLessons: userSummary.completedLessons,
        totalLessons: userSummary.totalLessons,
        overallProgressPercent: userSummary.overallProgressPercent,
      },
      summary: {
        totalCourses: userSummary.totalCourses,
        completedCourses: userSummary.completedCourses,
        completedLessons: userSummary.completedLessons,
        totalLessons: userSummary.totalLessons,
        avgProgress: userSummary.overallProgressPercent,
        avgCourseProgress: userSummary.avgCourseProgressPercent,
        avgQuizScore: userSummary.avgQuizScore,
        leaderboardPoint: userSummary.leaderboardPoint,
      },
      courses: userSummary.courses || [],
    },
    { status: 200 }
  )
}
