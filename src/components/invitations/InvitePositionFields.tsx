'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, type ApiResponse } from '@/lib/api/client'
import { INVITE_POSITION_LABELS, PRESIDENT_TARGET, REPLACE_CONFIRM_CODES, isReplaceConfirmCode } from '@/lib/member-invite-position'

export interface PresidentStatus {
  /** Người dùng có quyền cấp Chapter để mời Chủ tịch/Trưởng ban không. */
  canInviteLeadership: boolean
  /** Cảnh báo Chapter đã có Chủ tịch hoặc lời mời Chủ tịch khác; null nếu vị trí đang trống. */
  warning: string | null
  /** Cảnh báo Trưởng ban của ban `departmentUnitId` (ban đã có Trưởng ban hoặc lời mời Trưởng ban khác). */
  departmentLeadWarning: string | null
  /** Ban mà `departmentLeadWarning` nói tới; cảnh báo chỉ hiện khi khớp ban đang chọn. */
  departmentUnitId: string
}

const EMPTY_STATUS: PresidentStatus = { canInviteLeadership: false, warning: null, departmentLeadWarning: null, departmentUnitId: '' }

/**
 * Tải quyền mời chức vụ, tình trạng Chủ tịch của Chapter và (khi đã chọn ban) tình trạng Trưởng ban của ban đó.
 * Tự tải lại khi đổi ban; gọi `refresh` sau mỗi lần gửi. Phản hồi cũ (đổi ban nhanh) bị bỏ qua.
 */
export function usePresidentStatus(enabled = true, departmentUnitId = '') {
  const [status, setStatus] = useState<PresidentStatus>(EMPTY_STATUS)
  const requestId = useRef(0)
  const refresh = useCallback(async () => {
    const id = ++requestId.current
    const query = departmentUnitId && departmentUnitId !== PRESIDENT_TARGET ? `?departmentUnitId=${encodeURIComponent(departmentUnitId)}` : ''
    const res = await apiFetch<any>(`/api/v1/invitations/member/president-status${query}`, { noCache: true })
    if (id !== requestId.current || !res.ok || !res.data) return
    setStatus({
      canInviteLeadership: res.data.canInviteLeadership === true,
      warning: res.data.warning || null,
      departmentLeadWarning: res.data.departmentLead?.warning || null,
      departmentUnitId: query ? departmentUnitId : '',
    })
  }, [departmentUnitId])
  useEffect(() => { if (enabled) refresh() }, [enabled, refresh])
  return { ...status, refresh }
}

/**
 * POST lời mời; nếu server báo chức vụ đã có người giữ (409 PresidentReplaceConfirmRequired hoặc
 * DepartmentLeadReplaceConfirmRequired) thì hỏi xác nhận bằng đúng câu cảnh báo của server rồi gửi lại
 * với `confirmReplace: true`. Trả null nếu người dùng không đồng ý.
 */
export async function postInviteWithPresidentConfirm(url: string, body: Record<string, unknown>): Promise<ApiResponse | null> {
  const send = (extra: Record<string, unknown> = {}) => apiFetch(url, { method: 'POST', body: JSON.stringify({ ...body, ...extra }), noCache: true })
  const first = await send()
  if (first.ok || !isReplaceConfirmCode(first.error?.code)) return first
  const what = first.error!.code === REPLACE_CONFIRM_CODES.DEPARTMENT_LEAD ? 'Trưởng ban' : 'Chủ tịch'
  if (!window.confirm(`${first.error!.message}\n\nBạn vẫn muốn gửi lời mời ${what} này?`)) return null
  return send({ confirmReplace: true })
}

interface Props {
  idPrefix: string
  /** Giá trị ô Ban: id ban, `PRESIDENT_TARGET` (Chủ tịch Chapter) hoặc rỗng (chưa chọn). */
  target: string
  onTargetChange: (target: string) => void
  departments: Array<{ id: string; name: string }>
  departmentsError?: string
  canInviteLeadership: boolean
  /** Hiện ô tick "Là Trưởng ban (LT)" (tab Một email). */
  showLeadToggle: boolean
  makeLead: boolean
  onMakeLeadChange: (value: boolean) => void
  presidentWarning: string | null
  /** Cảnh báo Trưởng ban của ban đang chọn (đã lọc theo ban). */
  departmentLeadWarning: string | null
  disabled?: boolean
}

/**
 * Ô "Ban của thành viên" dùng chung cho modal mời một email và nhiều email của Lead Chapter.
 * Người có quyền cấp Chapter thấy thêm "⭐ Chủ tịch Chapter" trong ô Ban và ô tick "Là Trưởng ban (LT)" khi chọn ban.
 */
export default function InvitePositionFields({ idPrefix, target, onTargetChange, departments, departmentsError, canInviteLeadership, showLeadToggle, makeLead, onMakeLeadChange, presidentWarning, departmentLeadWarning, disabled }: Props) {
  const selectClass = 'w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]'
  const president = canInviteLeadership && target === PRESIDENT_TARGET
  const department = target && target !== PRESIDENT_TARGET
  const warningClass = 'rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900'
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${idPrefix}-department`} className="block text-sm font-semibold text-[#172554] mb-1">Ban của thành viên *</label>
        <select id={`${idPrefix}-department`} required value={target} onChange={(event) => onTargetChange(event.target.value)} disabled={disabled} className={selectClass}>
          <option value="">Chọn ban</option>
          {canInviteLeadership && <option value={PRESIDENT_TARGET}>⭐ {INVITE_POSITION_LABELS.PRESIDENT}</option>}
          {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        {departmentsError ? <p role="alert" className="text-sm text-red-700">{departmentsError}</p> : !departments.length && <p className="text-sm text-[#434655]">Chưa có ban có quyền mời thành viên. Vui lòng liên hệ quản trị viên nếu danh sách không tải được.</p>}
      </div>
      {president && (
        <div className="space-y-2" data-testid="invite-president-info">
          <p className="text-xs text-[#434655]">Chủ tịch thuộc Chapter, không thuộc Ban nào. Mỗi Chapter chỉ có 1 Chủ tịch nên mỗi lần chỉ mời được 1 email.</p>
          {presidentWarning && <p role="alert" data-testid="invite-president-warning" className={warningClass}>⚠️ {presidentWarning}</p>}
        </div>
      )}
      {department && canInviteLeadership && showLeadToggle && (
        <div className="space-y-2">
          <label htmlFor={`${idPrefix}-make-lead`} className="flex items-start gap-2 text-sm text-[#172554] cursor-pointer">
            <input id={`${idPrefix}-make-lead`} type="checkbox" checked={makeLead} disabled={disabled} onChange={(event) => onMakeLeadChange(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-[#cbdbf5] text-[#2563EB] focus:ring-[#2563EB]" />
            <span><span className="font-semibold">Là Trưởng ban (LT)</span><span className="block text-xs text-[#434655]">Mỗi ban chỉ có 1 Trưởng ban.</span></span>
          </label>
          {makeLead && departmentLeadWarning && <p role="alert" data-testid="invite-department-lead-warning" className={warningClass}>⚠️ {departmentLeadWarning}</p>}
        </div>
      )}
    </div>
  )
}
