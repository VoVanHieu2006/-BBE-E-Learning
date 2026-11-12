/**
 * Logic thuần (không DB) cho hạn mức email theo ngày. Resend gói miễn phí: tối đa 100 email/ngày
 * tính theo ngày lịch UTC (reset 0h UTC = 7h sáng giờ Việt Nam). Ta chỉ dùng 90 cho lời mời,
 * để dành phần còn lại cho mail hệ thống (đặt lại mật khẩu).
 */

export const DEFAULT_EMAIL_DAILY_LIMIT = 90
/** Trần của nhà cung cấp (Resend free). Mail đặt lại mật khẩu được phép dùng tới mức này. */
export const DEFAULT_EMAIL_PROVIDER_LIMIT = 100
const VIETNAM_UTC_OFFSET_HOURS = 7

export const EMAIL_QUOTA_EXHAUSTED_MESSAGE = 'Đã hết hạn mức email hôm nay, hãy dùng link mời.'
export const EMAIL_NOT_CONFIGURED_MESSAGE = 'Chưa cấu hình gửi email, hãy dùng link mời.'

function parseLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0 || value > 100000) return fallback
  return value
}

/** Hạn mức dành cho lời mời. Đọc từ EMAIL_DAILY_LIMIT, mặc định 90. */
export function emailDailyLimit(env: Record<string, string | undefined> = process.env): number {
  return parseLimit(env.EMAIL_DAILY_LIMIT, DEFAULT_EMAIL_DAILY_LIMIT)
}

/** Hạn mức cứng cho mail hệ thống: không bao giờ thấp hơn hạn mức lời mời. */
export function emailProviderLimit(env: Record<string, string | undefined> = process.env): number {
  return Math.max(emailDailyLimit(env), parseLimit(env.EMAIL_PROVIDER_DAILY_LIMIT, DEFAULT_EMAIL_PROVIDER_LIMIT))
}

/** Ngày lịch UTC dạng YYYY-MM-DD: khóa của bảng đếm. */
export function utcDayString(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** Thời điểm hạn mức được làm mới: 0h UTC của ngày kế tiếp. */
export function nextQuotaResetAt(now: Date): Date {
  const [year, month, day] = utcDayString(now).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0))
}

/** Số slot còn lại (không âm). */
export function remainingSlots(used: number, limit: number): number {
  return Math.max(0, limit - Math.max(0, used))
}

/** Đặt chỗ một phần: tối đa số slot còn lại dưới trần `cap`. */
export function computeGrant(requested: number, used: number, cap: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return 0
  return Math.min(Math.floor(requested), remainingSlots(used, cap))
}

/** Chia một lô thành phần gửi mail (theo thứ tự, tối đa `granted`) và phần dùng link mời. */
export function splitBatchByQuota<T>(items: T[], granted: number): { email: T[]; link: T[] } {
  const take = Math.max(0, Math.min(items.length, Math.floor(granted)))
  return { email: items.slice(0, take), link: items.slice(take) }
}

/** Slot đã đặt nhưng chưa dùng tới (dòng bị loại trước khi gửi) phải được hoàn lại. */
export function unusedSlots(handedOut: number, consumed: number): number {
  return Math.max(0, handedOut - consumed)
}

export type MailAttemptOutcome =
  | { kind: 'sent' }
  | { kind: 'no_client' }
  | { kind: 'api_error'; statusCode?: number | null }
  | { kind: 'exception' }

/**
 * Slot đã đặt có được hoàn lại không. Chỉ hoàn khi chắc chắn mail không được nhận để gửi:
 * chưa gọi Resend (thiếu cấu hình) hoặc Resend từ chối yêu cầu bằng lỗi 4xx (trừ 429 là hết hạn mức).
 * Gửi thành công, lỗi 429/5xx, lỗi mạng hoặc exception thì giữ slot (có thể mail đã đi), tránh vượt hạn mức thật.
 */
export function shouldRefundSlot(outcome: MailAttemptOutcome): boolean {
  if (outcome.kind === 'no_client') return true
  if (outcome.kind === 'api_error') {
    const code = outcome.statusCode
    return typeof code === 'number' && code >= 400 && code < 500 && code !== 429
  }
  return false
}

const VN_TIME_ZONE_MS = VIETNAM_UTC_OFFSET_HOURS * 60 * 60 * 1000

/** "hôm nay" nếu lần làm mới tới rơi cùng ngày lịch Việt Nam với bây giờ (0h-7h sáng), ngược lại "ngày mai". */
export function quotaResetDayWord(now: Date): 'hôm nay' | 'ngày mai' {
  const vnDay = (date: Date) => new Date(date.getTime() + VN_TIME_ZONE_MS).toISOString().slice(0, 10)
  return vnDay(now) === vnDay(nextQuotaResetAt(now)) ? 'hôm nay' : 'ngày mai'
}

/** Câu hiển thị ở các nơi mời: "Còn X/90 email hôm nay, làm mới lúc 7h sáng ngày mai (giờ Việt Nam)." */
export function formatEmailQuotaLine(info: { limit: number; remaining: number }, now: Date = new Date()): string {
  return `Còn ${info.remaining}/${info.limit} email hôm nay, làm mới lúc 7h sáng ${quotaResetDayWord(now)} (giờ Việt Nam).`
}

/** Câu báo trước khi lô lớn hơn số slot còn lại; rỗng nếu đủ slot. */
export function formatBatchQuotaNotice(total: number, remaining: number): string {
  if (total <= 0 || total <= remaining) return ''
  const viaMail = Math.max(0, remaining)
  return `${viaMail} email sẽ gửi qua mail, ${total - viaMail} email còn lại sẽ dùng link mời.`
}

// ---- Giới hạn tần suất lấy/đổi link mời ----
export const LINK_RATE_WINDOW_MS = 10 * 60 * 1000
export const LINK_RATE_MAX_PER_ACTOR = 60
export const LINK_RATE_MAX_PER_INVITATION = 10

export function isLinkRequestRateLimited(counts: { byActor: number; byInvitation: number }): boolean {
  return counts.byActor >= LINK_RATE_MAX_PER_ACTOR || counts.byInvitation >= LINK_RATE_MAX_PER_INVITATION
}

// ---- Giới hạn tần suất Admin lấy link đặt lại mật khẩu (cùng cửa sổ 10 phút với link mời) ----
export const RESET_LINK_RATE_MAX_PER_ADMIN = 30
export const RESET_LINK_RATE_MAX_PER_USER = 5

export function isResetLinkRequestRateLimited(counts: { byActor: number; byUser: number }): boolean {
  return counts.byActor >= RESET_LINK_RATE_MAX_PER_ADMIN || counts.byUser >= RESET_LINK_RATE_MAX_PER_USER
}
