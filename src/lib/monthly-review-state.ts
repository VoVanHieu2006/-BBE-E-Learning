export type MonthlyReviewState = 'AVAILABLE' | 'STARTED' | 'AWARDED'

export class MonthlyReviewRefreshGate {
  private epoch = 0
  begin(reset: boolean): number {
    if (reset) this.epoch += 1
    return this.epoch
  }
  accepts(epoch: number): boolean { return epoch === this.epoch }
}

export function monthlyPlayerStart(monthlyReview: boolean, watchedSeconds: number | undefined, lastPosition: number | undefined, furthest: number, completed: boolean, duration: number) {
  const position = Math.max(0, lastPosition || 0)
  if (monthlyReview) {
    const watched = Math.max(0, watchedSeconds || 0)
    return { initialFurthest: watched, initialPosition: Math.min(position, watched) }
  }
  return { initialFurthest: furthest, initialPosition: completed && position >= duration - 5 ? 0 : position }
}

/**
 * A lesson re-opened with "Xem lại tháng này" needs its quiz passed again in this month
 * (the quiz star is per month). Stays pending after the monthly video is done and until a
 * passing attempt is submitted this month. A first watch in the term is a normal quiz.
 */
export function needsMonthlyQuiz(
  replay: { started?: boolean; completed?: boolean } | null | undefined,
  cycleVideoComplete: boolean,
  termQuizPassed = true,
  monthlyQuizPassed = false,
): boolean {
  return Boolean(cycleVideoComplete && replay?.started && termQuizPassed && !monthlyQuizPassed)
}

export function getMonthlyReviewState(
  cycleVideoComplete: boolean,
  reviewAvailable: boolean,
  awarded: boolean,
): MonthlyReviewState | null {
  if (!cycleVideoComplete) return null
  if (awarded) return 'AWARDED'
  return reviewAvailable ? 'AVAILABLE' : 'STARTED'
}

/** Stars a lesson earned in one competition month and learning cycle. */
export interface LessonMonthStars { video: number; quiz: number }

/**
 * Phương án A: each lesson earns its video star and its quiz star at most once per month.
 * Any star of the lesson this month (video or quiz) closes "Xem lại tháng này" until next month.
 */
export function lessonAwardedThisMonth(stars: LessonMonthStars | null | undefined): boolean {
  return Boolean(stars && (stars.video > 0 || stars.quiz > 0))
}

export type MonthlyQuizBlock = 'REVIEW_NOT_STARTED' | 'MONTHLY_VIDEO_INCOMPLETE'

/**
 * Order video → quiz for a monthly retake. This month's replay must be finished before the quiz when
 * the quiz was already submitted in an earlier month, or when "Xem lại tháng này" was opened for a
 * lesson whose quiz was done before or whose video was already finished in an earlier month.
 * A first watch in the term (including one that spans two months) keeps the normal quiz flow.
 */
export function monthlyQuizBlock(input: {
  priorAttempt: boolean
  priorAttemptBeforeMonth: boolean
  replayExists: boolean
  replayCompleted: boolean
  videoDoneInEarlierMonth: boolean
}): MonthlyQuizBlock | null {
  const required = input.priorAttemptBeforeMonth || (input.replayExists && (input.priorAttempt || input.videoDoneInEarlierMonth))
  if (!required || input.replayCompleted) return null
  return input.replayExists ? 'MONTHLY_VIDEO_INCOMPLETE' : 'REVIEW_NOT_STARTED'
}

export const monthlyQuizBlockMessages: Record<MonthlyQuizBlock, string> = {
  REVIEW_NOT_STARTED: 'Bạn đã làm bài kiểm tra này ở tháng trước. Muốn làm lại để nhận Star tháng này, hãy bấm "Xem lại tháng này" ở bài học rồi xem hết video trước.',
  MONTHLY_VIDEO_INCOMPLETE: 'Bạn đã bấm "Xem lại tháng này": video và bài kiểm tra được làm lại cùng nhau. Hãy xem hết video tháng này rồi mới làm bài kiểm tra.',
}

export type QuizRewardReason =
  | 'AWARDED' | 'NOT_PASSED' | 'ALREADY_AWARDED' | 'MONTHLY_VIDEO_INCOMPLETE'
  | 'VIDEO_NOT_COMPLETED' | 'CHAPTER_PAUSED' | 'REWARD_NOT_ELIGIBLE' | 'NO_COURSE'

/** Why a submitted quiz earned the stars it did, so a 0-star pass is never silent. */
export function quizRewardReason(input: {
  passed: boolean
  amount: number
  hasCourse: boolean
  videoDone: boolean
  monthlyReplayDone: boolean
  eligible: boolean
  paused: boolean
}): QuizRewardReason {
  if (!input.passed) return 'NOT_PASSED'
  if (input.amount > 0) return 'AWARDED'
  if (!input.hasCourse) return 'NO_COURSE'
  if (!input.monthlyReplayDone) return 'MONTHLY_VIDEO_INCOMPLETE'
  if (input.paused) return 'CHAPTER_PAUSED'
  if (!input.eligible) return 'REWARD_NOT_ELIGIBLE'
  if (!input.videoDone) return 'VIDEO_NOT_COMPLETED'
  return 'ALREADY_AWARDED'
}

export const quizRewardMessages: Record<QuizRewardReason, string> = {
  AWARDED: 'Đã cộng Star bài kiểm tra của tháng này.',
  NOT_PASSED: 'Bài làm chưa đạt nên chưa có Star.',
  ALREADY_AWARDED: 'Bài kiểm tra này đã nhận Star trong tháng này (mỗi tháng nhận tối đa 1 lần), lượt này không cộng thêm.',
  MONTHLY_VIDEO_INCOMPLETE: 'Lượt này không tính Star vì video tháng này chưa xem hết.',
  VIDEO_NOT_COMPLETED: 'Lượt này không tính Star vì video bài học chưa xem hết.',
  CHAPTER_PAUSED: 'Chapter đang tạm dừng thưởng nên lượt này không cộng Star.',
  REWARD_NOT_ELIGIBLE: 'Tài khoản hoặc khóa học chưa đủ điều kiện nhận Star.',
  NO_COURSE: 'Bài kiểm tra không thuộc khóa học nào nên không tính Star.',
}

export interface MonthQuizSummary { attempted: number; passed: boolean; stars: number }

/** Quiz part of one month's history, e.g. "quiz đạt +10 ⭐". */
export function monthQuizLabel(quiz: MonthQuizSummary | null | undefined): string {
  if (!quiz) return ''
  if (quiz.stars > 0) return `quiz đạt +${quiz.stars} ⭐`
  if (quiz.passed) return 'quiz đạt, 0 ⭐'
  return quiz.attempted > 0 ? 'quiz chưa đạt' : 'chưa làm quiz'
}

/** One "Những tháng trước" chip: video and quiz of that month, e.g. "video +5 ⭐ · quiz đạt +10 ⭐". */
export function monthHistoryLabel(row: { awardedStars: number; completed: boolean; watchedSeconds: number; quiz?: MonthQuizSummary | null }): string {
  const video = row.awardedStars > 0 ? `video +${row.awardedStars} ⭐`
    : row.completed ? 'video ✓ đã xem'
    : row.watchedSeconds > 0 ? `video ${row.watchedSeconds}s` : 'chưa xem video'
  const quiz = monthQuizLabel(row.quiz)
  return quiz ? `${video} · ${quiz}` : video
}

/**
 * Client view of the server's quiz block. A heartbeat that just finished this month's video
 * updates `replay.completed` before the next full refresh, so that unlocks immediately.
 */
export function monthlyQuizLocked(block: { reason?: MonthlyQuizBlock | null } | null | undefined, replayCompleted: boolean): MonthlyQuizBlock | null {
  const reason = block?.reason || null
  if (reason === 'MONTHLY_VIDEO_INCOMPLETE' && replayCompleted) return null
  return reason
}

/** Quiz part of the "Tháng này" box. */
export function thisMonthQuizLabel(input: {
  quiz: MonthQuizSummary | null | undefined
  locked: MonthlyQuizBlock | null
  monthlyPending: boolean
  reviewStarted: boolean
  monthlyPassed: boolean
}): string {
  if (input.locked === 'MONTHLY_VIDEO_INCOMPLETE') return 'quiz: xem hết video trước'
  if ((input.quiz?.stars || 0) > 0) return monthQuizLabel(input.quiz)
  if (input.monthlyPending) return 'quiz chưa làm lại'
  if (input.reviewStarted && input.monthlyPassed) return 'quiz đạt, 0 ⭐'
  return monthQuizLabel(input.quiz || { attempted: 0, passed: false, stars: 0 })
}

export function monthlyReplayPercent(watchedSeconds: number, durationSeconds: number): number {
  return durationSeconds > 0 ? Math.min(100, Math.max(0, watchedSeconds / durationSeconds * 100)) : 0
}

export function previousReplayHistory<T extends { competitionMonthId: string }>(rows: T[], currentMonthId: string | null): T[] {
  return rows.filter((row) => row.competitionMonthId !== currentMonthId)
}
