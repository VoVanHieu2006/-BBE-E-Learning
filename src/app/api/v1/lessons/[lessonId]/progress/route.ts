import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
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
  const positionSeconds = body.positionSeconds ?? body.currentPositionSeconds ?? body.position ?? 0
  const furthestWatchedPositionSeconds = body.furthestWatchedPositionSeconds ?? body.furthest ?? positionSeconds

  // Fetch lesson metadata and existing progress concurrently
  const [lesson, existing] = await Promise.all([
    prisma.lesson.findUnique({
      where: { id: params.lessonId },
      select: {
        id: true,
        session: { select: { course_id: true } },
        video: { select: { id: true, duration_seconds: true } },
        assessment: { select: { id: true } },
      },
    }),
    prisma.lessonProgress.findUnique({
      where: { user_id_lesson_id: { user_id: userId, lesson_id: params.lessonId } },
    }),
  ])

  if (!lesson) return NextResponse.json({ error: { code: 'LessonNotFound', message: 'Bài học không tồn tại' } }, { status: 404 })
  if (!lesson.video) return NextResponse.json({ error: { code: 'LessonNotFound', message: 'Bài học chưa có video' } }, { status: 404 })

  // Anti-cheat tỉ lệ theo thời gian thực: furthest chỉ được tăng tối đa 2x thời
  // gian thực kể từ lần lưu trước, tương ứng tốc độ phát nhanh nhất UI cho phép.
  // Không cộng một lượng tiến độ miễn phí cho mỗi request để tránh farm heartbeat.
  // Nhảy thẳng tới cuối qua API không thể bỏ qua thời lượng xem thực tế.
  const currentFurthest = existing?.furthest_watched_position_seconds || 0
  const duration = lesson.video.duration_seconds || 1

  const elapsedSec = existing?.last_watched_at
    ? Math.min(Math.max((Date.now() - new Date(existing.last_watched_at).getTime()) / 1000, 0), 3600)
    : 0
  // Staff accounts use the same integrity checks as learners: no role bypass.
  const cappedProgress = capVideoProgress(
    currentFurthest,
    Number(positionSeconds),
    Number(furthestWatchedPositionSeconds),
    elapsedSec,
  )
  const newFurthest = cappedProgress.furthestWatchedPositionSeconds
  const clampedPosition = cappedProgress.lastPositionSeconds

  const progressPercentage = duration > 0
    ? Math.min(100, (newFurthest / duration) * 100)
    : 0

  // Completion/rewards require the entire known duration. Unknown duration is
  // not sufficient evidence to complete a required video.
  const watchedCompletely = hasWatchedFullVideo(newFurthest, lesson.video.duration_seconds)
  const alreadyCompleted = existing?.completed ?? false

  // Completion for assessment lessons requires both the full video and a passed quiz.
  let isQuizPassed = false
  if (!alreadyCompleted && watchedCompletely && lesson.assessment) {
    const passedAttempt = await prisma.attempt.findFirst({
      where: {
        assessment_id: lesson.assessment.id,
        user_id: userId,
        passed: true,
      },
      select: { id: true },
    })
    isQuizPassed = !!passedAttempt
  }

  const completed = lesson.assessment
    ? (alreadyCompleted || (watchedCompletely && isQuizPassed))
    : (alreadyCompleted || watchedCompletely)
  const completed_at = completed ? (existing?.completed_at || new Date()) : null

  const updated = await prisma.lessonProgress.upsert({
    where: { user_id_lesson_id: { user_id: userId, lesson_id: params.lessonId } },
    update: {
      last_position_seconds: Math.floor(clampedPosition),
      furthest_watched_position_seconds: Math.floor(newFurthest),
      last_watched_at: new Date(),
      completed,
      completed_at,
    },
    create: {
      user_id: userId,
      lesson_id: params.lessonId,
      last_position_seconds: Math.floor(clampedPosition),
      furthest_watched_position_seconds: Math.floor(newFurthest),
      last_watched_at: new Date(),
      completed,
      completed_at,
    },
  })

  if (completed) await syncCourseAssignmentCompletion(userId, lesson.session.course_id)

  let starReward: { awarded: boolean; amount: number } | undefined
  const crossedVideoFinishLine = !existing?.completed && currentFurthest < lesson.video.duration_seconds && watchedCompletely
  if (crossedVideoFinishLine && await canEarnStarsForCourse(userId, lesson.session.course_id)) {
    const amount = starsForVideoDuration(duration)
    starReward = await awardStars({
      userId,
      amount,
      reason: 'VIDEO_COMPLETION',
      rewardKey: `video:${userId}:${lesson.video.id}`,
      sourceType: 'VIDEO',
      sourceId: lesson.video.id,
      metadata: { lessonId: lesson.id, durationSeconds: duration },
    })
  }

  return NextResponse.json({
    lessonId: updated.lesson_id,
    id: updated.lesson_id,
    lastPositionSeconds: updated.last_position_seconds,
    furthestWatchedPositionSeconds: updated.furthest_watched_position_seconds,
    progressPercentage: Math.round(progressPercentage * 100) / 100,
    completed: updated.completed,
    completedAt: updated.completed_at,
    starReward,
  }, { status: 200 })
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

  if (!progress) {
    return NextResponse.json({
      lessonId: params.lessonId,
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
