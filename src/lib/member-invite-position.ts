/**
 * Chức vụ đích của một lời mời thành viên (dùng chung client và server, không truy cập DB).
 * - MEMBER: thành viên của ban/nhóm DNA đã chọn (hành vi cũ, position_code = NULL).
 * - DEPARTMENT_LEAD: Trưởng ban của ban đã chọn.
 * - PRESIDENT: Chủ tịch Chapter; lời mời trỏ vào chính đơn vị Chapter, không có ban.
 */
export const INVITE_POSITIONS = ['MEMBER', 'DEPARTMENT_LEAD', 'PRESIDENT'] as const
export type InvitePosition = (typeof INVITE_POSITIONS)[number]
export type InvitePositionCode = 'DEPARTMENT_LEAD' | 'PRESIDENT'

export const INVITE_POSITION_LABELS: Record<InvitePosition, string> = {
  MEMBER: 'Thành viên ban',
  DEPARTMENT_LEAD: 'Trưởng ban',
  PRESIDENT: 'Chủ tịch Chapter',
}

export const PRESIDENT_SINGLE_EMAIL_MESSAGE = 'Mỗi Chapter chỉ có 1 Chủ tịch. Khi mời Chủ tịch, danh sách chỉ được có đúng 1 email.'
export const INVALID_INVITE_POSITION_MESSAGE = 'Chức vụ mời không hợp lệ. Chọn Thành viên ban, Trưởng ban hoặc Chủ tịch Chapter.'

/** Không truyền = MEMBER (giữ tương thích client cũ); giá trị lạ = null (từ chối). */
export function parseInvitePosition(value: unknown): InvitePosition | null {
  if (value === undefined || value === null || value === '') return 'MEMBER'
  return typeof value === 'string' && (INVITE_POSITIONS as readonly string[]).includes(value) ? value as InvitePosition : null
}

export function invitePositionCode(position: InvitePosition): InvitePositionCode | null {
  return position === 'MEMBER' ? null : position
}

/** Đọc lại position_code đã lưu; giá trị lạ coi như không có (thành viên thường). */
export function storedInvitePosition(positionCode: string | null | undefined): InvitePosition {
  return positionCode === 'DEPARTMENT_LEAD' || positionCode === 'PRESIDENT' ? positionCode : 'MEMBER'
}

/** Nhãn chức vụ đích cho danh sách lời mời, ví dụ "Trưởng ban · Ban Nội Dung". */
export function invitationTargetLabel(input: { role: string; positionCode?: string | null; unitType?: string | null; unitName?: string | null }): string | null {
  if (input.role !== 'MEMBER') return null
  const position = storedInvitePosition(input.positionCode)
  if (position === 'PRESIDENT') return INVITE_POSITION_LABELS.PRESIDENT
  if (input.unitType === 'DNA_GROUP') return input.unitName ? `Thành viên DNA · ${input.unitName}` : 'Thành viên DNA'
  const label = INVITE_POSITION_LABELS[position]
  return input.unitName ? `${label} · ${input.unitName}` : label
}

export interface PresidentSituation {
  /** Chủ tịch đang tại nhiệm của Chapter (nếu có). */
  currentPresident: { userId: string; name: string; email: string } | null
  /** Lời mời Chủ tịch khác còn hiệu lực (không tính lời mời của chính email đang mời). */
  pendingInvitations: Array<{ id: string; email: string; expiresAt: string }>
}

/** Câu cảnh báo khi mời Chủ tịch mới; null nếu Chapter đang trống vị trí và không có lời mời Chủ tịch nào khác. */
export function presidentReplacementWarning(situation: PresidentSituation): string | null {
  const parts: string[] = []
  if (situation.currentPresident) {
    const who = situation.currentPresident.name || situation.currentPresident.email
    parts.push(`Chapter đang có Chủ tịch ${who} (${situation.currentPresident.email}). Khi người được mời kích hoạt tài khoản, ${who} sẽ thôi chức Chủ tịch và thành thành viên chưa phân Ban.`)
  }
  if (situation.pendingInvitations.length) {
    const emails = situation.pendingInvitations.map((row) => row.email).join(', ')
    parts.push(`Đang có lời mời Chủ tịch chưa kích hoạt cho ${emails}; lời mời đó sẽ bị hủy khi bạn gửi lời mời này.`)
  }
  return parts.length ? parts.join(' ') : null
}

/** Thân request: Chủ tịch không gửi ban (server tự lấy đơn vị Chapter); các chức vụ khác gửi ban đã chọn. */
export function invitePayload(position: InvitePosition, departmentUnitId: string): { position: InvitePosition; organizationUnitId?: string } {
  return position === 'PRESIDENT' ? { position } : { position, organizationUnitId: departmentUnitId }
}

/** Đã đủ thông tin đích để gửi chưa (Chủ tịch không cần chọn ban). */
export function inviteTargetReady(position: InvitePosition, departmentUnitId: string) {
  return position === 'PRESIDENT' || Boolean(departmentUnitId)
}

/** Số email mời Chủ tịch vượt 1 thì trả câu lỗi để hiện ngay, trước khi gửi. */
export function presidentEmailCountError(position: InvitePosition, emailCount: number): string | null {
  return position === 'PRESIDENT' && emailCount > 1 ? `${PRESIDENT_SINGLE_EMAIL_MESSAGE} Danh sách đang có ${emailCount} email.` : null
}


/** Đơn vị đích phải khớp chức vụ: Chủ tịch → CHAPTER, Trưởng ban → DEPARTMENT, thành viên → DEPARTMENT/DNA_GROUP. */
export function invitedUnitMatchesPosition(unitType: string, positionCode: string | null): boolean {
  if (positionCode === 'PRESIDENT') return unitType === 'CHAPTER'
  if (positionCode === 'DEPARTMENT_LEAD') return unitType === 'DEPARTMENT'
  if (positionCode !== null) return false
  return unitType === 'DEPARTMENT' || unitType === 'DNA_GROUP'
}
