'use client'
import { useState } from 'react'
import { apiFetch, clearApiCache } from '@/lib/api/client'

type Scope = { lessonId: string }

/**
 * "Xem lại tháng này": mở lượt xem thưởng của tháng cho đúng bài này (KHBB 8).
 * Sang tháng mới các bài đã xong vẫn xem tự do; chỉ khi bấm nút này mới tính lại Star của tháng.
 */
export default function MonthlyReviewButton({ scope, monthLabel, label, compact, onDone }: {
  scope: Scope
  monthLabel?: string
  label?: string
  compact?: boolean
  onDone?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  async function start() {
    if (busy) return
    setBusy(true)
    setNotice(null)
    const res = await apiFetch('/api/v1/learning/monthly-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scope),
      noCache: true,
    })
    setBusy(false)
    if (res.ok && res.data) {
      clearApiCache()
      setNotice({ ok: true, text: res.data.message })
      onDone?.()
    } else {
      setNotice({ ok: false, text: res.error?.message || res.data?.message || 'Không mở được lượt xem lại. Vui lòng thử lại.' })
    }
  }

  return (
    <div className={compact ? 'flex flex-col gap-1.5' : 'flex flex-col gap-2'}>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#2563EB] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#1d4ed8] disabled:opacity-60"
      >
        {busy ? 'Đang mở...' : label || `Xem lại${monthLabel ? ` ${monthLabel}` : ' tháng này'}`}
      </button>
      {notice && (
        <p role="status" className={`text-[11px] leading-snug ${notice.ok ? 'text-emerald-700' : 'text-red-600'}`}>{notice.text}</p>
      )}
    </div>
  )
}
