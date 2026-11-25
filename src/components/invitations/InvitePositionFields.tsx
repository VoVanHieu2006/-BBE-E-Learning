'use client'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch, type ApiResponse } from '@/lib/api/client'
import { INVITE_POSITION_LABELS, type InvitePosition } from '@/lib/member-invite-position'

export interface PresidentStatus {
  /** Người dùng có quyền cấp Chapter để mời Chủ tịch/Trưởng ban không. */
  canInviteLeadership: boolean
  /** Cảnh báo Chapter đã có Chủ tịch hoặc lời mời Chủ tịch khác; null nếu vị trí đang trống. */
  warning: string | null
}

/** Tải quyền mời chức vụ và tình trạng Chủ tịch của Chapter; gọi `refresh` sau mỗi lần gửi. */
export function usePresidentStatus(enabled = true) {
  const [status, setStatus] = useState<PresidentStatus>({ canInviteLeadership: false, warning: null })
  const refresh = useCallback(async () => {
    const res = await apiFetch<PresidentStatus>('/api/v1/invitations/member/president-status', { noCache: true })
    if (res.ok && res.data) setStatus({ canInviteLeadership: res.data.canInviteLeadership === true, warning: res.data.warning || null })
  }, [])
  useEffect(() => { if (enabled) refresh() }, [enabled, refresh])
  return { ...status, refresh }
}

/**
 * POST lời mời; nếu server báo Chapter đã có Chủ tịch (409 PresidentReplaceConfirmRequired) thì hỏi xác nhận
 * bằng đúng câu cảnh báo của server rồi gửi lại với confirmReplacePresident. Trả null nếu người dùng không đồng ý.
 */
export async function postInviteWithPresidentConfirm(url: string, body: Record<string, unknown>): Promise<ApiResponse | null> {
  const send = (extra: Record<string, unknown> = {}) => apiFetch(url, { method: 'POST', body: JSON.stringify({ ...body, ...extra }), noCache: true })
  const first = await send()
  if (first.ok || first.error?.code !== 'PresidentReplaceConfirmRequired') return first
  if (!window.confirm(`${first.error.message}\n\nBạn vẫn muốn gửi lời mời Chủ tịch này?`)) return null
  return send({ confirmReplacePresident: true })
}

interface Props {
  idPrefix: string
  position: InvitePosition
  onPositionChange: (position: InvitePosition) => void
  departmentUnitId: string
  onDepartmentChange: (id: string) => void
  departments: Array<{ id: string; name: string }>
  departmentsError?: string
  canInviteLeadership: boolean
  presidentWarning: string | null
  disabled?: boolean
}

/** Ô "Chức vụ" + "Ban" dùng chung cho modal mời một email và nhiều email của Lead Chapter. */
export default function InvitePositionFields({ idPrefix, position, onPositionChange, departmentUnitId, onDepartmentChange, departments, departmentsError, canInviteLeadership, presidentWarning, disabled }: Props) {
  const selectClass = 'w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]'
  return (
    <div className="space-y-4">
      {canInviteLeadership && (
        <div>
          <label htmlFor={`${idPrefix}-position`} className="block text-sm font-semibold text-[#172554] mb-1">Chức vụ *</label>
          <select id={`${idPrefix}-position`} value={position} disabled={disabled} onChange={(event) => onPositionChange(event.target.value as InvitePosition)} className={selectClass}>
            <option value="MEMBER">{INVITE_POSITION_LABELS.MEMBER}</option>
            <option value="DEPARTMENT_LEAD">{INVITE_POSITION_LABELS.DEPARTMENT_LEAD}</option>
            <option value="PRESIDENT">⭐ {INVITE_POSITION_LABELS.PRESIDENT}</option>
          </select>
        </div>
      )}
      {position === 'PRESIDENT' ? (
        <div className="space-y-2" data-testid="invite-president-info">
          <p className="text-xs text-[#434655]">Chủ tịch thuộc Chapter, không thuộc Ban nào. Mỗi Chapter chỉ có 1 Chủ tịch nên mỗi lần chỉ mời được 1 email.</p>
          {presidentWarning && (
            <p role="alert" data-testid="invite-president-warning" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
              ⚠️ {presidentWarning}
            </p>
          )}
        </div>
      ) : (
        <div>
          <label htmlFor={`${idPrefix}-department`} className="block text-sm font-semibold text-[#172554] mb-1">{position === 'DEPARTMENT_LEAD' ? 'Ban sẽ làm Trưởng ban *' : 'Ban của thành viên *'}</label>
          <select id={`${idPrefix}-department`} required value={departmentUnitId} onChange={(event) => onDepartmentChange(event.target.value)} disabled={disabled} className={selectClass}>
            <option value="">Chọn ban</option>
            {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
          </select>
          {departmentsError ? <p role="alert" className="text-sm text-red-700">{departmentsError}</p> : !departments.length && <p className="text-sm text-[#434655]">Chưa có ban có quyền mời thành viên. Vui lòng liên hệ quản trị viên nếu danh sách không tải được.</p>}
        </div>
      )}
    </div>
  )
}
