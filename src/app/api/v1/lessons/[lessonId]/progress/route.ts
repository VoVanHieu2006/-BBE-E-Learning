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

  // recordVideoHeartbeat performs the authoritative progression gate inside
  // the same transaction. Avoid a duplicate, expensive gate query here.
  const body = await request.json().catch(() => ({}))
  if (body.viewSessionId !== undefined && (typeof body.viewSessionId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(body.viewSessionId))) {
    return NextResponse.json({ error: { code: 'InvalidViewSession' } }, { status: 400 })
  }
  const positionSeconds = Number(body.positionSeconds ?? body.currentPositionSeconds ?? body.position ?? 0)
  const furthestWatchedPositionSeconds = Number(body.furthestWatchedPositionSeconds ?? body.furthest ?? positionSeconds)
  const playbackRate = Number(body.playbackRate ?? body.playback_rate ?? 2)
  const event = body.event ?? body.playbackEvent
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0 || !Number.isFinite(furthestWatchedPositionSeconds)) {
    return NextResponse.json({ error: { code: 'InvalidVideoProgress', message: 'Tiến độ video không hợp lệ.' } }, { status: 400 })
  }
  if (!['PLAY', 'HEARTBEAT', 'PAUSE', 'ENDED'].includes(String(event || 'HEARTBEAT'))) {
    return NextResponse.json({ error: { code: 'InvalidVideoEvent' } }, { status: 400 })
  }

  // The legacy `completed` client flag is intentionally ignored. Completion is
  // derived only from server-validated watched content.
  const result = await recordVideoHeartbeat(
    userId,
    params.lessonId,
    positionSeconds,
    furthestWatchedPositionSeconds,
    isAdmin,
    body.viewSessionId || 'COMPAT',
    { playbackRate, event },
  )
  if (!result) return NextResponse.json({ error: { code: 'LessonNotFound' } }, { status: 404 })
  if ('error' in result) return NextResponse.json(result, { status: 403 })
  ;(globalThis as any).__bbeLearningMeCache?.delete(userId)
  return NextResponse.json(result)
}

export async function POST(request: NextRequest, context: { params: { lessonId: string } }) {
  return PATCH(request, context)
}

export async function GET(request: NextRequest, { params }: { params: { lessonId: string } }) {
  const auth = await authenticate(request).catch(() => ({ ok: false, error: { code: 'UNAUTHORIZED' } }))
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const userId = (auth as any).context!.userId

  const [cycle, progress, replay] = await Promise.all([
    prisma.learningCycle.findFirst({ where: { user_id: userId, ends_at: null }, select: { id: true } }),
    prisma.lessonProgress.findUnique({
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
    }),
    getVideoReplayState(userId, params.lessonId),
  ])

  const cycleProgress = cycle
    ? await prisma.cycleLessonProgress.findUnique({
        where: {
          user_id_lesson_id_learning_cycle_id: {
            user_id: userId,
            lesson_id: params.lessonId,
            learning_cycle_id: cycle.id,
          },
        },
        select: { completed_at: true, furthest_seconds: true },
      })
    : null

  const duration = progress?.lesson.video?.duration_seconds || 0
  const isLessonCompleted = cycle ? Boolean(cycleProgress?.completed_at) : Boolean(progress?.completed)
  const completedAt = cycle ? (cycleProgress?.completed_at || null) : (progress?.completed_at || null)
  const furthest = cycle ? (cycleProgress?.furthest_seconds || 0) : (progress?.furthest_watched_position_seconds || 0)
  const videoCompleted = hasWatchedFullVideo(Math.min(furthest, duration || Number.MAX_SAFE_INTEGER), duration)
  const progressPercentage = duration > 0 ? Math.min(100, Math.max(0, Math.round((furthest / duration) * 100))) : 0

  return NextResponse.json({
    lessonId: params.lessonId,
    replay,
    id: params.lessonId,
    completed: isLessonCompleted,
    lessonCompleted: isLessonCompleted,
    videoCompleted,
    watchedUntil: furthest,
    lastPosition: progress?.last_position_seconds || 0,
    lastPositionSeconds: progress?.last_position_seconds || 0,
    furthestWatchedPositionSeconds: furthest,
    durationSeconds: duration,
    progressPercentage,
    completedAt,
    updatedAt: progress?.updated_at || null,
  }, { status: 200 })
}
