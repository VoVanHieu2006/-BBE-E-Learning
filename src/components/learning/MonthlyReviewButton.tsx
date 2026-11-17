'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { apiFetch, clearApiCache } from '@/lib/api/client'
import type { MonthlyReviewState } from '@/lib/monthly-review-state'

type Scope = { lessonId: string }

/**
 * "Xem lại tháng này": mở lượt xem thưởng của tháng cho đúng bài này (KHBB 8).
 * Sang tháng mới các bài đã xong vẫn xem tự do; chỉ khi bấm nút này mới tính lại Star của tháng.
 */
export default function MonthlyReviewButton({ scope, monthLabel, label, compact, state = 'AVAILABLE', onDone }: {
  scope: Scope
  monthLabel?: string
  label?: string
  compact?: boolean
  state?: MonthlyReviewState
  onDone?: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const busyRef = useRef(false)
  const startedRef = useRef(false)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    if (open) dialogRef.current?.showModal()
  }, [open])

  async function start() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setNotice(null)
    try {
      if (!startedRef.current) {
        const res = await apiFetch('/api/v1/learning/monthly-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(scope),
          noCache: true,
        })
        if (!res.ok || !res.data) throw new Error(res.error?.message || res.data?.message || 'Không mở được lượt xem lại. Vui lòng thử lại.')
        startedRef.current = true
        clearApiCache()
      }
      await onDone?.()
      dialogRef.current?.close()
      setOpen(false)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Không mở được lượt xem lại. Vui lòng thử lại.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setNotice(null); setOpen(true) }}
        disabled={busy || state !== 'AVAILABLE'}
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-[#2563EB] px-2.5 font-bold text-white transition hover:bg-[#1d4ed8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:bg-slate-100 disabled:text-slate-600 disabled:cursor-not-allowed ${compact ? 'max-w-[58%] py-1 text-[10px] leading-tight' : 'py-2 text-xs'}`}
      >
        {busy ? 'Đang mở...' : state === 'AWARDED' ? 'Tháng sau mới xem lại được' : state === 'STARTED' ? 'Đã bấm xem lại tháng này' : label || 'Xem lại tháng này'}
      </button>
      {open && createPortal(
        <dialog
          ref={dialogRef}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          aria-busy={busy}
          onCancel={(event) => { if (busyRef.current) event.preventDefault() }}
          onClose={() => setOpen(false)}
          className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-[#eff4ff] bg-white p-6 text-[#172554] shadow-xl backdrop:bg-slate-950/50"
        >
          <h2 id={titleId} className="text-lg font-bold">Xem lại bài này trong {monthLabel ? `tháng ${monthLabel}` : 'tháng này'}?</h2>
          <p id={descriptionId} className="mt-3 text-sm leading-relaxed">
            Video sẽ bắt đầu lại từ 0:00, không tua được, quiz cần làm lại để nhận Star tháng này. Tiến độ nhiệm kỳ vẫn giữ Hoàn thành.
          </p>
          {notice && <p role="alert" className="mt-3 text-sm text-red-700">{notice}</p>}
          <div className="mt-5 flex justify-end gap-3">
            <button autoFocus type="button" disabled={busy} onClick={() => dialogRef.current?.close()} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50">Hủy</button>
            <button type="button" disabled={busy} onClick={start} className="rounded-full bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'Đang tải...' : startedRef.current ? 'Tải lại tiến độ' : 'Xác nhận'}
            </button>
          </div>
        </dialog>, document.body,
      )}
    </>
  )
}
