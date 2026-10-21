/** All competition boundaries are instants; Vietnam has no daylight saving time. */
export const DAY_MS = 86_400_000
export function competitionMonthBounds(at: Date, cutover: Date) {
  const local = new Date(at.getTime() + 7 * 3_600_000)
  const year = local.getUTCFullYear(), month = local.getUTCMonth()
  const naturalStart = new Date(Date.UTC(year, month, 1) - 7 * 3_600_000)
  return {
    key: `${year}-${String(month + 1).padStart(2, '0')}`,
    startsAt: new Date(Math.max(naturalStart.getTime(), cutover.getTime())),
    endsAt: new Date(Date.UTC(year, month + 1, 1) - 7 * 3_600_000),
  }
}

export interface CourseBudget { courseId: string; days: number; completed: boolean }
/** Only a changed set/budget may invoke this calculation. Persist its fingerprint. */
export function calculateSharedDeadline(input: {
  startsAt: Date; changedAt: Date; previous: CourseBudget[]; next: CourseBudget[]; budgetReduction?: boolean
}): Date | null {
  const { startsAt, changedAt, previous, next } = input
  for (const course of [...previous, ...next]) {
    if (!Number.isInteger(course.days) || course.days < 1) throw new Error('InvalidCourseBudget')
  }
  if (!next.length || next.every((course) => course.completed)) return null
  const previousIds = new Set(previous.map((course) => course.courseId))
  const added = next.filter((course) => !previousIds.has(course.courseId))
  const total = next.reduce((sum, course) => sum + course.days, 0)
  const newDays = added.filter((course) => !course.completed).reduce((sum, course) => sum + course.days, 0)
  let due = Math.max(startsAt.getTime() + total * DAY_MS, changedAt.getTime() + newDays * DAY_MS)
  const removed = previous.some((course) => !next.some((item) => item.courseId === course.courseId))
  if ((removed && !added.length) || input.budgetReduction) due = Math.max(due, changedAt.getTime() + 3 * DAY_MS)
  return new Date(due)
}

export function budgetFingerprint(courses: CourseBudget[]): string {
  // Completion does not extend a deadline, and is deliberately absent here.
  return [...courses].sort((a, b) => a.courseId.localeCompare(b.courseId)).map((course) => `${course.courseId}:${course.days}`).join('|')
}

export function highWaterIncrement(previous: number, earned: number) {
  if (![previous, earned].every((value) => Number.isInteger(value) && value >= 0)) throw new Error('InvalidReward')
  return Math.max(0, earned - previous)
}

/** Group simultaneous adjustments before testing the cumulative balance. */
export function firstReachedFinalBalance(rows: { amount: number; awarded_at: Date }[], startsAt: Date) {
  const total = rows.reduce((sum, row) => sum + row.amount, 0)
  if (total <= 0) return { total, achievedAt: null, elapsedMs: 0 }
  const byTime = new Map<number, number>()
  for (const row of rows) byTime.set(row.awarded_at.getTime(), (byTime.get(row.awarded_at.getTime()) || 0) + row.amount)
  let balance = 0
  for (const [time, amount] of Array.from(byTime).sort(([a], [b]) => a - b)) {
    balance += amount
    if (balance >= total) return { total, achievedAt: new Date(time), elapsedMs: Math.max(0, time - startsAt.getTime()) }
  }
  throw new Error('InvalidLedger')
}

/** A disconnected player must establish a new heartbeat before accumulating time. */
export function heartbeatElapsed(lastAt: Date | null, now: Date, maxGapSeconds = 30) {
  if (!lastAt) return 0
  const seconds = (now.getTime() - lastAt.getTime()) / 1000
  return seconds >= 0 && seconds <= maxGapSeconds ? seconds : 0
}
