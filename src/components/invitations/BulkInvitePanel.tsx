'use client'
import { useState } from 'react'
import Button from '@/components/ui/Button'
import { clearApiCache } from '@/lib/api/client'
import {
  BULK_INVITE_MAX_EMAILS,
  BULK_INVITE_RETRY_NO_CHANGE_MESSAGE,
  BULK_INVITE_STATUS_LABELS,
  BulkInviteResultItem,
  BulkInviteRow,
  BulkInviteStatus,
  bulkInviteRowsFromText,
  bulkLeadEmail,
  bulkLeadRowAfterChange,
  bulkRetryChangedAnything,
  bulkRetryLeadEmail,
  classifyBulkInviteRows,
  isRetryableBulkStatus,
  summarizeBulkInviteRows,
  summarizeBulkResults,
} from '@/lib/bulk-invite'
import { formatBatchQuotaNotice } from '@/lib/email-quota-core'
import EmailQuotaNotice, { useEmailQuota } from '@/components/invitations/EmailQuotaNotice'
import InviteLinkButton from '@/components/invitations/InviteLinkButton'
import { postInviteWithPresidentConfirm } from '@/components/invitations/InvitePositionFields'
import { INVITE_POSITION_LABELS, invitePayload, inviteTargetReady, presidentEmailCountError, type InvitePosition } from '@/lib/member-invite-position'

const STATUS_STYLES: Record<BulkInviteStatus, string> = {
  SENT: 'bg-green-100 text-green-800',
  LINK_NEEDED: 'bg-amber-100 text-amber-800',
  INVALID: 'bg-red-100 text-red-800',
  DUPLICATE: 'bg-slate-100 text-slate-700',
  ALREADY_MEMBER: 'bg-blue-100 text-blue-800',
  ALREADY_INVITED: 'bg-violet-100 text-violet-800',
  DENIED: 'bg-red-100 text-red-800',
  FAILED: 'bg-red-100 text-red-800',
}

const ROW_BADGES = {
  valid: { label: 'Hợp lệ', style: 'bg-green-100 text-green-800' },
  invalid: { label: 'Sai định dạng', style: 'bg-red-100 text-red-800' },
  duplicate: { label: 'Trùng, sẽ bỏ qua', style: 'bg-slate-100 text-slate-700' },
} as const

type Phase = 'input' | 'preview' | 'results'

interface Props {
  /** Ban hoặc nhóm DNA đã chọn; áp cho cả lô, giống mời đơn. Rỗng thì chưa cho gửi. */
  organizationUnitId: string
  /** Chức vụ áp cho cả lô (mặc định thành viên). Chủ tịch: không cần ban, chỉ đúng 1 email. */
  position?: InvitePosition
  /** Hiện trên nút khi chưa chọn được ban/nhóm. */
  missingScopeMessage: string
  /** Gọi sau khi có ít nhất một lời mời được tạo, để trang tải lại danh sách. */
  onSent?: () => void
  onClose?: () => void
  /** Tắt toàn bộ ô nhập, ví dụ khi form cha đang bận. */
  disabled?: boolean
  /** Người mời có quyền cấp Chapter: bước Xem trước có ô chọn 1 Trưởng ban (LT) trong danh sách (chỉ khi mời thành viên ban). */
  canChooseLead?: boolean
  /** Cảnh báo ban đã có Trưởng ban / lời mời Trưởng ban khác (đã lọc theo ban đang chọn); hiện khi có chọn LT. */
  departmentLeadWarning?: string | null
}

const LT_BADGE = 'whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900'

/**
 * Mời nhiều email một lần (dùng cho LEAD Chapter và DNA). Ba bước: dán danh sách,
 * xem trước/sửa/bỏ, rồi xem kết quả từng email và thử lại riêng email lỗi.
 * Mọi kiểm tra quyền và nghiệp vụ nằm ở /api/v1/invitations/member/bulk.
 */
export default function BulkInvitePanel({ organizationUnitId, position = 'MEMBER', missingScopeMessage, onSent, onClose, disabled, canChooseLead = false, departmentLeadWarning = null }: Props) {
  const [phase, setPhase] = useState<Phase>('input')
  const [text, setText] = useState('')
  const [rows, setRows] = useState<BulkInviteRow[]>([])
  /** Dòng được chọn làm Trưởng ban ở bước Xem trước; null = Không chọn ai. */
  const [leadRowId, setLeadRowId] = useState<number | null>(null)
  const [results, setResults] = useState<BulkInviteResultItem[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [linkNotice, setLinkNotice] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)
  /** Tăng sau mỗi lần gửi để tải lại hạn mức email còn lại. */
  const [quotaRefresh, setQuotaRefresh] = useState(0)
  const quota = useEmailQuota(`${quotaRefresh}:${phase}`)

  const inputSummary = summarizeBulkInviteRows(bulkInviteRowsFromText(text))
  const summary = summarizeBulkInviteRows(rows)
  const resultSummary = summarizeBulkResults(results)
  const retryable = results.filter((row) => isRetryableBulkStatus(row.status))
  const locked = busy || disabled
  const targetReady = inviteTargetReady(position, organizationUnitId)
  // Mời Chủ tịch: đếm mọi dòng sẽ gửi lên (hợp lệ + sai định dạng); email trùng chỉ tính một lần.
  const inputPresidentError = presidentEmailCountError(position, inputSummary.valid + inputSummary.invalid)
  const presidentError = presidentEmailCountError(position, summary.valid + summary.invalid)
  // Ô chọn LT chỉ áp khi mời thành viên ban (không phải Chủ tịch) và người mời có quyền cấp Chapter.
  const leadAllowed = canChooseLead && position === 'MEMBER'
  const leadEmail = leadAllowed ? bulkLeadEmail(rows, leadRowId) : null
  const validRows = rows.filter((row) => row.kind === 'valid')

  function toPreview() {
    setError('')
    const next = bulkInviteRowsFromText(text)
    // Quay lại sửa danh sách rồi xem trước lại: giữ LT nếu email đó vẫn hợp lệ trong danh sách mới.
    const previousLead = bulkLeadEmail(rows, leadRowId)
    setLeadRowId(next.find((row) => row.kind === 'valid' && row.email === previousLead)?.id ?? null)
    setRows(next)
    setPhase('preview')
  }

  function editRow(id: number, email: string) {
    const next = classifyBulkInviteRows(rows.map((row) => (row.id === id ? { ...row, email } : row)))
    setRows(next)
    setLeadRowId(bulkLeadRowAfterChange(next, leadRowId, id))
  }

  function removeRow(id: number) {
    const next = classifyBulkInviteRows(rows.filter((row) => row.id !== id))
    setRows(next)
    setLeadRowId(bulkLeadRowAfterChange(next, leadRowId, id))
  }

  /** Gọi API hàng loạt cho một danh sách email; trả về kết quả theo từng email. `lead`: email Trưởng ban nếu có trong danh sách này. */
  async function sendBulk(emails: string[], lead: string | null): Promise<BulkInviteResultItem[] | null> {
    clearApiCache('/api/v1/invitations')
    const res = await postInviteWithPresidentConfirm('/api/v1/invitations/member/bulk', {
      emails,
      ...invitePayload(position, organizationUnitId),
      ...(lead && emails.includes(lead) ? { leadEmail: lead } : {}),
    })
    if (!res) { setError('Đã dừng: bạn chưa xác nhận thay người đang giữ chức vụ. Chưa có lời mời nào được gửi.'); return null }
    if (res.ok && Array.isArray(res.data?.results)) return res.data.results as BulkInviteResultItem[]
    setError(res.error?.code === 'AccessDenied' || res.status === 403
      ? 'Bạn không có quyền mời thành viên vào ban hoặc nhóm này. Chưa có lời mời nào được gửi.'
      : res.error?.message || 'Không gửi được lời mời hàng loạt. Chưa có lời mời nào được gửi.')
    return null
  }

  async function submit() {
    if (!targetReady) { setError(missingScopeMessage); return }
    if (presidentError) { setError(presidentError); return }
    if (!summary.valid) { setError('Danh sách chưa có email hợp lệ nào.'); return }
    if (summary.overLimit) { setError(`Mỗi lần chỉ mời tối đa ${BULK_INVITE_MAX_EMAILS} email. Hãy bỏ bớt email.`); return }
    setBusy(true)
    setError('')
    try {
      // Email sai định dạng đã nằm trong bảng xem trước; chỉ gửi email hợp lệ, phần còn lại báo ở kết quả.
      const sendable = rows.filter((row) => row.kind === 'valid').map((row) => row.email)
      const invalid = rows.filter((row) => row.kind === 'invalid').map((row) => row.email)
      const outcome = await sendBulk(sendable, leadEmail)
      if (!outcome) return
      const merged = [...invalid.map((email) => ({ email, status: 'INVALID' as const })), ...outcome]
      setResults(merged)
      setLinkNotice(null)
      setPhase('results')
      setQuotaRefresh((n) => n + 1)
      if (outcome.some((row) => row.status === 'SENT' || row.status === 'LINK_NEEDED')) onSent?.()
    } finally {
      setBusy(false)
    }
  }

  async function retryFailed() {
    setBusy(true)
    setError('')
    try {
      const updates = new Map<string, BulkInviteResultItem>()
      // Email lỗi hệ thống: chạy lại cả quy trình kiểm tra phía server.
      const failedEmails = retryable.filter((item) => item.status === 'FAILED').map((item) => item.email)
      // Giữ đúng vai Trưởng ban cho email LT nếu nó nằm trong số email thử lại.
      const retryLead = bulkRetryLeadEmail(retryable)
      let bulkRequestFailed = false
      if (failedEmails.length) {
        const outcome = await sendBulk(failedEmails, retryLead)
        if (outcome) outcome.forEach((row) => updates.set(row.email, row))
        else bulkRequestFailed = true // sendBulk đã đặt thông báo lỗi
      }
      if (updates.size) setResults((current) => current.map((row) => updates.get(row.email) || row))
      if (bulkRequestFailed) return
      setQuotaRefresh((n) => n + 1)
      if (bulkRetryChangedAnything(retryable, Array.from(updates.values()))) onSent?.()
      else setError(BULK_INVITE_RETRY_NO_CHANGE_MESSAGE)
    } finally {
      setBusy(false)
    }
  }

  function startOver() {
    setText('')
    setRows([])
    setLeadRowId(null)
    setResults([])
    setError('')
    setLinkNotice(null)
    setPhase('input')
  }

  return (
    <div className="space-y-4" data-testid="bulk-invite-panel">
      <ol className="flex gap-2 text-[11px] font-semibold" aria-label="Các bước">
        {([['input', '1. Dán danh sách'], ['preview', '2. Xem trước'], ['results', '3. Kết quả']] as const).map(([key, label]) => (
          <li key={key} aria-current={phase === key ? 'step' : undefined} className={`rounded-full px-2.5 py-1 ${phase === key ? 'bg-[#2563EB] text-white' : 'bg-[#eff4ff] text-[#434655]'}`}>{label}</li>
        ))}
      </ol>

      {phase === 'input' && (
        <div className="space-y-3">
          <div>
            <label htmlFor="bulk-invite-emails" className="block text-sm font-semibold text-[#172554] mb-1">Danh sách email *</label>
            <textarea
              id="bulk-invite-emails"
              rows={7}
              value={text}
              disabled={locked}
              onChange={(event) => setText(event.target.value)}
              placeholder={'a@bbe.vn\nb@bbe.vn, c@bbe.vn; d@bbe.vn'}
              className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
            <p className="text-[11px] text-[#6c6f7f] mt-1">
              Dán từ Excel hoặc Google Sheets đều được (mỗi dòng một email), hoặc phân tách bằng dấu phẩy, dấu chấm phẩy, khoảng trắng. Tối đa {BULK_INVITE_MAX_EMAILS} email mỗi lần. Tất cả sẽ vào cùng {position === 'PRESIDENT' ? 'chức vụ Chủ tịch Chapter (chỉ 1 email)' : position === 'DEPARTMENT_LEAD' ? 'chức vụ Trưởng ban của ban đã chọn ở trên' : 'ban hoặc nhóm đã chọn ở trên'}.
              {leadAllowed && <> Bạn chọn được 1 Trưởng ban (LT) trong danh sách ở bước Xem trước.</>}
            </p>
            <EmailQuotaNotice quota={quota} className="mt-1" />
            {text.trim() && (
              <p className="text-xs mt-1 text-[#434655]" data-testid="bulk-invite-preview">
                <strong className="text-green-700">{inputSummary.valid}</strong> hợp lệ
                {inputSummary.invalid > 0 && <> · <strong className="text-red-700">{inputSummary.invalid}</strong> sai định dạng</>}
                {inputSummary.duplicate > 0 && <> · <strong>{inputSummary.duplicate}</strong> trùng (bỏ qua)</>}
                {inputSummary.overLimit && <span className="text-red-700"> · vượt quá {BULK_INVITE_MAX_EMAILS} email</span>}
              </p>
            )}
            {inputPresidentError && <p role="alert" data-testid="bulk-invite-president-error" className="mt-1 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{inputPresidentError}</p>}
          </div>
          <div className="flex justify-end gap-3">
            {onClose && <Button variant="outline" type="button" onClick={onClose} disabled={locked}>Hủy</Button>}
            <Button type="button" onClick={toPreview} disabled={locked || !targetReady || !text.trim() || inputSummary.overLimit || Boolean(inputPresidentError)}>
              Xem trước
            </Button>
          </div>
          {!targetReady && <p className="text-xs text-[#434655] text-right">{missingScopeMessage}</p>}
        </div>
      )}

      {phase === 'preview' && (
        <div className="space-y-3">
          <p className="text-xs text-[#434655]" data-testid="bulk-invite-summary">
            <strong className="text-green-700">{summary.valid}</strong> email sẽ được gửi
            {summary.invalid > 0 && <> · <strong className="text-red-700">{summary.invalid}</strong> sai định dạng (sửa hoặc bỏ)</>}
            {summary.duplicate > 0 && <> · <strong>{summary.duplicate}</strong> trùng (bỏ qua)</>}
            {summary.overLimit && <span className="text-red-700"> · vượt quá {BULK_INVITE_MAX_EMAILS} email, hãy bỏ bớt</span>}
            {position !== 'MEMBER' && <> · chức vụ: <strong>{INVITE_POSITION_LABELS[position]}</strong></>}
          </p>
          {presidentError && <p role="alert" data-testid="bulk-invite-president-error" className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{presidentError}</p>}
          {leadAllowed && (
            <div className="space-y-2">
              <label htmlFor="bulk-invite-lead" className="block text-sm font-semibold text-[#172554]">Trưởng ban (LT)</label>
              <select
                id="bulk-invite-lead"
                data-testid="bulk-invite-lead-select"
                value={leadEmail ? String(leadRowId) : ''}
                disabled={locked || !validRows.length}
                onChange={(event) => setLeadRowId(event.target.value ? Number(event.target.value) : null)}
                className="w-full px-3 py-2 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              >
                <option value="">Không chọn ai</option>
                {validRows.map((row) => <option key={row.id} value={String(row.id)}>{row.email}</option>)}
              </select>
              <p className="text-[11px] text-[#6c6f7f]">Mỗi ban chỉ có 1 Trưởng ban. Người được chọn nhận lời mời Trưởng ban, các email còn lại là thành viên ban.</p>
              {leadEmail && departmentLeadWarning && <p role="alert" data-testid="bulk-invite-lead-warning" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">⚠️ {departmentLeadWarning}</p>}
            </div>
          )}
          <EmailQuotaNotice quota={quota} />
          {quota && formatBatchQuotaNotice(summary.valid, quota.remaining) && (
            <p role="status" data-testid="bulk-invite-quota-split" className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {formatBatchQuotaNotice(summary.valid, quota.remaining)} Email dùng link mời vẫn được mời bình thường; bạn lấy link ở bước kết quả để gửi cho họ.
            </p>
          )}
          <ul className="max-h-72 overflow-y-auto border border-[#eff4ff] rounded-xl divide-y divide-[#eff4ff]" data-testid="bulk-invite-rows">
            {rows.length === 0 && <li className="px-3 py-4 text-xs text-[#6c6f7f] text-center">Danh sách trống. Quay lại để dán thêm email.</li>}
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <input
                  aria-label={`Sửa email ${row.email}`}
                  value={row.email}
                  disabled={locked}
                  onChange={(event) => editRow(row.id, event.target.value)}
                  className={`min-w-0 flex-1 basis-full rounded-lg sm:basis-48 border px-2 py-1 text-xs font-mono ${row.kind === 'valid' ? 'border-[#cbdbf5]' : row.kind === 'invalid' ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                />
                <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${ROW_BADGES[row.kind].style}`}>{ROW_BADGES[row.kind].label}</span>
                {leadEmail && row.id === leadRowId && <span data-testid="bulk-invite-lead-badge" className={LT_BADGE}>LT</span>}
                <button type="button" disabled={locked} onClick={() => removeRow(row.id)} aria-label={`Bỏ email ${row.email}`} className="rounded-lg px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">Bỏ</button>
              </li>
            ))}
          </ul>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" disabled={locked} onClick={() => { setError(''); setPhase('input') }}>Quay lại</Button>
            <Button type="button" loading={busy} loadingText="Đang gửi..." onClick={submit} disabled={disabled || !targetReady || !summary.valid || summary.overLimit || Boolean(presidentError)}>
              Gửi {summary.valid || ''} lời mời
            </Button>
          </div>
        </div>
      )}

      {phase === 'results' && (
        <div className="space-y-3">
          <p className="text-xs text-[#434655]" data-testid="bulk-invite-result-summary">
            Đã tạo <strong className="text-green-700">{resultSummary.created}</strong>/{resultSummary.total} lời mời: <strong className="text-green-700">{resultSummary.emailed}</strong> đã gửi email
            {resultSummary.linkNeeded > 0 && <> · <strong className="text-amber-700">{resultSummary.linkNeeded}</strong> chưa gửi mail, cần lấy link mời</>}
            {resultSummary.alreadyMember > 0 && <> · {resultSummary.alreadyMember} đã có tài khoản</>}
            {resultSummary.alreadyInvited > 0 && <> · {resultSummary.alreadyInvited} đã có lời mời đang chờ</>}
            {resultSummary.invalid > 0 && <> · {resultSummary.invalid} sai định dạng</>}
            {resultSummary.denied > 0 && <> · {resultSummary.denied} bị từ chối quyền</>}
            {resultSummary.failed > 0 && <> · <strong className="text-red-700">{resultSummary.failed}</strong> lỗi</>}
          </p>
          <div className="max-h-72 overflow-y-auto border border-[#eff4ff] rounded-xl divide-y divide-[#eff4ff]" data-testid="bulk-invite-results">
            {results.map((row) => (
              <div key={row.email} className="flex flex-col gap-1 px-3 py-2 text-xs sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                {/* Điện thoại: email một dòng riêng, cuộn ngang nếu rất dài thay vì bẻ giữa chữ; từ sm trở lên: cạnh nhãn như cũ. */}
                <span title={row.email} className="min-w-0 overflow-x-auto whitespace-nowrap font-semibold text-[#172554] sm:overflow-visible sm:whitespace-normal sm:break-all">
                  {row.email}
                  {row.positionCode === 'DEPARTMENT_LEAD' && <span data-testid="bulk-invite-result-lead-badge" className={`ml-2 inline-block align-middle ${LT_BADGE}`}>LT</span>}
                </span>
                <span className="sm:shrink-0 sm:text-right">
                  <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full font-bold ${STATUS_STYLES[row.status]}`}>{BULK_INVITE_STATUS_LABELS[row.status]}</span>
                  {row.message && row.status !== 'ALREADY_MEMBER' && <span className="block text-[11px] text-[#6c6f7f] mt-0.5">{row.message}</span>}
                  {row.status === 'LINK_NEEDED' && row.invitationId && (
                    <span className="mt-1 block">
                      <InviteLinkButton invitationId={row.invitationId} email={row.email} disabled={locked} onMessage={(type, text) => setLinkNotice({ type, text })} />
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
          {linkNotice && <p role={linkNotice.type === 'error' ? 'alert' : 'status'} data-testid="bulk-invite-link-notice" className={`text-xs ${linkNotice.type === 'error' ? 'text-red-700' : 'text-green-700'}`}>{linkNotice.text}</p>}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap justify-end gap-3">
            {retryable.length > 0 && (
              <Button variant="secondary" type="button" loading={busy} loadingText="Đang thử lại..." onClick={retryFailed}>
                Thử lại {retryable.length} email lỗi
              </Button>
            )}
            <Button variant="outline" type="button" disabled={busy} onClick={startOver}>Mời thêm</Button>
            {onClose && <Button variant="outline" type="button" disabled={busy} onClick={onClose}>Đóng</Button>}
          </div>
        </div>
      )}
    </div>
  )
}
