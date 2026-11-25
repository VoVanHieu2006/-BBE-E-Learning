import { REPLACE_CONFIRM_CODES, type SingleHolderSituation } from './member-invite-position'

/** Mã 409 khi bổ nhiệm ngay một Trưởng ban vào ban đang có Trưởng ban khác (hoặc lời mời Trưởng ban chờ). */
export const DEPARTMENT_LEAD_APPOINT_CONFIRM_CODE = REPLACE_CONFIRM_CODES.DEPARTMENT_LEAD

/**
 * Câu cảnh báo khi bổ nhiệm ngay Trưởng ban (tab Chuyển giao nhiệm kỳ), khác lời mời ở chỗ có hiệu lực tức thì.
 * null nếu ban chưa có Trưởng ban khác và không có lời mời Trưởng ban nào đang chờ.
 * Người được bổ nhiệm đang là Trưởng ban của chính ban đó không bị tính là "Trưởng ban khác".
 */
export function departmentLeadAppointmentWarning(
  situation: Pick<SingleHolderSituation, 'unitName' | 'currentHolder' | 'pendingInvitations'>,
  appointee: { userId: string; name: string },
): string | null {
  const unit = situation.unitName || 'Ban này'
  const parts: string[] = []
  const holder = situation.currentHolder
  if (holder && holder.userId !== appointee.userId) {
    const who = holder.name || holder.email
    parts.push(`${unit} đang có Trưởng ban ${who} (${holder.email}). Mỗi ban chỉ có 1 Trưởng ban: nếu bổ nhiệm ${appointee.name} làm Trưởng ban, ${who} sẽ xuống Thành viên ${unit} ngay (lịch sử chức vụ vẫn được giữ).`)
  }
  if (situation.pendingInvitations.length) {
    const emails = situation.pendingInvitations.map((row) => row.email).join(', ')
    parts.push(`${unit} đang có lời mời Trưởng ban chưa kích hoạt cho ${emails}; lời mời đó sẽ bị hủy khi bạn bổ nhiệm.`)
  }
  return parts.length ? parts.join(' ') : null
}
