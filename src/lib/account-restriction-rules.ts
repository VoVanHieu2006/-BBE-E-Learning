/** Combine legacy roster membership, current organization membership, and active tenure. */
export function collectChapterAccountIds(...sources: string[][]): string[] {
  return Array.from(new Set(sources.flat().filter(Boolean)))
}

/** A lifted restriction must not reactivate an account while any other lock remains. */
export function canActivateAfterRestrictionLift(hasAnyActiveRestriction: boolean): boolean {
  return !hasAnyActiveRestriction
}

// ---------------------------------------------------------------------------
// KHBB mục 7: khóa quá hạn và khóa mật khẩu
// ---------------------------------------------------------------------------

/** Sai mật khẩu bao nhiêu lần thì khóa (KHBB 7.2). */
export const MAX_LOGIN_ATTEMPTS = 5
/** Số ngày gia hạn tối đa cho một lần "Mở khóa & Gia hạn" (kiểm tra cả ở backend). */
export const MAX_EXTENSION_DAYS = 365
/** Chức vụ của LEAD (Lead Chapter / Lead DNA). `DNA_MANAGER` là tên cũ, vẫn được coi là LEAD. */
export const LEAD_POSITION_CODES = ['DNA_LEAD', 'DNA_MANAGER', 'CHAPTER_LEAD', 'CHAPTER_MANAGER']
/** Trong code hiện tại LEAD vẫn mang role `CHAPTER_LEADER` (đổi tên ở prompt 03). */
const LEAD_ROLES = ['LEAD', 'CHAPTER_LEADER']

export type DeadlineLockExemption = 'ADMIN' | 'LEAD' | 'INACTIVE'

/**
 * Ai không bao giờ bị khóa vì quá hạn (KHBB 7.1): ADMIN, LEAD (role hoặc đang giữ chức vụ LEAD)
 * và tài khoản đã vô hiệu hóa. Trả về lý do miễn, hoặc `null` nếu được phép khóa.
 */
export function deadlineLockExemption(
  account: { role: string; status?: string | null },
  activePositionCodes: string[] = [],
): DeadlineLockExemption | null {
  if (account.role === 'ADMIN') return 'ADMIN'
  if (LEAD_ROLES.includes(account.role) || activePositionCodes.some((code) => LEAD_POSITION_CODES.includes(code))) return 'LEAD'
  if (account.status === 'INACTIVE') return 'INACTIVE'
  return null
}

/** Automated learning deadlines never lock ADMIN, LEAD, or an already-deactivated account. */
export function canDeadlineLockAccount(role: string, activePositionCodes: string[] = [], status?: string | null): boolean {
  return deadlineLockExemption({ role, status }, activePositionCodes) === null
}

/** Tài khoản đang bị khóa quá hạn: có restriction `DEADLINE` còn mở, hoặc `lock_reason` là OVERDUE_LOCK. */
export function isOverdueLocked(
  account: { status: string; lock_reason?: string | null },
  openRestrictionTypes: string[],
): boolean {
  if (openRestrictionTypes.includes('DEADLINE')) return true
  return account.status === 'LOCKED' && (account.lock_reason === 'OVERDUE_LOCK' || account.lock_reason === 'DEADLINE')
}

/** Khóa mật khẩu: không tự mở theo thời gian, chỉ mở bằng mail đặt lại mật khẩu. */
export function isPasswordLocked(account: { status: string; lock_reason?: string | null }): boolean {
  return account.status === 'LOCKED' && account.lock_reason === 'PASSWORD_LOCK'
}

/** Trạng thái đăng nhập sau một lần sai, tính từ số lần sai MỚI (sau khi đã cộng). */
export function failedLoginState(newFailedCount: number) {
  const count = Math.max(1, Math.floor(newFailedCount))
  return {
    failedLoginCount: count,
    locked: count >= MAX_LOGIN_ATTEMPTS,
    remainingAttempts: Math.max(0, MAX_LOGIN_ATTEMPTS - count),
  }
}

export interface ExtendDeadlineValidationError { status: 400; code: string; message: string }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Kiểm tra đầu vào "Mở khóa & Gia hạn": userId đúng định dạng, N nguyên 1..365, lý do bắt buộc. */
export function validateExtendDeadlineInput(
  userId: unknown,
  body: unknown,
): { ok: true; extensionDays: number; reason: string } | { ok: false; error: ExtendDeadlineValidationError } {
  const fail = (code: string, message: string) => ({ ok: false as const, error: { status: 400 as const, code, message } })
  if (typeof userId !== 'string' || !UUID_PATTERN.test(userId)) return fail('InvalidUserId', 'userId không đúng định dạng.')
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('ValidationError', 'Request body không hợp lệ.')
  const { extensionDays, reason } = body as { extensionDays?: unknown; reason?: unknown }
  if (typeof extensionDays !== 'number' || !Number.isInteger(extensionDays) || extensionDays < 1 || extensionDays > MAX_EXTENSION_DAYS) {
    return fail('ValidationError', `extensionDays phải là số nguyên từ 1 đến ${MAX_EXTENSION_DAYS}.`)
  }
  const trimmed = typeof reason === 'string' ? reason.trim() : ''
  if (!trimmed) return fail('ReasonRequired', 'Phải nhập lý do gia hạn.')
  if (trimmed.length > 500) return fail('ValidationError', 'Lý do tối đa 500 ký tự.')
  return { ok: true, extensionDays, reason: trimmed }
}

/** Hạn mới khi gia hạn tay: luôn tính từ hôm nay (hạn cũ của tài khoản bị khóa đã qua). */
export function manualExtensionDueAt(now: Date, extensionDays: number): Date {
  return new Date(now.getTime() + extensionDays * 86_400_000)
}

type AccountOutcome = { status: 'ACTIVE' | 'INACTIVE' | 'LOCKED'; lockReason: string | null }

/**
 * Trạng thái tài khoản sau khi gia hạn xong (đã gỡ restriction DEADLINE).
 * Khóa mật khẩu, restriction khác hoặc INACTIVE vẫn được giữ: mở lần lượt (KHBB 7.3).
 */
export function accountAfterExtension(
  account: { status: string; lock_reason?: string | null },
  otherOpenRestrictions: number,
): AccountOutcome {
  const clearedReason = account.lock_reason === 'OVERDUE_LOCK' || account.lock_reason === 'DEADLINE' ? null : account.lock_reason ?? null
  if (account.status === 'INACTIVE') return { status: 'INACTIVE', lockReason: clearedReason }
  if (isPasswordLocked(account)) return { status: 'LOCKED', lockReason: 'PASSWORD_LOCK' }
  if (otherOpenRestrictions > 0) return { status: 'LOCKED', lockReason: clearedReason }
  return { status: 'ACTIVE', lockReason: null }
}

/**
 * Trạng thái sau khi đặt lại mật khẩu: chỉ xóa khóa mật khẩu, không bao giờ mở khóa quá hạn
 * hay restriction khác (KHBB 7.2, 7.3).
 */
export function accountAfterPasswordReset(
  account: { status: string; lock_reason?: string | null },
  hasOpenDeadlineRestriction: boolean,
  hasAnyOpenRestriction: boolean,
): AccountOutcome {
  const keptReason = account.lock_reason === 'PASSWORD_LOCK' ? null : account.lock_reason ?? null
  if (account.status === 'INACTIVE') return { status: 'INACTIVE', lockReason: keptReason }
  if (hasOpenDeadlineRestriction || (account.status === 'LOCKED' && (account.lock_reason === 'OVERDUE_LOCK' || account.lock_reason === 'DEADLINE'))) {
    return { status: 'LOCKED', lockReason: 'OVERDUE_LOCK' }
  }
  if (hasAnyOpenRestriction) return { status: 'LOCKED', lockReason: keptReason }
  return { status: 'ACTIVE', lockReason: null }
}

/**
 * Nút "kích hoạt" thường (PATCH /users/[userId], LIFT trực tiếp) không được mở khóa quá hạn
 * hay khóa mật khẩu. Trả về lý do từ chối hoặc `null` nếu được phép.
 */
export function ordinaryActivationBlock(
  account: { status: string; lock_reason?: string | null },
  openRestrictionTypes: string[],
): { code: 'OverdueUnlockRequiresExtension' | 'PasswordResetRequired'; message: string } | null {
  if (isOverdueLocked(account, openRestrictionTypes)) {
    return { code: 'OverdueUnlockRequiresExtension', message: 'Tài khoản đang bị khóa do quá hạn học. Hãy dùng nút "Mở khóa & Gia hạn" để mở khóa.' }
  }
  if (isPasswordLocked(account)) {
    return { code: 'PasswordResetRequired', message: 'Tài khoản đang bị khóa do nhập sai mật khẩu. Hãy gửi mail đặt lại mật khẩu để mở khóa.' }
  }
  return null
}
