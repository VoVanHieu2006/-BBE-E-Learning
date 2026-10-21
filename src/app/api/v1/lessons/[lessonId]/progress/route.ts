import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { recordVideoHeartbeat, getVideoReplayState } from '@/lib/video-heartbeat'
import { prisma } from '@/lib/prisma'
import { awardStars, canEarnStarsForCourse, starsForVideoDuration } from '@/lib/stars'
import { checkLessonProgression } from '@/lib/progression'
import { syncCourseAssignmentCompletion } from '@/lib/learning-assignments'
import { capVideoProgress, hasWatchedFullVideo } from '@/lib/video-progress-rules'
import { isLearningManager } from '@/lib/manager-learning-access'

/**
 * PATCH / POST /api/v1/lessons/[lessonId]/progress
 * Update learning progress (heartbeat from YouTube player).
 */
export async function PATCH(request: NextRequest, { params }: { params: { lessonId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const userId = (auth as any).context!.userId
  if (await isLearningManager(userId, auth.context!.role)) {
    return NextResponse.json({ error: { code: 'ManagementOnlyAccount', message: 'Tài khoản quản lý không ghi nhận tiến độ học tập.' } }, { status: 403 })
  }
  const isAdmin = (auth as any).context!.role === 'ADMIN'

  const gate = await checkLessonProgression(userId, params.lessonId, 'WATCH', isAdmin)
  if (gate.ok === false) return NextResponse.json({ error: { code: gate.code, message: gate.message } }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  if (body.viewSessionId !== undefined && (typeof body.viewSessionId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(body.viewSessionId))) return NextResponse.json({ error: { code: 'InvalidViewSession' } }, { status: 400 })
  const positionSeconds = body.positionSeconds ?? body.currentPositionSeconds ?? body.position ?? 0
  const furthestWatchedPositionSeconds = body.furthestWatchedPositionSeconds ?? body.furthest ?? positionSeconds

  const result = await recordVideoHeartbeat(userId, params.lessonId, Number(positionSeconds), Number(furthestWatchedPositionSeconds), isAdmin, body.viewSessionId)
  if (!result) return NextResponse.json({ error: { code: 'LessonNotFound' } }, { status: 404 })
  if ('error' in result) return NextResponse.json(result, { status: 403 })
  return NextResponse.json(result)
}

export async function POST(request: NextRequest, context: { params: { lessonId: string } }) {
  return PATCH(request, context)
}

export async function GET(request: NextRequest, { params }: { params: { lessonId: string } }) {
  const auth = await authenticate(request).catch(() => ({ ok: false, error: { code: 'UNAUTHORIZED' } }))
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const userId = (auth as any).context!.userId

  const progress = await prisma.lessonProgress.findUnique({
    where: { user_id_lesson_id: { user_id: userId, lesson_id: params.lessonId } },
    select: {
      lesson_id: true,
      completed: true,
      completed_at: true,
      furthest_watched_position_seconds: true,
      last_position_seconds: true,
      updated_at: true,
      lesson: {
        select: {
          video: { select: { duration_seconds: true } },
        },
      },
    },
  })
  const replay = await getVideoReplayState(userId, params.lessonId)

  if (!progress) {
    return NextResponse.json({
      lessonId: params.lessonId,
      replay,
      id: params.lessonId,
      completed: false,
      watchedUntil: 0,
      lastPosition: 0,
      lastPositionSeconds: 0,
      furthestWatchedPositionSeconds: 0,
      progressPercentage: 0,
      updatedAt: null,
    }, { status: 200 })
  }

  const duration = progress.lesson.video?.duration_seconds || 1
  const furthest = progress.furthest_watched_position_seconds || 0
  const progressPercentage = duration > 0 ? Math.min(100, Math.round((furthest / duration) * 100)) : 0

  return NextResponse.json({
    lessonId: progress.lesson_id,
    replay,
    id: progress.lesson_id,
    completed: progress.completed,
    watchedUntil: progress.furthest_watched_position_seconds || 0,
    lastPosition: progress.last_position_seconds || 0,
    lastPositionSeconds: progress.last_position_seconds || 0,
    furthestWatchedPositionSeconds: progress.furthest_watched_position_seconds || 0,
    progressPercentage,
    completedAt: progress.completed_at,
    updatedAt: progress.updated_at,
  }, { status: 200 })
}
