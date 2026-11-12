/** Pure helpers for bulk member invitations (shared by the API route and the UI). */

export const BULK_INVITE_MAX_EMAILS = 50
/** Emails sent in parallel per batch; small enough for the mail provider's rate limits. */
export const BULK_INVITE_CONCURRENCY = 4
/** Stop starting new emails after this long so the request still answers before the platform timeout. */
export const BULK_INVITE_TIME_BUDGET_MS = 40_000
export const INVITE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type BulkInviteStatus =
  | 'SENT'
  | 'LINK_NEEDED'
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
  /** Set when the invitation was saved but no email went out (daily quota or send error): its link can be fetched with this id. */
  invitationId?: string
}

export const BULK_INVITE_RETRY_NO_CHANGE_MESSAGE = 'Đã thử lại nhưng chưa có email nào gửi được. Xem lý do ở từng dòng bên dưới.'

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
  return status === 'FAILED'
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
    /** Lời mời đã tạo (gửi email hoặc cần lấy link). */
    created: count('SENT') + count('LINK_NEEDED'),
    emailed: count('SENT'),
    linkNeeded: count('LINK_NEEDED'),
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
        : { email, status: 'LINK_NEEDED', message: result.emailError || 'không rõ lý do', invitationId: result.invitationId }
    } catch {
      return { email, status: 'FAILED', message: 'Lỗi hệ thống khi tạo lời mời.' }
    }
  })
  return [...head, ...body]
}

export const BULK_INVITE_STATUS_LABELS: Record<BulkInviteStatus, string> = {
  SENT: 'Đã gửi email',
  LINK_NEEDED: 'Chưa gửi mail, lấy link mời',
  INVALID: 'Email không hợp lệ',
  DUPLICATE: 'Trùng lặp trong danh sách',
  ALREADY_MEMBER: 'Đã có tài khoản / đã là thành viên',
  ALREADY_INVITED: 'Đã được mời (lời mời còn hiệu lực)',
  DENIED: 'Không có quyền mời email này',
  FAILED: 'Không gửi được',
}
