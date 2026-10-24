import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { recordVideoHeartbeat, getVideoReplayState } from '@/lib/video-heartbeat'
import { prisma } from '@/lib/prisma'
import { awardStars, canEarnStarsForCourse, starsForVideoDuration } from '@/lib/stars'
import { checkLessonProgression } from '@/lib/progression'
import { capVideoProgress, hasWatchedFullVideo, endedCompletionToleranceSeconds } from '@/lib/video-progress-rules'
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
  const playerDurationSeconds = Number(body.playerDurationSeconds ?? body.playerDuration ?? 0)
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
  if ((body.playerDurationSeconds !== undefined || body.playerDuration !== undefined)
    && (!Number.isFinite(playerDurationSeconds) || playerDurationSeconds < 0)) {
    return NextResponse.json({ error: { code: 'InvalidVideoDuration', message: 'Thời lượng video không hợp lệ.' } }, { status: 400 })
  }
  const result = await recordVideoHeartbeat(
    userId,
    params.lessonId,
    positionSeconds,
    furthestWatchedPositionSeconds,
    isAdmin,
    body.viewSessionId || 'COMPAT',
    { playbackRate, event, playerDurationSeconds },
  )
  if (!result) return NextResponse.json({ error: { code: 'LessonNotFound' } }, { status: 404 })
  if ('error' in result) return NextResponse.json(result, { status: 403 })
  ;(globalThis as any).__bbeLearningMeCache?.delete(userId)

  // Attach live video replay history and monthly stars so frontend syncs immediately
  if (result && ('starReward' in result || 'videoCompleted' in result || event === 'ENDED')) {
    const historyData = await getLessonVideoHistory(userId, (result as any).videoId || null, (result as any).replay)
    Object.assign(result, historyData)
  }

  return NextResponse.json(result)
}

export async function POST(request: NextRequest, context: { params: { lessonId: string } }) {
  return PATCH(request, context)
}

async function getLessonVideoHistory(userId: string, videoId: string | null, replay: any) {
  if (!videoId) {
    return {
      videoStarsThisMonth: {
        competitionMonth: replay?.competitionMonth || null,
        completed: Boolean(replay?.completed),
        awardedStars: 0,
        suppressed: Boolean(replay?.suppressed),
      },
      replayHistory: [],
    }
  }

  const now = new Date()
  const recentMonths = await prisma.competitionMonth.findMany({
    where: { starts_at: { lte: now } },
    orderBy: { starts_at: 'desc' },
    take: 6,
    select: { id: true, key: true, starts_at: true },
  })
  const monthIds = recentMonths.map((row) => row.id)
  const currentMonth = recentMonths.find((row) => row.starts_at.getTime() <= now.getTime())
  const [replayRows, videoStarRows] = monthIds.length ? await Promise.all([
    prisma.monthlyVideoReplay.findMany({
      where: { user_id: userId, video_id: videoId, competition_month_id: { in: monthIds } },
      select: { competition_month_id: true, learning_cycle_id: true, furthest_seconds: true, completed_at: true, last_heartbeat_at: true },
    }),
    prisma.starLedger.findMany({
      where: { user_id: userId, source_type: 'VIDEO', source_id: videoId, competition_month_id: { in: monthIds } },
      select: { competition_month_id: true, amount: true, awarded_at: true },
      orderBy: { awarded_at: 'desc' },
    }),
  ]) : [[], []]

  const starsByMonth = new Map<string, number>()
  for (const star of videoStarRows) {
    starsByMonth.set(star.competition_month_id, (starsByMonth.get(star.competition_month_id) || 0) + star.amount)
  }
  const replayHistory = recentMonths.map((month) => {
    const replayRecord = replayRows.find((row) => row.competition_month_id === month.id)
    return {
      competitionMonth: month.key,
      competitionMonthId: month.id,
      learningCycleId: replayRecord?.learning_cycle_id || null,
      watchedSeconds: replayRecord?.furthest_seconds || 0,
      completed: Boolean(replayRecord?.completed_at),
      completedAt: replayRecord?.completed_at || null,
      lastHeartbeatAt: replayRecord?.last_heartbeat_at || null,
      awardedStars: starsByMonth.get(month.id) || 0,
    }
  }).filter((row) => row.watchedSeconds > 0 || row.awardedStars > 0)
  const thisMonthReplay = currentMonth ? replayHistory.find((row) => row.competitionMonthId === currentMonth.id) || null : null

  return {
    videoStarsThisMonth: {
      competitionMonth: replay?.competitionMonth || null,
      completed: Boolean(replay?.completed),
      awardedStars: thisMonthReplay?.awardedStars ?? 0,
      suppressed: Boolean(replay?.suppressed),
    },
    replayHistory,
  }
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
            video: { select: { duration_seconds: true, id: true } },
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
  const tolerance = endedCompletionToleranceSeconds(duration)
  const videoCompleted = isLessonCompleted || (duration > 0 && (hasWatchedFullVideo(furthest, duration) || furthest >= duration - tolerance))
  const progressPercentage = duration > 0 ? (videoCompleted ? 100 : Math.min(100, Math.max(0, Math.round((furthest / duration) * 100)))) : 0

  // ---- Per-video learning history (LearningCycle + MonthlyVideoReplay + StarLedger) ----
  const videoId = progress?.lesson.video?.id || null
  const historyData = await getLessonVideoHistory(userId, videoId, replay)

  return NextResponse.json({
    lessonId: params.lessonId,
    replay,
    videoStarsThisMonth: historyData.videoStarsThisMonth,
    replayHistory: historyData.replayHistory,
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
