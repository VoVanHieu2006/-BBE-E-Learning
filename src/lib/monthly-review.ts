import { endedCompletionToleranceSeconds } from './video-progress-rules'
import { learningContext, lockLearningUser, LearningTx } from './learning-periods'
import { prisma } from './prisma'

/**
 * "Xem lại tháng này" (KHBB 8: sang tháng mới không reset tiến độ).
 *
 * Tiến độ chu kỳ (`CycleLessonProgress`) không bao giờ bị reset khi sang tháng. Chỉ khi người học bấm
 * "Xem lại" thì lượt xem thưởng của tháng (`MonthlyVideoReplay`) mới được mở cho đúng phạm vi họ chọn;
 * từ lúc đó video phải xem đủ từ đầu trong tháng và quiz làm lại mới tính Star như trước.
 * Một dòng replay của tháng hiện tại, chưa có `last_heartbeat_at`, chính là dấu "đã bấm Xem lại".
 */

export type MonthlyReviewStatus = 'STARTED' | 'ALREADY_STARTED' | 'NOTHING_TO_REVIEW'

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

export function planMonthlyReview(candidates: ReviewCandidate[], videoIdsWithReplay: Set<string>) {
  const reviewable = candidates.filter((c) => c.videoId && c.videoComplete)
  const toStart = reviewable.filter((c) => !videoIdsWithReplay.has(c.videoId!))
  const status: MonthlyReviewStatus = !reviewable.length ? 'NOTHING_TO_REVIEW' : toStart.length ? 'STARTED' : 'ALREADY_STARTED'
  return { status, reviewable, toStart, alreadyStarted: reviewable.length - toStart.length }
}

export const monthlyReviewMessages: Record<MonthlyReviewStatus, string> = {
  STARTED: 'Đã mở lượt xem lại tháng này. Xem đủ video từ đầu, làm lại quiz của bài đó để nhận Star như bình thường.',
  ALREADY_STARTED: 'Phạm vi này đã được mở xem lại trong tháng này rồi, tiến độ và Star được giữ nguyên.',
  NOTHING_TO_REVIEW: 'Chưa có bài nào đã xem xong video để xem lại trong phạm vi này.',
}

/** Idempotent: chỉ tạo dòng còn thiếu, không đụng dòng đã có và không bao giờ cộng Star. */
export async function startMonthlyReview(userId: string, lessonId: string) {
  return prisma.$transaction(async (tx: LearningTx) => {
    const now = await lockLearningUser(tx, userId)
    const context = await learningContext(tx, userId, now)
    const lessons = await tx.lesson.findMany({
      where: { id: lessonId, session: { course: { status: 'PUBLISHED' } } },
      select: { id: true, video: { select: { id: true, duration_seconds: true } } },
    })
    if (!lessons.length) return { error: 'NotFound' as const }
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
    }), new Set(replayRows.map((row) => row.video_id)))
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
