'use client'
import { useState } from 'react'
import Button from '@/components/ui/Button'
import { apiFetch, clearApiCache } from '@/lib/api/client'
import {
  BULK_INVITE_MAX_EMAILS,
  BULK_INVITE_RETRY_NO_CHANGE_MESSAGE,
  BULK_INVITE_STATUS_LABELS,
  BulkInviteResultItem,
  BulkInviteRow,
  BulkInviteStatus,
  bulkInviteRowsFromText,
  bulkRetryChangedAnything,
  resolveResendOutcome,
  classifyBulkInviteRows,
  isRetryableBulkStatus,
  summarizeBulkInviteRows,
  summarizeBulkResults,
} from '@/lib/bulk-invite'

const STATUS_STYLES: Record<BulkInviteStatus, string> = {
  SENT: 'bg-green-100 text-green-800',
  SENT_EMAIL_FAILED: 'bg-amber-100 text-amber-800',
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
  /** Hiện trên nút khi chưa chọn được ban/nhóm. */
  missingScopeMessage: string
  /** Gọi sau khi có ít nhất một lời mời được tạo, để trang tải lại danh sách. */
  onSent?: () => void
  onClose?: () => void
  /** Tắt toàn bộ ô nhập, ví dụ khi form cha đang bận. */
  disabled?: boolean
}

/**
 * Mời nhiều email một lần (dùng cho LEAD Chapter và DNA). Ba bước: dán danh sách,
 * xem trước/sửa/bỏ, rồi xem kết quả từng email và thử lại riêng email lỗi.
 * Mọi kiểm tra quyền và nghiệp vụ nằm ở /api/v1/invitations/member/bulk.
 */
export default function BulkInvitePanel({ organizationUnitId, missingScopeMessage, onSent, onClose, disabled }: Props) {
  const [phase, setPhase] = useState<Phase>('input')
  const [text, setText] = useState('')
  const [rows, setRows] = useState<BulkInviteRow[]>([])
  const [results, setResults] = useState<BulkInviteResultItem[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const inputSummary = summarizeBulkInviteRows(bulkInviteRowsFromText(text))
  const summary = summarizeBulkInviteRows(rows)
  const resultSummary = summarizeBulkResults(results)
  const retryable = results.filter((row) => isRetryableBulkStatus(row.status))
  const locked = busy || disabled

  function toPreview() {
    setError('')
    setRows(bulkInviteRowsFromText(text))
    setPhase('preview')
  }

  function editRow(id: number, email: string) {
    setRows((current) => classifyBulkInviteRows(current.map((row) => (row.id === id ? { ...row, email } : row))))
  }

  function removeRow(id: number) {
    setRows((current) => classifyBulkInviteRows(current.filter((row) => row.id !== id)))
  }

  /** Gọi API hàng loạt cho một danh sách email; trả về kết quả theo từng email. */
  async function sendBulk(emails: string[]): Promise<BulkInviteResultItem[] | null> {
    clearApiCache('/api/v1/invitations')
    const res = await apiFetch('/api/v1/invitations/member/bulk', {
      method: 'POST',
      body: JSON.stringify({ emails, organizationUnitId }),
      noCache: true,
    })
    if (res.ok && Array.isArray(res.data?.results)) return res.data.results as BulkInviteResultItem[]
    setError(res.error?.code === 'AccessDenied' || res.status === 403
      ? 'Bạn không có quyền mời thành viên vào ban hoặc nhóm này. Chưa có lời mời nào được gửi.'
      : res.error?.message || 'Không gửi được lời mời hàng loạt. Chưa có lời mời nào được gửi.')
    return null
  }

  async function submit() {
    if (!organizationUnitId) { setError(missingScopeMessage); return }
    if (!summary.valid) { setError('Danh sách chưa có email hợp lệ nào.'); return }
    if (summary.overLimit) { setError(`Mỗi lần chỉ mời tối đa ${BULK_INVITE_MAX_EMAILS} email. Hãy bỏ bớt email.`); return }
    setBusy(true)
    setError('')
    try {
      // Email sai định dạng đã nằm trong bảng xem trước; chỉ gửi email hợp lệ, phần còn lại báo ở kết quả.
      const sendable = rows.filter((row) => row.kind === 'valid').map((row) => row.email)
      const invalid = rows.filter((row) => row.kind === 'invalid').map((row) => row.email)
      const outcome = await sendBulk(sendable)
      if (!outcome) return
      const merged = [...invalid.map((email) => ({ email, status: 'INVALID' as const })), ...outcome]
      setResults(merged)
      setPhase('results')
      if (outcome.some((row) => row.status === 'SENT' || row.status === 'SENT_EMAIL_FAILED')) onSent?.()
    } finally {
      setBusy(false)
    }
  }

  async function retryFailed() {
    setBusy(true)
    setError('')
    try {
      const updates = new Map<string, BulkInviteResultItem>()
      // Lời mời đã lưu nhưng mail lỗi: gửi lại bằng chức năng gửi lại của từng lời mời (cùng quyền).
      for (const row of retryable.filter((item) => item.status === 'SENT_EMAIL_FAILED')) {
        const res = row.invitationId
          ? await apiFetch(`/api/v1/invitations/${row.invitationId}/resend`, { method: 'POST', noCache: true })
          : null
        updates.set(row.email, resolveResendOutcome(row, res))
      }
      // Email lỗi hệ thống: chạy lại cả quy trình kiểm tra phía server.
      const failedEmails = retryable.filter((item) => item.status === 'FAILED').map((item) => item.email)
      let bulkRequestFailed = false
      if (failedEmails.length) {
        const outcome = await sendBulk(failedEmails)
        if (outcome) outcome.forEach((row) => updates.set(row.email, row))
        else bulkRequestFailed = true // sendBulk đã đặt thông báo lỗi
      }
      if (updates.size) setResults((current) => current.map((row) => updates.get(row.email) || row))
      if (bulkRequestFailed) return
      if (bulkRetryChangedAnything(retryable, Array.from(updates.values()))) onSent?.()
      else setError(BULK_INVITE_RETRY_NO_CHANGE_MESSAGE)
    } finally {
      setBusy(false)
    }
  }

  function startOver() {
    setText('')
    setRows([])
    setResults([])
    setError('')
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
            <p className="text-[11px] text-[#737686] mt-1">
              Dán từ Excel hoặc Google Sheets đều được (mỗi dòng một email), hoặc phân tách bằng dấu phẩy, dấu chấm phẩy, khoảng trắng. Tối đa {BULK_INVITE_MAX_EMAILS} email mỗi lần. Tất cả sẽ vào cùng ban hoặc nhóm đã chọn ở trên.
            </p>
            {text.trim() && (
              <p className="text-xs mt-1 text-[#434655]" data-testid="bulk-invite-preview">
                <strong className="text-green-700">{inputSummary.valid}</strong> hợp lệ
                {inputSummary.invalid > 0 && <> · <strong className="text-red-700">{inputSummary.invalid}</strong> sai định dạng</>}
                {inputSummary.duplicate > 0 && <> · <strong>{inputSummary.duplicate}</strong> trùng (bỏ qua)</>}
                {inputSummary.overLimit && <span className="text-red-700"> · vượt quá {BULK_INVITE_MAX_EMAILS} email</span>}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-3">
            {onClose && <Button variant="outline" type="button" onClick={onClose} disabled={locked}>Hủy</Button>}
            <Button type="button" onClick={toPreview} disabled={locked || !organizationUnitId || !text.trim() || inputSummary.overLimit}>
              Xem trước
            </Button>
          </div>
          {!organizationUnitId && <p className="text-xs text-[#434655] text-right">{missingScopeMessage}</p>}
        </div>
      )}

      {phase === 'preview' && (
        <div className="space-y-3">
          <p className="text-xs text-[#434655]" data-testid="bulk-invite-summary">
            <strong className="text-green-700">{summary.valid}</strong> email sẽ được gửi
            {summary.invalid > 0 && <> · <strong className="text-red-700">{summary.invalid}</strong> sai định dạng (sửa hoặc bỏ)</>}
            {summary.duplicate > 0 && <> · <strong>{summary.duplicate}</strong> trùng (bỏ qua)</>}
            {summary.overLimit && <span className="text-red-700"> · vượt quá {BULK_INVITE_MAX_EMAILS} email, hãy bỏ bớt</span>}
          </p>
          <ul className="max-h-72 overflow-y-auto border border-[#eff4ff] rounded-xl divide-y divide-[#eff4ff]" data-testid="bulk-invite-rows">
            {rows.length === 0 && <li className="px-3 py-4 text-xs text-[#737686] text-center">Danh sách trống. Quay lại để dán thêm email.</li>}
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
                <button type="button" disabled={locked} onClick={() => removeRow(row.id)} aria-label={`Bỏ email ${row.email}`} className="rounded-lg px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">Bỏ</button>
              </li>
            ))}
          </ul>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" disabled={locked} onClick={() => { setError(''); setPhase('input') }}>Quay lại</Button>
            <Button type="button" loading={busy} loadingText="Đang gửi..." onClick={submit} disabled={disabled || !organizationUnitId || !summary.valid || summary.overLimit}>
              Gửi {summary.valid || ''} lời mời
            </Button>
          </div>
        </div>
      )}

      {phase === 'results' && (
        <div className="space-y-3">
          <p className="text-xs text-[#434655]" data-testid="bulk-invite-result-summary">
            Đã gửi <strong className="text-green-700">{resultSummary.sent}</strong>/{resultSummary.total} lời mời
            {resultSummary.emailFailed > 0 && <> · <strong className="text-amber-700">{resultSummary.emailFailed}</strong> chưa gửi được email</>}
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
                <span title={row.email} className="min-w-0 overflow-x-auto whitespace-nowrap font-semibold text-[#172554] sm:overflow-visible sm:whitespace-normal sm:break-all">{row.email}</span>
                <span className="sm:shrink-0 sm:text-right">
                  <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full font-bold ${STATUS_STYLES[row.status]}`}>{BULK_INVITE_STATUS_LABELS[row.status]}</span>
                  {row.message && row.status !== 'ALREADY_MEMBER' && <span className="block text-[10px] text-[#737686] mt-0.5">{row.message}</span>}
                </span>
              </div>
            ))}
          </div>
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
