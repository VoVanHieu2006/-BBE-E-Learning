/** Pure helpers for bulk member invitations (shared by the API route and the UI). */

export const BULK_INVITE_MAX_EMAILS = 50
export const INVITE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type BulkInviteStatus =
  | 'SENT'
  | 'SENT_EMAIL_FAILED'
  | 'INVALID'
  | 'DUPLICATE'
  | 'ALREADY_MEMBER'
  | 'ALREADY_INVITED'
  | 'FAILED'

export interface BulkInviteResultItem {
  email: string
  status: BulkInviteStatus
  message?: string
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

export const BULK_INVITE_STATUS_LABELS: Record<BulkInviteStatus, string> = {
  SENT: 'Đã gửi lời mời',
  SENT_EMAIL_FAILED: 'Đã lưu lời mời, gửi email thất bại',
  INVALID: 'Email không hợp lệ',
  DUPLICATE: 'Trùng lặp trong danh sách',
  ALREADY_MEMBER: 'Đã có tài khoản / đã là thành viên',
  ALREADY_INVITED: 'Đã được mời (lời mời còn hiệu lực)',
  FAILED: 'Không gửi được',
}
