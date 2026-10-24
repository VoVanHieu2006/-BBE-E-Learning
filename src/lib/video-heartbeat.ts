import { prisma } from './prisma'
import {
  capVideoProgress,
  endedCompletionToleranceSeconds,
  hasCompletedVideoAtEnd,
  normalizePlaybackRate,
  endedReachAllowanceSeconds,
} from './video-progress-rules'
import { heartbeatElapsed } from './learning-cycle-rules'
import { learningContext, lockLearningUser, rewardEligibility, enqueueAssignmentSync } from './learning-periods'
import { starsForVideoDuration } from './reward-rules'
import { syncCourseAssignmentCompletion } from './learning-assignments'
import { persistLearningUnlocks } from './learning-unlocks'
import { checkLessonProgression } from './progression'
import { chapterRewardState } from './chapter-reward-gate'

export type VideoHeartbeatEvent = 'PLAY' | 'HEARTBEAT' | 'PAUSE' | 'ENDED'

export interface VideoHeartbeatDetails {
  playbackRate?: number
  event?: VideoHeartbeatEvent | string
  playerDurationSeconds?: number
}

function normalizeEvent(value: unknown): VideoHeartbeatEvent {
  return value === 'PLAY' || value === 'PAUSE' || value === 'ENDED' ? value : 'HEARTBEAT'
}

/**
 * Records a server-validated video heartbeat.
 *
 * The server never trusts a client "completed" flag. It advances the watched
 * content position by at most the verified wall-clock gap multiplied by the
 * maximum supported playback rate (2x), plus a small explicit ENDED allowance.
 * This makes 2x viewing valid while preventing an instant seek to the end.
 */
export async function recordVideoHeartbeat(
  userId: string,
  lessonId: string,
  position: number,
  furthest: number,
  isAdmin = false,
  viewSessionId = 'COMPAT',
  details: VideoHeartbeatDetails = {},
) {
  return prisma.$transaction(async (tx) => {
    let now = await lockLearningUser(tx, userId)
    const lesson = await tx.lesson.findUnique({
      where: { id: lessonId },
      relationLoadStrategy: 'join',
      include: { video: true, assessment: true, session: true },
    })
    if (!lesson?.video) return null
    const context = await learningContext(tx, userId, now)
    now = context?.now || now

    const duration = Number(lesson.video.duration_seconds)
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0
    const key = { user_id: userId, lesson_id: lessonId }
    const existing = await tx.lessonProgress.findUnique({ where: { user_id_lesson_id: key } })
    const replayKey = context
      ? {
          user_id: userId,
          video_id: lesson.video.id,
          competition_month_id: context.month.id,
          learning_cycle_id: context.cycle.id,
        }
      : null
    const replay = replayKey
      ? await tx.monthlyVideoReplay.findUnique({
          where: { user_id_video_id_competition_month_id_learning_cycle_id: replayKey },
        })
      : null
    const cycleProgressKey = context
      ? { user_id: userId, lesson_id: lessonId, learning_cycle_id: context.cycle.id }
      : null
    const existingCycleProgress = cycleProgressKey
      ? await tx.cycleLessonProgress.findUnique({
          where: { user_id_lesson_id_learning_cycle_id: cycleProgressKey },
        })
      : null
    // Once a lesson has been earned/unlocked, do not re-run the full ordered
    // curriculum gate on every heartbeat. The first heartbeat (or a genuinely
    // locked lesson) still receives the authoritative server-side check.
    if (!isAdmin && !existingCycleProgress?.unlocked_at) {
      const gate = await checkLessonProgression(userId, lessonId, 'WATCH', isAdmin)
      if (gate.ok === false) return { error: { code: gate.code, message: gate.message } }
    }

    const event = normalizeEvent(details.event)
    const playbackRate = normalizePlaybackRate(details.playbackRate)
    const lastAt = replay?.last_heartbeat_at || existing?.last_watched_at || null
    // Elapsed time is always capped by the reported content position, so a
    // pause cannot create progress (the position does not advance). Reusing the
    // gap on PLAY also preserves legitimate playback while a tab was hidden.
    const elapsed = heartbeatElapsed(lastAt, now)
    // Only an explicit ENDED event may claim a slightly larger wall-clock reach,
    // because the final content seconds never trigger a scheduled heartbeat.
    const grace = event === 'ENDED' ? endedReachAllowanceSeconds(playbackRate) : 0
    // Database duration is an admin-maintained integer while the player reports
    // fractional seconds. A persistent gap beyond the ENDED tolerance can never
    // complete, so report it instead of silently stranding the viewer at 99.x%.
    const playerDuration = Number.isFinite(details.playerDurationSeconds as number)
      ? Math.max(0, (details.playerDurationSeconds as number) || 0)
      : null
    const videoDurationMismatch = playerDuration && safeDuration > 0
      && Math.abs(playerDuration - safeDuration) > Math.max(1.5, endedCompletionToleranceSeconds(safeDuration))
      ? { databaseSeconds: safeDuration, playerSeconds: playerDuration }
      : null

    // ---- Training-cycle progress (cumulative, survives monthly replay) ----
    const oldCycleFurthest = existingCycleProgress?.furthest_seconds || 0
    const cycleTraining = capVideoProgress(oldCycleFurthest, position, furthest, elapsed, playbackRate, grace)
    const cycleFurthest = safeDuration > 0
      ? Math.min(safeDuration, cycleTraining.furthestWatchedPositionSeconds)
      : cycleTraining.furthestWatchedPositionSeconds
    const cycleVideoComplete = hasCompletedVideoAtEnd(cycleFurthest, safeDuration, event)
    const cyclePassed = !lesson.assessment || (
      cycleVideoComplete && !existingCycleProgress?.completed_at
        ? Boolean(await tx.attempt.count({
            where: {
              user_id: userId,
              assessment_id: lesson.assessment.id,
              passed: true,
              ...(context
                ? { OR: [{ learning_cycle_id: context.cycle.id }, ...(context.cycle.provenance === 'LEGACY' ? [{ learning_cycle_id: null }] : [])] }
                : {}),
              status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
            },
          }))
        : true
    )
    const cycleCompleted = Boolean(existingCycleProgress?.completed_at || (cycleVideoComplete && cyclePassed))
    const cycleCompletedAt = cycleCompleted ? existingCycleProgress?.completed_at || now : null

    // ---- Lifetime compatibility projection ----
    const oldTraining = existing?.furthest_watched_position_seconds || 0
    const training = capVideoProgress(oldTraining, position, furthest, elapsed, playbackRate, grace)
    const trainingFurthest = safeDuration > 0
      ? Math.min(safeDuration, Math.max(training.furthestWatchedPositionSeconds, cycleFurthest))
      : Math.max(training.furthestWatchedPositionSeconds, cycleFurthest)
    const lifetimeCompleted = Boolean(existing?.completed || cycleCompleted)
    const lifetimeCompletedAt = lifetimeCompleted ? existing?.completed_at || cycleCompletedAt || now : null

    const updated = await tx.lessonProgress.upsert({
      where: { user_id_lesson_id: key },
      create: {
        ...key,
        completed: lifetimeCompleted,
        completed_at: lifetimeCompletedAt,
        furthest_watched_position_seconds: Math.floor(trainingFurthest),
        last_position_seconds: Math.floor(training.lastPositionSeconds),
        last_watched_at: now,
      },
      update: {
        completed: lifetimeCompleted,
        completed_at: lifetimeCompletedAt,
        furthest_watched_position_seconds: Math.floor(trainingFurthest),
        last_position_seconds: Math.floor(training.lastPositionSeconds),
        last_watched_at: now,
      },
    })

    // ---- Monthly replay progress (independent from training completion) ----
    let replayFurthest = 0
    let rewardComplete = false
    if (context && replayKey) {
      // A brand-new monthly replay starts at zero. The first heartbeat after it
      // is created establishes last_heartbeat_at; the next heartbeat is the
      // first one that may advance content. This prevents importing old watch
      // time into a new reward period while still allowing 2x playback.
      replayFurthest = replay
        ? Math.min(
            safeDuration > 0 ? safeDuration : Number.MAX_SAFE_INTEGER,
            capVideoProgress(replay.furthest_seconds || 0, position, furthest, elapsed, playbackRate, grace)
              .furthestWatchedPositionSeconds,
          )
        : 0
      rewardComplete = hasCompletedVideoAtEnd(replayFurthest, safeDuration, event)
      const replayCompletedAt = replay?.completed_at || (rewardComplete ? now : null)
      const replayData = {
        view_session_id: viewSessionId,
        furthest_seconds: replayFurthest,
        last_heartbeat_at: now,
        completed_at: replayCompletedAt,
      }
      await tx.monthlyVideoReplay.upsert({
        where: { user_id_video_id_competition_month_id_learning_cycle_id: replayKey },
        create: { ...replayKey, ...replayData },
        update: replayData,
      })
      await tx.cycleLessonProgress.upsert({
        where: { user_id_lesson_id_learning_cycle_id: cycleProgressKey! },
        create: {
          ...cycleProgressKey!,
          furthest_seconds: cycleFurthest,
          completed_at: cycleCompletedAt,
        },
        update: { furthest_seconds: cycleFurthest, completed_at: cycleCompletedAt },
      })
    }

    // A reward is only paid when the backend has accepted enough fresh viewing
    // in this month/cycle. A client ENDED event alone is never sufficient.
    let amount = 0
    let rewardKey: string | null = null
    let rewardBalance: number | null = null
    if (rewardComplete && context) {
      const rewardState = await chapterRewardState(tx, userId, now)
      if (rewardState.paused) {
        if (!replay?.reward_suppressed_at) {
          await tx.monthlyVideoReplay.update({
            where: { user_id_video_id_competition_month_id_learning_cycle_id: replayKey! },
            data: { reward_suppressed_at: now },
          })
        }
      } else if (!replay?.reward_suppressed_at && await rewardEligibility(tx, userId, lesson.session.course_id, now)) {
        const chapter = await tx.chapterMember.findUnique({ where: { user_id: userId } })
        const stars = starsForVideoDuration(safeDuration)
        const candidateKey = `video:${userId}:${lesson.video.id}:${context.month.id}:${context.cycle.id}`
        const entry = await tx.starLedger.createMany({
          data: [{
            user_id: userId,
            amount: stars,
            reason: 'VIDEO_COMPLETION',
            reward_key: candidateKey,
            source_type: 'VIDEO',
            source_id: lesson.video.id,
            awarded_at: now,
            competition_month_id: context.month.id,
            learning_cycle_id: context.cycle.id,
            chapter_at_award_id: chapter?.chapter_id ?? null,
            provenance: 'NATIVE',
            metadata: { lessonId, durationSeconds: safeDuration, playbackRate },
          }],
          skipDuplicates: true,
        })
        amount = entry.count ? stars : 0
        if (amount > 0) rewardKey = candidateKey
      }
    } else if (rewardComplete) {
      // Transitional compatibility when cutover has not been enabled yet.
      const chapter = await tx.chapterMember.findUnique({ where: { user_id: userId } })
      const stars = starsForVideoDuration(safeDuration)
      const candidateKey = `video:${userId}:${lesson.video.id}`
      const entry = await tx.starLedger.createMany({
        data: [{
          user_id: userId,
          amount: stars,
          reason: 'VIDEO_COMPLETION',
          reward_key: candidateKey,
          source_type: 'VIDEO',
          source_id: lesson.video.id,
          awarded_at: now,
          chapter_at_award_id: chapter?.chapter_id ?? null,
          provenance: 'LEGACY',
          metadata: { lessonId, durationSeconds: safeDuration, playbackRate },
        }],
        skipDuplicates: true,
      })
      amount = entry.count ? stars : 0
      if (amount > 0) rewardKey = candidateKey
    }

    const effectivelyCompleted = context ? cycleCompleted : updated.completed
    if (effectivelyCompleted) {
      await syncCourseAssignmentCompletion(userId, lesson.session.course_id, tx)
      await enqueueAssignmentSync(
        tx,
        userId,
        `video-complete:${context?.cycle.id || 'legacy'}:${userId}:${lessonId}`,
      )
    }
    if (context && (!existingCycleProgress?.unlocked_at || cycleVideoComplete || cycleCompleted)) {
      await persistLearningUnlocks(tx, userId, lesson.session.course_id, context.cycle.id, now)
    }

    if (amount > 0) {
      const balance = await tx.starLedger.aggregate({ where: { user_id: userId }, _sum: { amount: true } })
      rewardBalance = balance._sum.amount || 0
    }
    const progressPercentage = safeDuration > 0
      ? Math.min(100, Math.max(0, (context ? cycleFurthest : trainingFurthest) / safeDuration * 100))
      : 0

    return {
      lessonId,
      id: lessonId,
      videoId: lesson.video.id,
      videoCompleted: context ? cycleVideoComplete : hasCompletedVideoAtEnd(trainingFurthest, safeDuration, event),
      completed: context ? cycleCompleted : updated.completed,
      completedAt: context ? cycleCompletedAt : updated.completed_at,
      lastPositionSeconds: updated.last_position_seconds,
      furthestWatchedPositionSeconds: context ? Math.floor(cycleFurthest) : updated.furthest_watched_position_seconds,
      progressPercentage,
      durationSeconds: safeDuration,
      videoDurationMismatch,
      playbackRate,
      event,
      training: {
        videoCompleted: context ? cycleVideoComplete : hasCompletedVideoAtEnd(trainingFurthest, safeDuration, event),
        completed: context ? cycleCompleted : updated.completed,
        completedAt: context ? cycleCompletedAt : updated.completed_at,
        furthestWatchedPositionSeconds: Math.floor(trainingFurthest),
        progressPercentage,
      },
      replay: context
        ? {
            competitionMonth: context.month.key,
            watchedSeconds: Math.floor(replayFurthest),
            completed: rewardComplete,
            suppressed: Boolean(replay?.reward_suppressed_at),
          }
        : null,
      starReward: {
        awarded: amount > 0,
        amount,
        rewardKey,
        balance: rewardBalance,
      },
    }
  }, { timeout: 60_000 })
}

export async function getVideoReplayState(userId: string, lessonId: string) {
  const [cycle, month, video] = await Promise.all([
    prisma.learningCycle.findFirst({ where: { user_id: userId, ends_at: null } }),
    prisma.competitionMonth.findFirst({ where: { starts_at: { lte: new Date() }, ends_at: { gt: new Date() } } }),
    prisma.video.findUnique({ where: { lesson_id: lessonId }, select: { id: true } }),
  ])
  if (!cycle || !month || !video) return null
  const replay = await prisma.monthlyVideoReplay.findUnique({
    where: {
      user_id_video_id_competition_month_id_learning_cycle_id: {
        user_id: userId,
        video_id: video.id,
        competition_month_id: month.id,
        learning_cycle_id: cycle.id,
      },
    },
  })
  return {
    competitionMonth: month.key,
    watchedSeconds: replay?.furthest_seconds || 0,
    completed: Boolean(replay?.completed_at),
    suppressed: Boolean(replay?.reward_suppressed_at),
    lastHeartbeatAt: replay?.last_heartbeat_at || null,
  }
}
