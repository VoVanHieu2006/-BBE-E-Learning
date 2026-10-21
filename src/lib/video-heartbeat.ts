import { prisma } from './prisma'
import { capVideoProgress, hasWatchedFullVideo } from './video-progress-rules'
import { heartbeatElapsed } from './learning-cycle-rules'
import { learningContext, lockLearningUser, rewardEligibility, enqueueAssignmentSync } from './learning-periods'
import { starsForVideoDuration } from './reward-rules'
import { syncCourseAssignmentCompletion } from './learning-assignments'
import { persistLearningUnlocks } from './learning-unlocks'
import { checkLessonProgression } from './progression'
import { chapterRewardState } from './chapter-reward-gate'

export async function recordVideoHeartbeat(userId: string, lessonId: string, position: number, furthest: number, isAdmin = false, viewSessionId = 'COMPAT') {
  return prisma.$transaction(async (tx) => {
    let now = await lockLearningUser(tx, userId)
    const gate = await checkLessonProgression(userId, lessonId, 'WATCH', isAdmin)
    if (gate.ok === false) return { error: { code: gate.code, message: gate.message } }
    const context = await learningContext(tx, userId, now)
    now = context?.now || now
    const lesson = await tx.lesson.findUnique({ where: { id: lessonId }, include: { video: true, assessment: true, session: true } })
    if (!lesson?.video) return null
    const duration = lesson.video.duration_seconds
    const key = { user_id: userId, lesson_id: lessonId }
    const existing = await tx.lessonProgress.findUnique({ where: { user_id_lesson_id: key } })
    const replayKey = context ? { user_id: userId, video_id: lesson.video.id, competition_month_id: context.month.id, learning_cycle_id: context.cycle.id } : null
    const replay = replayKey ? await tx.monthlyVideoReplay.findUnique({ where: { user_id_video_id_competition_month_id_learning_cycle_id: replayKey } }) : null
    const lastAt = context ? replay?.view_session_id === viewSessionId ? replay.last_heartbeat_at : null : existing?.last_watched_at || null
    const elapsed = heartbeatElapsed(lastAt, now)
    const oldTraining = existing?.furthest_watched_position_seconds || 0
    const training = capVideoProgress(oldTraining, position, furthest, elapsed)
    const trainingFurthest = Math.min(duration, training.furthestWatchedPositionSeconds)
    const videoComplete = hasWatchedFullVideo(trainingFurthest, duration)
    const passed = !lesson.assessment || Boolean(await tx.attempt.count({ where: {
      user_id: userId, assessment_id: lesson.assessment.id, passed: true,
      ...(context ? { OR: [{ learning_cycle_id: context.cycle.id }, ...(context.cycle.provenance === 'LEGACY' ? [{ learning_cycle_id: null }] : [])] } : {}),
      status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
    } }))
    const completed = Boolean(existing?.completed || (videoComplete && passed))
    const completedAt = completed ? existing?.completed_at || now : null
    const updated = await tx.lessonProgress.upsert({ where: { user_id_lesson_id: key },
      create: { ...key, completed, completed_at: completedAt, furthest_watched_position_seconds: Math.floor(trainingFurthest), last_position_seconds: Math.floor(training.lastPositionSeconds), last_watched_at: now },
      update: { completed, completed_at: completedAt, furthest_watched_position_seconds: Math.floor(trainingFurthest), last_position_seconds: Math.floor(training.lastPositionSeconds), last_watched_at: now },
    })
    let rewardComplete = videoComplete, rewardKey = `video:${userId}:${lesson.video.id}`
    let replayFurthest = trainingFurthest
    if (context && replayKey) {
      // Replay never inherits old training completion or unobserved time.
      replayFurthest = Math.min(duration, capVideoProgress(replay?.furthest_seconds || 0, position, furthest, elapsed).furthestWatchedPositionSeconds)
      rewardComplete = hasWatchedFullVideo(replayFurthest, duration)
      await tx.monthlyVideoReplay.upsert({ where: { user_id_video_id_competition_month_id_learning_cycle_id: replayKey },
        create: { ...replayKey, view_session_id: viewSessionId, furthest_seconds: replayFurthest, last_heartbeat_at: now, completed_at: rewardComplete ? now : null },
        update: { view_session_id: viewSessionId, furthest_seconds: replayFurthest, last_heartbeat_at: now, completed_at: replay?.completed_at || (rewardComplete ? now : null) },
      })
      await tx.cycleLessonProgress.upsert({ where: { user_id_lesson_id_learning_cycle_id: { ...key, learning_cycle_id: context.cycle.id } },
        create: { ...key, learning_cycle_id: context.cycle.id, furthest_seconds: trainingFurthest, completed_at: completedAt },
        update: { furthest_seconds: trainingFurthest, completed_at: completedAt },
      })
      rewardKey = `video:${userId}:${lesson.video.id}:${context.month.id}:${context.cycle.id}`
    }
    let amount = 0
    if (rewardComplete && context && (await chapterRewardState(tx, userId, now)).paused) {
      await tx.monthlyVideoReplay.update({ where: { user_id_video_id_competition_month_id_learning_cycle_id: replayKey! }, data: { reward_suppressed_at: replay?.reward_suppressed_at || now } })
    }
    if (rewardComplete && !replay?.reward_suppressed_at && await rewardEligibility(tx, userId, lesson.session.course_id, now)) {
      const chapter = await tx.chapterMember.findUnique({ where: { user_id: userId } })
      const stars = starsForVideoDuration(duration)
      const entry = await tx.starLedger.createMany({ data: [{
        user_id: userId, amount: stars, reason: 'VIDEO_COMPLETION', reward_key: rewardKey,
        source_type: 'VIDEO', source_id: lesson.video.id, awarded_at: now,
        competition_month_id: context?.month.id, learning_cycle_id: context?.cycle.id,
        chapter_at_award_id: context ? chapter?.chapter_id : null, provenance: context ? 'NATIVE' : 'LEGACY',
        metadata: { lessonId, durationSeconds: duration },
      }], skipDuplicates: true })
      amount = entry.count ? stars : 0
    }
    if (completed) {
      await syncCourseAssignmentCompletion(userId, lesson.session.course_id, tx)
      await enqueueAssignmentSync(tx, userId, `video-complete:${context?.cycle.id || 'legacy'}:${userId}:${lessonId}`)
    }
    if (context) await persistLearningUnlocks(tx, userId, lesson.session.course_id, context.cycle.id, now)
    return {
      lessonId, id: lessonId, completed: updated.completed, completedAt: updated.completed_at,
      lastPositionSeconds: updated.last_position_seconds, furthestWatchedPositionSeconds: updated.furthest_watched_position_seconds,
      progressPercentage: duration > 0 ? Math.min(100, trainingFurthest / duration * 100) : 0,
      replay: context ? { competitionMonth: context.month.key, watchedSeconds: replayFurthest, completed: rewardComplete } : null,
      starReward: { awarded: amount > 0, amount },
    }
  }, { timeout: 30_000 })
}

export async function getVideoReplayState(userId: string, lessonId: string) {
  const [cycle, month, video] = await Promise.all([
    prisma.learningCycle.findFirst({ where: { user_id: userId, ends_at: null } }),
    prisma.competitionMonth.findFirst({ where: { starts_at: { lte: new Date() }, ends_at: { gt: new Date() } } }),
    prisma.video.findUnique({ where: { lesson_id: lessonId }, select: { id: true } }),
  ])
  if (!cycle || !month || !video) return null
  const replay = await prisma.monthlyVideoReplay.findUnique({ where: { user_id_video_id_competition_month_id_learning_cycle_id: { user_id: userId, video_id: video.id, competition_month_id: month.id, learning_cycle_id: cycle.id } } })
  return { competitionMonth: month.key, watchedSeconds: replay?.furthest_seconds || 0, completed: Boolean(replay?.completed_at) }
}
