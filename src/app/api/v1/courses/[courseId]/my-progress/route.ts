import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readCourseLearningStates } from '@/lib/lesson-learning-state'
import { currentCycleAttemptFilter } from '@/lib/learning-periods'

export async function GET(request: NextRequest, { params }: { params: { courseId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const courseId = params.courseId
  const userId = (auth as any).context!.userId
  const role = (auth as any).context!.role

  const cycle = await prisma.learningCycle.findFirst({
    where: { user_id: userId, ends_at: null },
    select: { id: true },
  })
  const cycleFilter = await currentCycleAttemptFilter(prisma, userId)

  // Single streamlined query: fetch course status, sessions, lessons and user progress in 1 round-trip chain
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    relationLoadStrategy: 'join',
    select: {
      id: true,
      status: true,
      final_assessment: {
        select: {
          id: true,
          attempts: {
            where: { user_id: userId, ...cycleFilter, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
            orderBy: { created_at: 'desc' },
            take: 1,
            select: { id: true, passed: true, score: true },
          },
        },
      },
      sessions: {
        orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          title: true,
          sort_order: true,
          lessons: {
            orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              title: true,
              progress: {
                where: { user_id: userId },
                select: {
                  completed: true,
                  furthest_watched_position_seconds: true,
                  last_position_seconds: true,
                },
              },
            },
          },
        },
      },
    },
  })

  if (!course) {
    return NextResponse.json({ error: { code: 'CourseNotFound', message: 'Khóa học không tồn tại' } }, { status: 404 })
  }

  if (course.status !== 'PUBLISHED' && role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Khóa học chưa publish' } }, { status: 403 })
  }

  const learningStates = await readCourseLearningStates(prisma, userId, courseId)

  let totalLessons = 0
  let completedLessons = 0
  const sessions = course.sessions.map((s) => {
    return {
      sessionId: s.id,
      id: s.id,
      title: s.title,
      sortOrder: s.sort_order,
      lessons: s.lessons.map((l) => {
        totalLessons++
        const prog = l.progress && l.progress.length > 0 ? l.progress[0] : null
        const state = learningStates[l.id]
        const isCycleCompleted = state.lessonCompleted
        if (isCycleCompleted) completedLessons++
        return {
          lessonId: l.id,
          id: l.id,
          title: l.title,
          ...state,
          completed: isCycleCompleted,
          furthestWatchedPositionSeconds: state.furthestWatchedPositionSeconds,
          lastPositionSeconds: prog?.last_position_seconds || null,
        }
      }),
    }
  })

  const progressPercentage = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0
  const latestFinal = course.final_assessment?.attempts?.[0] || null

  return NextResponse.json(
    {
      courseId,
      learningCycleId: cycle?.id || null,
      id: courseId,
      progressPercentage,
      percentage: progressPercentage,
      totalLessons,
      completedLessons,
      finalAssessmentAttempt: latestFinal ? {
        passed: Boolean(latestFinal.passed),
        score: latestFinal.score !== null ? Number(latestFinal.score) : null,
      } : null,
      sessions,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  )
}
