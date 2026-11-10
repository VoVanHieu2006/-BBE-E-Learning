/** All competition boundaries are instants; Vietnam has no daylight saving time. */
export const DAY_MS = 86_400_000
/** `cutover` is an optional historical floor kept for legacy period attribution. */
export function competitionMonthBounds(at: Date, cutover?: Date | null) {
  const local = new Date(at.getTime() + 7 * 3_600_000)
  const year = local.getUTCFullYear(), month = local.getUTCMonth()
  const naturalStart = new Date(Date.UTC(year, month, 1) - 7 * 3_600_000)
  return {
    key: `${year}-${String(month + 1).padStart(2, '0')}`,
    startsAt: cutover ? new Date(Math.max(naturalStart.getTime(), cutover.getTime())) : naturalStart,
    endsAt: new Date(Date.UTC(year, month + 1, 1) - 7 * 3_600_000),
  }
}

export type SharedDeadlineReason =
  | 'CYCLE_INITIALIZED'          // Khởi tạo chu kỳ học mới
  | 'MANDATORY_COURSE_ADDED'     // Admin bổ sung khóa bắt buộc mới
  | 'MANDATORY_COURSE_REMOVED'   // Admin bỏ bớt khóa bắt buộc
  | 'ROLE_CHANGED'               // Học viên thay đổi chức vụ / ban
  | 'ADMIN_BUDGET_SHORTENED'     // Admin rút ngắn default due days của khóa
  | 'ADMIN_MANUAL_EXTENSION'     // Admin mở khóa / gia hạn thời gian
  | 'LESSONS_ADDED_TO_COURSE'    // Admin bổ sung bài học mới vào khóa đã xuất bản

/** Sàn an toàn (KHBB 5.4) và cửa sổ chống "làm mới hạn" (KHBB 5.7), đều bằng 3 ngày. */
export const SAFETY_FLOOR_DAYS = 3
export const RESTORE_WINDOW_MS = SAFETY_FLOOR_DAYS * DAY_MS

export interface CourseBudget {
  courseId: string
  days: number
  completed: boolean
  assignedAt?: Date
  /**
   * Khóa này vừa được thêm lại trong cửa sổ 3 ngày kể từ lúc bị gỡ (KHBB 5.7):
   * không tính vào "khóa mới thêm" (C + T).
   */
  restored?: boolean
}

export interface CalculateSharedDeadlineInput {
  startsAt: Date;
  changedAt: Date;
  currentDueAt?: Date | null;
  previous: CourseBudget[];
  next: CourseBudget[];
  reason?: SharedDeadlineReason;
  budgetReduction?: boolean;
  manualExtensionDays?: number;
  extraDays?: number;
  /** Hạn của lần gia hạn tay gần nhất. Chỉ có tác dụng khi còn ở tương lai so với `changedAt`. */
  manualExtensionDueAt?: Date | null;
  /** Hạn đứng ngay trước lúc gỡ, dùng làm sàn khi có khóa được thêm lại trong cửa sổ 3 ngày. */
  restoredPriorDueAt?: Date | null;
}

/** Thêm lại trong vòng 3 ngày (tính cả đúng 3 ngày) kể từ `endedAt` thì không được làm mới hạn. */
export function isWithinRestoreWindow(endedAt: Date, now: Date): boolean {
  const elapsed = now.getTime() - endedAt.getTime()
  return elapsed >= 0 && elapsed <= RESTORE_WINDOW_MS
}

const sumDays = (courses: CourseBudget[]) => courses.reduce((sum, course) => sum + course.days, 0)

/** Only a changed set/budget may invoke this calculation. Persist its fingerprint. */
export function calculateSharedDeadline(input: CalculateSharedDeadlineInput): Date | null {
  const { startsAt, changedAt, currentDueAt, previous, next, reason, budgetReduction, manualExtensionDays, extraDays, manualExtensionDueAt, restoredPriorDueAt } = input
  for (const course of [...previous, ...next]) {
    if (!Number.isInteger(course.days) || course.days < 1) throw new Error('InvalidCourseBudget')
  }
  if (reason !== 'LESSONS_ADDED_TO_COURSE' && (!next.length || next.every((course) => course.completed))) return null

  const previousIds = new Set(previous.map((course) => course.courseId))
  const added = next.filter((course) => !previousIds.has(course.courseId))
  // Khóa đã xong không kéo dài hạn (KHBB 5.2); khóa thêm lại trong cửa sổ 3 ngày không được cộng như khóa mới (5.7).
  const addedDays = sumDays(added.filter((course) => !course.completed && !course.restored))
  const unfinished = next.filter((course) => !course.completed)
  const unfinishedDays = sumDays(unfinished)

  switch (reason) {
    case 'CYCLE_INITIALIZED':
      return new Date(startsAt.getTime() + sumDays(next) * DAY_MS)

    case 'MANDATORY_COURSE_ADDED':
      if (!currentDueAt) {
        return new Date(changedAt.getTime() + addedDays * DAY_MS)
      }
      return new Date(currentDueAt.getTime() + addedDays * DAY_MS)

    case 'LESSONS_ADDED_TO_COURSE': {
      const days = extraDays && extraDays > 0 ? extraDays : 0
      const baseTime = currentDueAt ? currentDueAt.getTime() : changedAt.getTime()
      return new Date(baseTime + days * DAY_MS)
    }

    case 'ADMIN_MANUAL_EXTENSION': {
      if (!manualExtensionDays || manualExtensionDays < 1) throw new Error('InvalidExtensionDays')
      const baseTime = currentDueAt && currentDueAt.getTime() > changedAt.getTime()
        ? currentDueAt.getTime()
        : changedAt.getTime()
      return new Date(baseTime + manualExtensionDays * DAY_MS)
    }

    case 'MANDATORY_COURSE_REMOVED':
      return currentDueAt || new Date(changedAt.getTime() + sumDays(next) * DAY_MS)

    case 'ROLE_CHANGED':
    case 'ADMIN_BUDGET_SHORTENED':
    case undefined: {
      // Đổi tập khóa / thêm khóa / đổi ban / giảm ngày / gỡ khóa (đường đi thật của production).
      const shortening = reason === 'ADMIN_BUDGET_SHORTENED' || Boolean(budgetReduction)
      // Mục 19: D_assigned là lúc khóa được giao, không nhất thiết là lúc bắt đầu lộ trình.
      const shortenedTargets = shortening
        ? next.filter((course) => {
            const before = previous.find((old) => old.courseId === course.courseId)
            return Boolean(before && course.days < before.days && !course.completed)
          }).map((course) => (course.assignedAt?.getTime() ?? startsAt.getTime()) + course.days * DAY_MS)
        : []
      // Vế 2 (C + tổng ngày khóa mới chưa xong) chỉ có nghĩa khi thật sự có khóa mới chưa xong.
      let due = Math.max(
        startsAt.getTime() + unfinishedDays * DAY_MS,
        ...(addedDays > 0 ? [changedAt.getTime() + addedDays * DAY_MS] : []),
        ...shortenedTargets,
      )
      // Sàn 3 ngày: gỡ khóa (không kèm khóa mới chưa xong) hoặc giảm số ngày (KHBB 5.2, 5.4).
      const removed = previous.some((course) => !next.some((item) => item.courseId === course.courseId))
      if (shortening || (removed && addedDays === 0)) due = Math.max(due, changedAt.getTime() + SAFETY_FLOOR_DAYS * DAY_MS)
      // Chỉ tăng số ngày (không thêm, không gỡ, không giảm): không làm hạn hiện tại ngắn đi (KHBB 6, dòng "Tăng số ngày").
      if (!removed && !shortening && added.length === 0 && currentDueAt) due = Math.max(due, currentDueAt.getTime())
      // Thêm lại trong cửa sổ 3 ngày: không thấp hơn hạn trước lúc gỡ (KHBB 5.7).
      if (restoredPriorDueAt && unfinished.some((course) => course.restored)) due = Math.max(due, restoredPriorDueAt.getTime())
      // Gia hạn tay không bao giờ bị rút ngắn (KHBB 5.5).
      if (manualExtensionDueAt && manualExtensionDueAt.getTime() > changedAt.getTime()) due = Math.max(due, manualExtensionDueAt.getTime())
      return new Date(due)
    }

    default:
      return currentDueAt || new Date(startsAt.getTime() + sumDays(next) * DAY_MS)
  }
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

/**
 * Elapsed wall time between two verified heartbeats. A five-minute window keeps
 * a background tab or a short disconnection from losing legitimate watch time,
 * while a long absence (or a stale/out-of-order request) never grants progress.
 */
export const MAX_HEARTBEAT_GAP_SECONDS = 300

export function heartbeatElapsed(lastAt: Date | null, now: Date, maxGapSeconds = MAX_HEARTBEAT_GAP_SECONDS) {
  if (!lastAt) return 0
  const seconds = (now.getTime() - lastAt.getTime()) / 1000
  return seconds >= 0 && seconds <= maxGapSeconds ? seconds : 0
}
