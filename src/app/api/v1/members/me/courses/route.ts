import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { calculateUserProgress } from '@/lib/progress/calculator'

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role === 'MEMBER') {
    // OK
  } else if ((auth as any).context!.role === 'CHAPTER_LEADER' || (auth as any).context!.role === 'ADMIN') {
    // Admin/Leader can also view their own — but this endpoint is specifically for member
  } else {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ thành viên có thể xem' } }, { status: 403 })
  }

  const url = new URL(request.url)
  const page = parseInt(url.searchParams.get('page') || '1', 10)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10), 1), 100)
  const skip = (page - 1) * limit

  // Get chapters of this member
  const memberships = await prisma.chapterMember.findMany({
    where: { user_id: (auth as any).context!.userId },
    include: { chapter: true },
  })
  const chapterIds = memberships.map((m) => m.chapter_id)

  // Find Published + Public / Private (if member of chapter with Active status) courses
  const userId = (auth as any).context!.userId
  const userSummary = await calculateUserProgress(userId)

  const allCourses = userSummary.courses || []
  const totalItems = allCourses.length
  const paginatedCourses = allCourses.slice(skip, skip + limit)

  const result = paginatedCourses.map((c) => ({
    courseId: c.courseId,
    id: c.courseId,
    title: c.title,
    progressPercentage: c.progressPercent,
    totalLessons: c.totalLessons,
    completedLessons: c.completedLessons,
    hasAssessment: c.hasAssessment,
    assessmentId: c.assessmentId,
    isCompleted: c.isCompleted,
    state: c.state,
    latestAttempt: c.latestAttempt ? {
      score: c.latestAttempt.score,
      passed: c.latestAttempt.passed,
      submittedAt: c.latestAttempt.submittedAt,
    } : null,
  }))

  return NextResponse.json({
    items: result,
    totalItems,
    totalPages: Math.ceil(totalItems / limit),
    summary: {
      completedLessons: userSummary.completedLessons,
      totalLessons: userSummary.totalLessons,
      overallProgressPercent: userSummary.overallProgressPercent,
      completedCourses: userSummary.completedCourses,
      totalCourses: userSummary.totalCourses,
      avgQuizScore: userSummary.avgQuizScore,
      leaderboardPoint: userSummary.leaderboardPoint,
    },
  })
}
