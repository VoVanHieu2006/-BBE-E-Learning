/** Pure helpers for bulk member invitations (shared by the API route and the UI). */

export const BULK_INVITE_MAX_EMAILS = 50
/** Emails sent in parallel per batch; small enough for the mail provider's rate limits. */
export const BULK_INVITE_CONCURRENCY = 4
/** Stop starting new emails after this long so the request still answers before the platform timeout. */
export const BULK_INVITE_TIME_BUDGET_MS = 40_000
export const INVITE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type BulkInviteStatus =
  | 'SENT'
  | 'SENT_EMAIL_FAILED'
  | 'INVALID'
  | 'DUPLICATE'
  | 'ALREADY_MEMBER'
  | 'ALREADY_INVITED'
  | 'DENIED'
  | 'FAILED'

export interface BulkInviteResultItem {
  email: string
  status: BulkInviteStatus
  message?: string
  /** Set when the invitation was saved but the email could not be sent, so it can be re-sent. */
  invitationId?: string
}

export const BULK_INVITE_RESEND_FAILED_MESSAGE = 'Không gửi lại được email, vui lòng thử lại sau.'
export const BULK_INVITE_NO_INVITATION_MESSAGE = 'Không tìm thấy lời mời đã lưu để gửi lại. Hãy tải lại danh sách lời mời rồi gửi lại từ đó.'
export const BULK_INVITE_RETRY_NO_CHANGE_MESSAGE = 'Đã thử lại nhưng chưa có email nào gửi được. Xem lý do ở từng dòng bên dưới.'

/** Phần của kết quả apiFetch mà việc gửi lại cần đọc. */
export interface BulkInviteResendResponse {
  ok: boolean
  status?: number
  data?: { emailSent?: boolean; emailError?: string } | null
  error?: { code?: string; message?: string } | null
}

/**
 * Trạng thái mới của một dòng "đã lưu lời mời nhưng mail lỗi" sau khi gọi gửi lại.
 * Luôn trả về một dòng (kể cả khi thất bại) để người dùng thấy lý do thay vì im lặng.
 */
export function resolveResendOutcome(row: BulkInviteResultItem, res: BulkInviteResendResponse | null): BulkInviteResultItem {
  if (!row.invitationId) return { ...row, message: BULK_INVITE_NO_INVITATION_MESSAGE }
  if (res?.ok) {
    return res.data?.emailSent === false
      ? { ...row, message: res.data.emailError || 'không rõ lý do' }
      : { email: row.email, status: 'SENT' }
  }
  const message = res?.error?.message || BULK_INVITE_RESEND_FAILED_MESSAGE
  if (res?.error?.code === 'AccessDenied' || res?.status === 403) return { email: row.email, status: 'DENIED', message }
  return { ...row, message }
}

/** Sau khi thử lại, có dòng nào đổi trạng thái so với trước đó hay không (chỉ đổi message thì chưa tính). */
export function bulkRetryChangedAnything(before: BulkInviteResultItem[], updates: BulkInviteResultItem[]): boolean {
  const previous = new Map(before.map((item) => [item.email, item.status]))
  return updates.some((item) => previous.get(item.email) !== item.status)
}

export function normalizeInviteEmail(value: string): string {
  return value.trim().toLowerCase()
}

export function isValidInviteEmail(email: string): boolean {
  return email.length > 0 && email.length <= 255 && INVITE_EMAIL_REGEX.test(email)
}

/**
 * Split pasted text on newlines, commas, semicolons or whitespace, then
 * normalize, validate and de-duplicate while keeping the original order.
 */
export function parseBulkInviteEmails(text: string) {
  const valid: string[] = []
  const invalid: string[] = []
  const duplicates: string[] = []
  const seen = new Set<string>()
  for (const token of String(text || '').split(/[\s,;]+/)) {
    const email = normalizeInviteEmail(token)
    if (!email) continue
    if (seen.has(email)) {
      duplicates.push(email)
      continue
    }
    seen.add(email)
    if (isValidInviteEmail(email)) valid.push(email)
    else invalid.push(email)
  }
  return { valid, invalid, duplicates }
}

/** Statuses the user may retry from the result table. */
export function isRetryableBulkStatus(status: BulkInviteStatus): boolean {
  return status === 'FAILED' || status === 'SENT_EMAIL_FAILED'
}

export type BulkInviteRowKind = 'valid' | 'invalid' | 'duplicate'
export interface BulkInviteRow { id: number; email: string; kind: BulkInviteRowKind }

/**
 * Turn pasted text into ordered, editable preview rows. Duplicates are kept as
 * rows (flagged) so the user sees what was dropped; kind is recomputed after
 * every edit with classifyBulkInviteRows.
 */
export function bulkInviteRowsFromText(text: string, startId = 1): BulkInviteRow[] {
  const rows: BulkInviteRow[] = []
  for (const token of String(text || '').split(/[\s,;]+/)) {
    const email = normalizeInviteEmail(token)
    if (!email) continue
    rows.push({ id: startId + rows.length, email, kind: 'valid' })
  }
  return classifyBulkInviteRows(rows)
}

/** Normalize each row and flag it as valid, invalid or a duplicate of an earlier row. */
export function classifyBulkInviteRows(rows: BulkInviteRow[]): BulkInviteRow[] {
  const seen = new Set<string>()
  return rows.map((row) => {
    const email = normalizeInviteEmail(row.email)
    if (seen.has(email) && email) return { ...row, email, kind: 'duplicate' as const }
    if (email) seen.add(email)
    return { ...row, email, kind: isValidInviteEmail(email) ? 'valid' as const : 'invalid' as const }
  })
}

export function summarizeBulkInviteRows(rows: BulkInviteRow[]) {
  const valid = rows.filter((row) => row.kind === 'valid').length
  const invalid = rows.filter((row) => row.kind === 'invalid').length
  const duplicate = rows.filter((row) => row.kind === 'duplicate').length
  // Same count the server limits: distinct addresses, valid or not.
  return { valid, invalid, duplicate, countedTowardLimit: valid + invalid, overLimit: valid + invalid > BULK_INVITE_MAX_EMAILS }
}

export function summarizeBulkResults(results: BulkInviteResultItem[]) {
  const count = (status: BulkInviteStatus) => results.filter((row) => row.status === status).length
  return {
    total: results.length,
    sent: count('SENT') + count('SENT_EMAIL_FAILED'),
    emailFailed: count('SENT_EMAIL_FAILED'),
    invalid: count('INVALID'),
    duplicate: count('DUPLICATE'),
    alreadyMember: count('ALREADY_MEMBER'),
    alreadyInvited: count('ALREADY_INVITED'),
    denied: count('DENIED'),
    failed: count('FAILED'),
  }
}

/** Run fn over items with at most `limit` in flight; results keep the input order. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++
      out[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return out
}

export type BulkInviteSendOutcome =
  | { ok: true; invitationId?: string; emailSent: boolean; emailError?: string }
  | { ok: false; code?: string; message?: string }

export interface BulkInviteRunDeps {
  /** Emails (lowercase) that already belong to any account. */
  hasAccount: Set<string>
  /** Emails (lowercase) that already have a live pending invitation. */
  hasPending: Set<string>
  /** The same core function the single invite uses. */
  send: (email: string) => Promise<BulkInviteSendOutcome>
  concurrency?: number
  /** Epoch ms after which no new email is started (leave time to answer the request). */
  deadline?: number
  now?: () => number
}

/**
 * Decide the outcome of every address independently: one failure never aborts
 * the batch. Parsing problems come first, then each valid address in order.
 */
export async function runBulkInvites(parsed: { valid: string[]; invalid: string[]; duplicates: string[] }, deps: BulkInviteRunDeps): Promise<BulkInviteResultItem[]> {
  const now = deps.now || Date.now
  const head: BulkInviteResultItem[] = [
    ...parsed.invalid.map((email) => ({ email, status: 'INVALID' as const })),
    ...parsed.duplicates.map((email) => ({ email, status: 'DUPLICATE' as const })),
  ]
  const body = await mapWithConcurrency(parsed.valid, deps.concurrency ?? BULK_INVITE_CONCURRENCY, async (email): Promise<BulkInviteResultItem> => {
    if (deps.hasAccount.has(email)) return { email, status: 'ALREADY_MEMBER' }
    if (deps.hasPending.has(email)) return { email, status: 'ALREADY_INVITED' }
    if (deps.deadline !== undefined && now() > deps.deadline) {
      return { email, status: 'FAILED', message: 'Chưa xử lý kịp trong lần này, hãy thử lại riêng email này.' }
    }
    try {
      const result = await deps.send(email)
      if (result.ok === false) {
        if (result.code === 'EmailAlreadyActive' || result.code === 'EmailAlreadyExists') return { email, status: 'ALREADY_MEMBER', message: result.message }
        if (result.code === 'AccessDenied') return { email, status: 'DENIED', message: result.message }
        return { email, status: 'FAILED', message: result.message }
      }
      return result.emailSent
        ? { email, status: 'SENT' }
        : { email, status: 'SENT_EMAIL_FAILED', message: result.emailError || 'không rõ lý do', invitationId: result.invitationId }
    } catch {
      return { email, status: 'FAILED', message: 'Lỗi hệ thống khi tạo lời mời.' }
    }
  })
  return [...head, ...body]
}

export const BULK_INVITE_STATUS_LABELS: Record<BulkInviteStatus, string> = {
  SENT: 'Đã gửi lời mời',
  SENT_EMAIL_FAILED: 'Đã lưu lời mời, gửi email thất bại',
  INVALID: 'Email không hợp lệ',
  DUPLICATE: 'Trùng lặp trong danh sách',
  ALREADY_MEMBER: 'Đã có tài khoản / đã là thành viên',
  ALREADY_INVITED: 'Đã được mời (lời mời còn hiệu lực)',
  DENIED: 'Không có quyền mời email này',
  FAILED: 'Không gửi được',
}
