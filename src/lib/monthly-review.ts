import { endedCompletionToleranceSeconds } from './video-progress-rules'
import { learningContext, lockLearningUser, LearningTx } from './learning-periods'
import { prisma } from './prisma'
import { lessonAwardedThisMonth, monthlyQuizBlock, type LessonMonthStars } from './monthly-review-state'

/**
 * "Xem lại tháng này" (KHBB 8: sang tháng mới không reset tiến độ).
 *
 * Tiến độ chu kỳ (`CycleLessonProgress`) không bao giờ bị reset khi sang tháng. Chỉ khi người học bấm
 * "Xem lại" thì lượt xem thưởng của tháng (`MonthlyVideoReplay`) mới được mở cho đúng phạm vi họ chọn;
 * từ lúc đó video phải xem đủ từ đầu trong tháng và quiz làm lại mới tính Star như trước.
 * Một dòng replay của tháng hiện tại, chưa có `last_heartbeat_at`, chính là dấu "đã bấm Xem lại".
 */

export type MonthlyReviewStatus = 'STARTED' | 'ALREADY_STARTED' | 'NOTHING_TO_REVIEW' | 'AWARDED_THIS_MONTH'

/** Video + quiz stars of one lesson in this month and learning cycle (StarLedger VIDEO / ASSESSMENT). */
export async function lessonStarsThisMonth(
  db: LearningTx, userId: string, cycleId: string, monthId: string,
  sources: { videoId?: string | null; assessmentId?: string | null },
): Promise<LessonMonthStars> {
  const or = [
    ...(sources.videoId ? [{ source_type: 'VIDEO', source_id: sources.videoId }] : []),
    ...(sources.assessmentId ? [{ source_type: 'ASSESSMENT', source_id: sources.assessmentId }] : []),
  ]
  const stars: LessonMonthStars = { video: 0, quiz: 0 }
  if (!or.length) return stars
  const rows = await db.starLedger.findMany({
    where: { user_id: userId, learning_cycle_id: cycleId, competition_month_id: monthId, OR: or },
    select: { source_type: true, amount: true },
  })
  for (const row of rows) {
    if (row.source_type === 'VIDEO') stars.video += row.amount
    else stars.quiz += row.amount
  }
  return stars
}

/**
 * Server side of the video → quiz order for a monthly retake (see `monthlyQuizBlock`).
 * `monthId` may be null early in a month before its row exists: then there is no replay yet.
 */
export async function loadMonthlyQuizBlock(db: LearningTx, input: {
  userId: string; cycleId: string; videoId: string; assessmentId: string; monthId: string | null; monthStartsAt: Date
  /** The attempt being submitted right now is not a "prior" attempt. */
  excludeAttemptId?: string
}) {
  const [priorAttempt, replay] = await Promise.all([
    db.attempt.findFirst({
      where: {
        assessment_id: input.assessmentId, user_id: input.userId, learning_cycle_id: input.cycleId, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
        ...(input.excludeAttemptId ? { id: { not: input.excludeAttemptId } } : {}),
      },
      orderBy: { submitted_at: 'asc' },
      select: { submitted_at: true },
    }),
    input.monthId ? db.monthlyVideoReplay.findUnique({
      where: { user_id_video_id_competition_month_id_learning_cycle_id: { user_id: input.userId, video_id: input.videoId, competition_month_id: input.monthId, learning_cycle_id: input.cycleId } },
      select: { completed_at: true },
    }) : null,
  ])
  const videoDoneInEarlierMonth = replay && !replay.completed_at && !priorAttempt
    ? Boolean(await db.monthlyVideoReplay.findFirst({
        where: { user_id: input.userId, video_id: input.videoId, learning_cycle_id: input.cycleId, completed_at: { not: null, lt: input.monthStartsAt } },
        select: { id: true },
      }))
    : false
  return monthlyQuizBlock({
    priorAttempt: Boolean(priorAttempt),
    priorAttemptBeforeMonth: Boolean(priorAttempt?.submitted_at && priorAttempt.submitted_at < input.monthStartsAt),
    replayExists: Boolean(replay),
    replayCompleted: Boolean(replay?.completed_at),
    videoDoneInEarlierMonth,
  })
}

/** Cùng công thức với heartbeat: đã hoàn thành chu kỳ hoặc đã đi tới cuối video (trừ dung sai). */
export function cycleVideoAlreadyComplete(
  row: { completed_at?: Date | null; furthest_seconds?: number | null } | null | undefined,
  durationSeconds: number,
): boolean {
  if (!row) return false
  if (row.completed_at) return true
  const furthest = row.furthest_seconds || 0
  return durationSeconds > 0 && furthest >= durationSeconds - endedCompletionToleranceSeconds(durationSeconds)
}

/**
 * Bài "đang ở chế độ xem tự do": video đã xem đủ trong chu kỳ và tháng này người học chưa bấm Xem lại.
 * Ở chế độ này không tạo lượt xem tháng, không tính Star và không chặn tua trong phần đã xem.
 */
export function isFreeReviewLesson(cycleVideoComplete: boolean, monthlyReplayExists: boolean): boolean {
  return cycleVideoComplete && !monthlyReplayExists
}

export interface ReviewCandidate { lessonId: string; videoId: string | null; durationSeconds: number; videoComplete: boolean }

/** `lessonIdsAwarded`: lessons that already earned a video or quiz star this month (Phương án A). */
export function planMonthlyReview(candidates: ReviewCandidate[], videoIdsWithReplay: Set<string>, lessonIdsAwarded: Set<string> = new Set()) {
  const completed = candidates.filter((c) => c.videoId && c.videoComplete)
  const reviewable = completed.filter((c) => !lessonIdsAwarded.has(c.lessonId))
  const toStart = reviewable.filter((c) => !videoIdsWithReplay.has(c.videoId!))
  const status: MonthlyReviewStatus = !completed.length ? 'NOTHING_TO_REVIEW'
    : !reviewable.length ? 'AWARDED_THIS_MONTH'
    : toStart.length ? 'STARTED' : 'ALREADY_STARTED'
  return { status, reviewable, toStart, alreadyStarted: reviewable.length - toStart.length }
}

export const monthlyReviewMessages: Record<MonthlyReviewStatus, string> = {
  STARTED: 'Đã mở lượt xem lại tháng này. Xem đủ video từ đầu, làm lại quiz của bài đó để nhận Star như bình thường.',
  ALREADY_STARTED: 'Phạm vi này đã được mở xem lại trong tháng này rồi, tiến độ và Star được giữ nguyên.',
  NOTHING_TO_REVIEW: 'Chưa có bài nào đã xem xong video để xem lại trong phạm vi này.',
  AWARDED_THIS_MONTH: 'Bài này đã nhận Star trong tháng này (video hoặc bài kiểm tra). Tháng sau mới xem lại được.',
}

/**
 * Lessons whose quiz counts as passed for this month. "Xem lại tháng này" resets the video
 * and the quiz together, so only a passing attempt submitted after this month's video replay
 * was completed counts; attempts from before the reset (or earlier months) do not.
 */
export async function lessonsWithMonthlyQuizPassed(
  userId: string, cycleId: string, monthId: string,
  lessons: { lessonId: string; videoId: string | null }[],
): Promise<Set<string>> {
  const withVideo = lessons.filter((l): l is { lessonId: string; videoId: string } => Boolean(l.videoId))
  if (!withVideo.length) return new Set()
  const replays = await prisma.monthlyVideoReplay.findMany({
    where: { user_id: userId, learning_cycle_id: cycleId, competition_month_id: monthId, video_id: { in: withVideo.map((l) => l.videoId) }, completed_at: { not: null } },
    select: { video_id: true, completed_at: true },
  })
  const doneAt = new Map(replays.map((r) => [r.video_id, r.completed_at!]))
  const candidates = withVideo.filter((l) => doneAt.has(l.videoId))
  if (!candidates.length) return new Set()
  const attempts = await prisma.attempt.findMany({
    where: {
      user_id: userId, learning_cycle_id: cycleId, passed: true,
      status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
      assessment: { lesson_id: { in: candidates.map((l) => l.lessonId) } },
    },
    select: { submitted_at: true, assessment: { select: { lesson_id: true } } },
  })
  const passed = new Set<string>()
  for (const l of candidates) {
    const since = doneAt.get(l.videoId)!
    if (attempts.some((a) => a.assessment.lesson_id === l.lessonId && a.submitted_at && a.submitted_at >= since)) passed.add(l.lessonId)
  }
  return passed
}

/** Idempotent: chỉ tạo dòng còn thiếu, không đụng dòng đã có và không bao giờ cộng Star. */
export async function startMonthlyReview(userId: string, lessonId: string) {
  return prisma.$transaction(async (tx: LearningTx) => {
    const now = await lockLearningUser(tx, userId)
    const context = await learningContext(tx, userId, now)
    const lessons = await tx.lesson.findMany({
      where: { id: lessonId, session: { course: { status: 'PUBLISHED' } } },
      select: { id: true, video: { select: { id: true, duration_seconds: true } }, assessment: { select: { id: true } } },
    })
    if (!lessons.length) return { error: 'NotFound' as const }
    const awarded = new Set<string>()
    for (const lesson of lessons) {
      const stars = await lessonStarsThisMonth(tx, userId, context.cycle.id, context.month.id, { videoId: lesson.video?.id, assessmentId: lesson.assessment?.id })
      if (lessonAwardedThisMonth(stars)) awarded.add(lesson.id)
    }
    const [progressRows, replayRows] = await Promise.all([
      tx.cycleLessonProgress.findMany({
        where: { user_id: userId, learning_cycle_id: context.cycle.id, lesson_id: { in: lessons.map((l) => l.id) } },
        select: { lesson_id: true, completed_at: true, furthest_seconds: true },
      }),
      tx.monthlyVideoReplay.findMany({
        where: { user_id: userId, learning_cycle_id: context.cycle.id, competition_month_id: context.month.id, video_id: { in: lessons.flatMap((l) => l.video ? [l.video.id] : []) } },
        select: { video_id: true },
      }),
    ])
    const progress = new Map(progressRows.map((row) => [row.lesson_id, row]))
    const plan = planMonthlyReview(lessons.map((lesson) => {
      const durationSeconds = Number(lesson.video?.duration_seconds) || 0
      return { lessonId: lesson.id, videoId: lesson.video?.id ?? null, durationSeconds, videoComplete: cycleVideoAlreadyComplete(progress.get(lesson.id), durationSeconds) }
    }), new Set(replayRows.map((row) => row.video_id)), awarded)
    if (plan.toStart.length) await tx.monthlyVideoReplay.createMany({
      data: plan.toStart.map((c) => ({
        user_id: userId, video_id: c.videoId!, competition_month_id: context.month.id, learning_cycle_id: context.cycle.id, furthest_seconds: 0,
      })),
      skipDuplicates: true,
    })
    return {
      status: plan.status,
      message: monthlyReviewMessages[plan.status],
      competitionMonth: context.month.key,
      started: plan.toStart.length,
      alreadyStarted: plan.alreadyStarted,
      lessonIds: plan.toStart.map((c) => c.lessonId),
    }
  }, { timeout: 30_000 })
}
