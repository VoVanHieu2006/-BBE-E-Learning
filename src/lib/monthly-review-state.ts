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

export function monthlyReplayPercent(watchedSeconds: number, durationSeconds: number): number {
  return durationSeconds > 0 ? Math.min(100, Math.max(0, watchedSeconds / durationSeconds * 100)) : 0
}

export function previousReplayHistory<T extends { competitionMonthId: string }>(rows: T[], currentMonthId: string | null): T[] {
  return rows.filter((row) => row.competitionMonthId !== currentMonthId)
}
