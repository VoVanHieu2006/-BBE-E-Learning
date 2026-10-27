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
import { readLearningReadiness } from './learning-readiness'
import { readinessForReason } from './learning-readiness-rules'

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
    const isNewSession = Boolean(
      viewSessionId &&
      viewSessionId !== 'COMPAT' &&
      replay?.view_session_id &&
      replay.view_session_id !== viewSessionId
    )
    const lastAt = replay?.last_heartbeat_at || existing?.last_watched_at || null
    // If a learner switches between lessons, a new session is generated. The
    // wall-clock gap between previous session and current session cannot be
    // counted as watch time on this video.
    const elapsed = isNewSession ? 0 : heartbeatElapsed(lastAt, now)
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
    const alreadyCycleVideoComplete = Boolean(
      existingCycleProgress?.completed_at ||
      (safeDuration > 0 && oldCycleFurthest >= safeDuration - endedCompletionToleranceSeconds(safeDuration))
    )
    const cycleTraining = capVideoProgress(oldCycleFurthest, position, furthest, elapsed, playbackRate, grace)
    const cycleFurthest = safeDuration > 0
      ? Math.min(safeDuration, cycleTraining.furthestWatchedPositionSeconds)
      : cycleTraining.furthestWatchedPositionSeconds
    const cycleVideoComplete = alreadyCycleVideoComplete || hasCompletedVideoAtEnd(cycleFurthest, safeDuration, event)
    const finalCycleFurthest = cycleVideoComplete && safeDuration > 0 ? safeDuration : cycleFurthest
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
    const alreadyTrainingVideoComplete = Boolean(
      existing?.completed ||
      (safeDuration > 0 && oldTraining >= safeDuration - endedCompletionToleranceSeconds(safeDuration))
    )
    const training = capVideoProgress(oldTraining, position, furthest, elapsed, playbackRate, grace)
    const trainingFurthest = safeDuration > 0
      ? Math.min(safeDuration, Math.max(training.furthestWatchedPositionSeconds, finalCycleFurthest))
      : Math.max(training.furthestWatchedPositionSeconds, finalCycleFurthest)
    const trainingVideoComplete = alreadyTrainingVideoComplete || (context ? cycleVideoComplete : hasCompletedVideoAtEnd(trainingFurthest, safeDuration, event))
    const finalTrainingFurthest = trainingVideoComplete && safeDuration > 0 ? safeDuration : trainingFurthest
    const lifetimeCompleted = Boolean(existing?.completed || cycleCompleted)
    const lifetimeCompletedAt = lifetimeCompleted ? existing?.completed_at || cycleCompletedAt || now : null

    const updated = await tx.lessonProgress.upsert({
      where: { user_id_lesson_id: key },
      create: {
        ...key,
        completed: lifetimeCompleted,
        completed_at: lifetimeCompletedAt,
        furthest_watched_position_seconds: Math.floor(finalTrainingFurthest),
        last_position_seconds: Math.floor(training.lastPositionSeconds),
        last_watched_at: now,
      },
      update: {
        completed: lifetimeCompleted,
        completed_at: lifetimeCompletedAt,
        furthest_watched_position_seconds: Math.floor(finalTrainingFurthest),
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
      const oldReplayFurthest = replay?.furthest_seconds || 0
      const alreadyReplayComplete = Boolean(
        replay?.completed_at ||
        (safeDuration > 0 && oldReplayFurthest >= safeDuration - endedCompletionToleranceSeconds(safeDuration))
      )
      replayFurthest = replay
        ? Math.min(
            safeDuration > 0 ? safeDuration : Number.MAX_SAFE_INTEGER,
            capVideoProgress(oldReplayFurthest, position, furthest, elapsed, playbackRate, grace)
              .furthestWatchedPositionSeconds,
          )
        : 0
      rewardComplete = alreadyReplayComplete || hasCompletedVideoAtEnd(replayFurthest, safeDuration, event)
      const finalReplayFurthest = rewardComplete && safeDuration > 0 ? safeDuration : Math.floor(replayFurthest)
      const replayCompletedAt = replay?.completed_at || (rewardComplete ? now : null)
      const replayData = {
        view_session_id: viewSessionId,
        furthest_seconds: finalReplayFurthest,
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
          furthest_seconds: Math.floor(finalCycleFurthest),
          completed_at: cycleCompletedAt,
        },
        update: { furthest_seconds: Math.floor(finalCycleFurthest), completed_at: cycleCompletedAt },
      })
    } else {
      rewardComplete = trainingVideoComplete
    }

    // A reward is only paid when the backend has accepted enough fresh viewing
    // in this month/cycle. A client ENDED event alone is never sufficient.
    let amount = 0
    let rewardKey: string | null = null
    let rewardBalance: number | null = null
    let rewardReason = context ? 'REPLAY_INCOMPLETE' : (await readLearningReadiness(tx, now)).reasonCode
    let rewardSuppressed = Boolean(replay?.reward_suppressed_at)
    if (rewardComplete && context) {
      const rewardState = await chapterRewardState(tx, userId, now)
      rewardReason = rewardSuppressed ? 'SUPPRESSED' : 'REWARD_NOT_ELIGIBLE'
      if (rewardState.paused) {
        rewardReason = rewardSuppressed ? 'SUPPRESSED' : rewardState.reason || 'REWARD_NOT_ELIGIBLE'
        rewardSuppressed = true
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
        rewardReason = entry.count ? 'AWARDED' : 'ALREADY_AWARDED'
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
    const effectiveVideoCompleted = context ? cycleVideoComplete : trainingVideoComplete
    const progressPercentage = safeDuration > 0
      ? (effectiveVideoCompleted ? 100 : Math.min(100, Math.max(0, Math.round((context ? finalCycleFurthest : finalTrainingFurthest) / safeDuration * 100))))
      : 0

    return {
      lessonId,
      id: lessonId,
      videoId: lesson.video.id,
      viewSessionId,
      progressContext: {
        learningCycleId: context?.cycle.id || null,
        competitionMonthId: context?.month.id || null,
        monthlyReplayRequired: Boolean(context),
      },
      lifetime: { completed: updated.completed, completedAt: updated.completed_at, furthestWatchedPositionSeconds: updated.furthest_watched_position_seconds },
      cycleProgress: context ? { learningCycleId: context.cycle.id, completed: cycleCompleted, videoCompleted: cycleVideoComplete, completedAt: cycleCompletedAt, furthestWatchedPositionSeconds: Math.floor(finalCycleFurthest) } : null,
      rewardStatus: readinessForReason(rewardReason),
      videoCompleted: effectiveVideoCompleted,
      completed: context ? cycleCompleted : updated.completed,
      completedAt: context ? cycleCompletedAt : updated.completed_at,
      lastPositionSeconds: updated.last_position_seconds,
      furthestWatchedPositionSeconds: context ? Math.floor(finalCycleFurthest) : updated.furthest_watched_position_seconds,
      progressPercentage,
      durationSeconds: safeDuration,
      videoDurationMismatch,
      playbackRate,
      event,
      training: {
        videoCompleted: effectiveVideoCompleted,
        completed: context ? cycleCompleted : updated.completed,
        completedAt: context ? cycleCompletedAt : updated.completed_at,
        furthestWatchedPositionSeconds: Math.floor(context ? finalCycleFurthest : finalTrainingFurthest),
        progressPercentage,
      },
      replay: context
        ? {
            competitionMonth: context.month.key,
            competitionMonthId: context.month.id,
            learningCycleId: context.cycle.id,
            watchedSeconds: Math.floor(rewardComplete && safeDuration > 0 ? safeDuration : replayFurthest),
            completed: rewardComplete,
            suppressed: rewardSuppressed,
          }
        : null,
      starReward: {
        awarded: amount > 0,
        amount,
        rewardKey,
        balance: rewardBalance,
        reasonCode: rewardReason,
      },
    }
  }, { timeout: 60_000 })
}

export async function getVideoReplayState(userId: string, lessonId: string, at = new Date()) {
  const [cycle, month, video] = await Promise.all([
    prisma.learningCycle.findFirst({ where: { user_id: userId, starts_at: { lte: at }, ends_at: null } }),
    prisma.competitionMonth.findFirst({ where: { starts_at: { lte: at }, ends_at: { gt: at } } }),
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
    competitionMonthId: month.id,
    learningCycleId: cycle.id,
    watchedSeconds: replay?.furthest_seconds || 0,
    completed: Boolean(replay?.completed_at),
    suppressed: Boolean(replay?.reward_suppressed_at),
    lastHeartbeatAt: replay?.last_heartbeat_at || null,
  }
}
