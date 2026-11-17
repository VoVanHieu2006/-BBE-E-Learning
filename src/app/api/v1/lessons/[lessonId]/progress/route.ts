import { NextRequest, NextResponse } from 'next/server'
import { ensureCompetitionMonth } from '@/lib/learning-periods'
import { lessonsWithMonthlyQuizPassed, loadMonthlyQuizBlock } from '@/lib/monthly-review'
import { competitionMonthBounds } from '@/lib/learning-cycle-rules'
import { authenticate } from '@/lib/auth'
import { recordVideoHeartbeat, getVideoReplayState } from '@/lib/video-heartbeat'
import { prisma } from '@/lib/prisma'
import { canEarnStarsForCourse, starsForVideoDuration } from '@/lib/stars'
import { readCourseLearningStates } from '@/lib/lesson-learning-state'
import { checkLessonProgression } from '@/lib/progression'
import { capVideoProgress, displayVideoProgressPercent, hasWatchedFullVideo, endedCompletionToleranceSeconds } from '@/lib/video-progress-rules'
import { isLearningManager } from '@/lib/manager-learning-access'
import { readinessForReason } from '@/lib/learning-readiness-rules'
import { chapterRewardState } from '@/lib/chapter-reward-gate'
import { monthlyQuizBlockMessages, monthlyReplayPercent, previousReplayHistory } from '@/lib/monthly-review-state'

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
    const historyData = await getLessonVideoHistory(userId, params.lessonId, (result as any).videoId || null, (result as any).replay)
    Object.assign(result, historyData)
  }

  return NextResponse.json(result)
}

export async function POST(request: NextRequest, context: { params: { lessonId: string } }) {
  return PATCH(request, context)
}

/** Per-month history of one lesson: the monthly video replay and its stars, plus the quiz of that month. */
async function getLessonVideoHistory(userId: string, lessonId: string, videoId: string | null, replay: any) {
  if (!videoId) {
    return {
      videoStarsThisMonth: {
        competitionMonth: replay?.competitionMonth || null,
        completed: Boolean(replay?.completed),
        awardedStars: 0,
        suppressed: Boolean(replay?.suppressed),
      },
      quizThisMonth: null,
      replayHistory: [],
    }
  }
  const assessmentId = (await prisma.assessment.findUnique({ where: { lesson_id: lessonId }, select: { id: true } }))?.id || null

  const now = new Date()
  const recentMonths = await prisma.competitionMonth.findMany({
    where: { starts_at: { lte: now } },
    orderBy: { starts_at: 'desc' },
    take: 6,
    select: { id: true, key: true, starts_at: true, ends_at: true },
  })
  const monthIds = recentMonths.map((row) => row.id)
  const currentMonth = recentMonths.find((row) => row.starts_at.getTime() <= now.getTime() && row.ends_at.getTime() > now.getTime())
  const oldestStart = recentMonths.length ? recentMonths[recentMonths.length - 1].starts_at : now
  const [quizAttempts, quizStarRows] = assessmentId && monthIds.length ? await Promise.all([
    prisma.attempt.findMany({
      where: { user_id: userId, assessment_id: assessmentId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] }, submitted_at: { gte: oldestStart } },
      select: { submitted_at: true, passed: true, score: true },
    }),
    prisma.starLedger.findMany({
      where: { user_id: userId, source_type: 'ASSESSMENT', source_id: assessmentId, competition_month_id: { in: monthIds } },
      select: { competition_month_id: true, amount: true },
    }),
  ]) : [[], []]
  const quizByMonth = new Map<string, { attempted: number; passed: boolean; bestScorePercent: number; stars: number }>()
  const quizFor = (monthId: string) => {
    if (!quizByMonth.has(monthId)) quizByMonth.set(monthId, { attempted: 0, passed: false, bestScorePercent: 0, stars: 0 })
    return quizByMonth.get(monthId)!
  }
  for (const attempt of quizAttempts) {
    const month = recentMonths.find((row) => attempt.submitted_at && row.starts_at <= attempt.submitted_at && row.ends_at > attempt.submitted_at)
    if (!month) continue
    const entry = quizFor(month.id)
    entry.attempted += 1
    entry.passed = entry.passed || Boolean(attempt.passed)
    entry.bestScorePercent = Math.max(entry.bestScorePercent, Math.round(Number(attempt.score || 0) * 100))
  }
  for (const star of quizStarRows) if (star.competition_month_id) quizFor(star.competition_month_id).stars += star.amount
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
      watchedSeconds: Math.round(replayRecord?.furthest_seconds || 0),
      completed: Boolean(replayRecord?.completed_at),
      completedAt: replayRecord?.completed_at || null,
      lastHeartbeatAt: replayRecord?.last_heartbeat_at || null,
      awardedStars: starsByMonth.get(month.id) || 0,
      quiz: assessmentId ? (quizByMonth.get(month.id) || { attempted: 0, passed: false, bestScorePercent: 0, stars: 0 }) : null,
    }
  }).filter((row) => row.watchedSeconds > 0 || row.awardedStars > 0 || (row.quiz && (row.quiz.attempted > 0 || row.quiz.stars > 0)))
  const thisMonthReplay = currentMonth ? replayHistory.find((row) => row.competitionMonthId === currentMonth.id) || null : null

  return {
    videoStarsThisMonth: {
      competitionMonth: replay?.competitionMonth || null,
      completed: Boolean(replay?.completed),
      awardedStars: thisMonthReplay?.awardedStars ?? 0,
      suppressed: Boolean(replay?.suppressed),
    },
    quizThisMonth: assessmentId && currentMonth ? (quizByMonth.get(currentMonth.id) || { attempted: 0, passed: false, bestScorePercent: 0, stars: 0 }) : null,
    replayHistory: previousReplayHistory(replayHistory, currentMonth?.id || null),
  }
}

export async function GET(request: NextRequest, { params }: { params: { lessonId: string } }) {
  const auth = await authenticate(request).catch(() => ({ ok: false, error: { code: 'UNAUTHORIZED' } }))
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const userId = (auth as any).context!.userId

  const asOf = new Date()
  const [cycle, progress, replay, lessonInfo, month] = await Promise.all([
    prisma.learningCycle.findFirst({ where: { user_id: userId, starts_at: { lte: asOf }, ends_at: null }, select: { id: true } }),
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
    getVideoReplayState(userId, params.lessonId, asOf),
    prisma.lesson.findUnique({ where: { id: params.lessonId }, select: { video: { select: { id: true, duration_seconds: true } }, session: { select: { course_id: true } } } }),
    ensureCompetitionMonth(prisma, asOf),
  ])
  const video = lessonInfo?.video || null
  const learningState = lessonInfo ? (await readCourseLearningStates(prisma, userId, lessonInfo.session.course_id))[params.lessonId] : null

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

  const duration = video?.duration_seconds || 0
  const isLessonCompleted = cycle ? Boolean(cycleProgress?.completed_at) : Boolean(progress?.completed)
  const completedAt = cycle ? (cycleProgress?.completed_at || null) : (progress?.completed_at || null)
  const furthest = cycle ? (cycleProgress?.furthest_seconds || 0) : (progress?.furthest_watched_position_seconds || 0)
  const tolerance = endedCompletionToleranceSeconds(duration)
  const videoCompleted = learningState?.videoCompleted ?? (isLessonCompleted || (duration > 0 && (hasWatchedFullVideo(furthest, duration) || furthest >= duration - tolerance)))
  const progressPercentage = displayVideoProgressPercent(furthest, duration, videoCompleted)

  // ---- Per-video learning history (LearningCycle + MonthlyVideoReplay + StarLedger) ----
  const videoId = video?.id || null
  const historyData = await getLessonVideoHistory(userId, params.lessonId, videoId, replay)
  const assessmentId = (await prisma.assessment.findUnique({ where: { lesson_id: params.lessonId }, select: { id: true } }))?.id || null
  // Video → quiz order for a monthly retake, so the lesson and quiz pages lock the same way the server does.
  const monthlyQuizBlockReason = cycle && video && assessmentId
    ? await loadMonthlyQuizBlock(prisma, {
        userId, cycleId: cycle.id, videoId: video.id, assessmentId,
        monthId: month?.id ?? null, monthStartsAt: month?.starts_at ?? competitionMonthBounds(asOf).startsAt,
      })
    : null
  let rewardReason = !cycle ? 'CYCLE_NOT_STARTED' : !month ? 'MONTH_NOT_CONFIGURED' : replay?.suppressed ? 'SUPPRESSED' : replay?.reviewAvailable ? 'REVIEW_NOT_STARTED' : !replay?.lastHeartbeatAt ? 'REPLAY_NOT_STARTED' : 'REPLAY_INCOMPLETE'
  const gate = cycle && month ? await chapterRewardState(prisma, userId, asOf) : null
  if (cycle && month && replay?.completed && !replay.suppressed && video) {
    const entry = await prisma.starLedger.findUnique({ where: { reward_key: `video:${userId}:${video.id}:${month.id}:${cycle.id}` }, select: { id: true } })
    rewardReason = entry ? 'ALREADY_AWARDED' : gate?.paused ? gate.reason || 'REWARD_NOT_ELIGIBLE' : 'REWARD_NOT_ELIGIBLE'
  } else if (gate?.paused) {
    // Say why up front (e.g. Chapter transfer overdue) instead of a generic
    // "suppressed" after the learner has already watched the whole video.
    rewardReason = gate.reason || 'REWARD_NOT_ELIGIBLE'
  }

  return NextResponse.json({
    ...learningState,
    learningCycleId: cycle?.id || null,
    lessonId: params.lessonId,
    progressContext: { learningCycleId: cycle?.id || null, competitionMonthId: month?.id || null, monthlyReplayRequired: Boolean(cycle && month && !replay?.reviewAvailable), monthlyReview: Boolean(cycle && month && replay && !replay.reviewAvailable && videoCompleted) },
    lifetime: { completed: Boolean(progress?.completed), completedAt: progress?.completed_at || null, furthestWatchedPositionSeconds: progress?.furthest_watched_position_seconds || 0 },
    cycleProgress: cycle ? { learningCycleId: cycle.id, completed: isLessonCompleted, videoCompleted, completedAt, furthestWatchedPositionSeconds: furthest } : null,
    rewardStatus: readinessForReason(rewardReason),
    replay,
    reviewState: replay?.reviewState ?? null,
    monthlyQuizPassed: cycle && month ? (await lessonsWithMonthlyQuizPassed(userId, cycle.id, month.id, [{ lessonId: params.lessonId, videoId: video?.id || null }])).has(params.lessonId) : false,
    monthPercent: monthlyReplayPercent(replay?.watchedSeconds || 0, duration),
    videoStarsThisMonth: historyData.videoStarsThisMonth,
    quizThisMonth: historyData.quizThisMonth,
    monthStars: replay?.monthStars ?? null,
    monthlyQuizBlock: monthlyQuizBlockReason ? { reason: monthlyQuizBlockReason, message: monthlyQuizBlockMessages[monthlyQuizBlockReason] } : null,
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
  }, { status: 200, headers: { 'Cache-Control': 'no-store' } })
}
