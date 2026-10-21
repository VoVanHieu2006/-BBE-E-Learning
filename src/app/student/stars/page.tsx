'use client'

import { useEffect, useState } from 'react'
import LearningPeriodSummary from '@/components/learning/LearningPeriodSummary'
import { apiFetch } from '@/lib/api/client'

type StarEntry = {
  id: string
  amount: number
  reason: string
  source_type: string
  awarded_at: string
  lessonTitle?: string | null
  courseTitle?: string | null
  quizTitle?: string | null
  detail?: string
}

type StarHistoryResponse = {
  balance: number
  items: StarEntry[]
  page: number
  limit: number
  totalItems: number
  totalPages: number
}

const PAGE_SIZE = 20

const reasonLabels: Record<string, string> = {
  VIDEO_COMPLETION: 'Hoàn thành video bài học',
  MODULE_QUIZ_PASS: 'Vượt qua bài kiểm tra',
  MODULE_QUIZ_BONUS: 'Thưởng kết quả bài kiểm tra',
  COURSE_FINAL_PASS: 'Hoàn thành bài thi cuối khóa',
  COURSE_FINAL_BONUS: 'Thưởng kết quả bài thi cuối khóa',
  ADMIN_ADJUSTMENT: 'Điều chỉnh Star',
}

function formatAwardedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Thời gian không xác định'
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export default function StudentStarsPage() {
  const [page, setPage] = useState(1)
  const [reload, setReload] = useState(0)
  const [history, setHistory] = useState<StarHistoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')

    apiFetch<StarHistoryResponse>(`/api/v1/stars/me?page=${page}&limit=${PAGE_SIZE}`, { noCache: true })
      .then((result) => {
        if (!current) return
        if (!result.ok || !result.data) {
          setError(result.error?.message || 'Không thể tải lịch sử Star lúc này.')
          return
        }
        setHistory(result.data)
      })
      .catch(() => {
        if (current) setError('Không thể kết nối để tải lịch sử Star.')
      })
      .finally(() => {
        if (current) setLoading(false)
      })

    return () => { current = false }
  }, [page, reload])

  const totalPages = Math.max(history?.totalPages || 1, 1)

  return (
    <main className="mx-auto w-full max-w-5xl">
      <header className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
      <LearningPeriodSummary />
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.16em] text-blue-600">Thành tích học tập</p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Lịch sử Star
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
            Theo dõi chi tiết số Star bạn nhận được khi hoàn thành từng video bài giảng và vượt qua các bài kiểm tra.
          </p>
        </div>

        <section aria-label="Tổng số Star hiện có" className="flex items-center gap-4 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white px-5 py-4 shadow-sm">
          <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-xl bg-amber-100 text-3xl animate-pulse">⭐</span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">Số Star hiện tại</p>
            <p className="text-2xl font-extrabold tabular-nums text-slate-900" aria-live="polite">
              {loading && !history ? '—' : (history?.balance ?? 0).toLocaleString('vi-VN')} <span className="text-base font-bold text-amber-700">Star</span>
            </p>
          </div>
        </section>
      </header>

      <section aria-labelledby="star-entries-title" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-1 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <h2 id="star-entries-title" className="font-bold text-slate-900">Lịch sử nhận gần đây</h2>
          <p className="text-sm font-medium text-slate-500">
            {history ? `Số lượt nhận: ${history.totalItems.toLocaleString('vi-VN')}` : ' '}
          </p>
        </div>

        {loading ? (
          <div role="status" className="space-y-3 p-5 sm:p-6">
            <span className="sr-only">Đang tải lịch sử Star…</span>
            {[0, 1, 2, 3].map((item) => <div key={item} className="h-[72px] animate-pulse rounded-xl bg-slate-100" />)}
          </div>
        ) : error ? (
          <div role="alert" className="p-8 text-center">
            <p className="font-semibold text-rose-700">{error}</p>
            <button type="button" onClick={() => setReload((current) => current + 1)} className="mt-3 rounded-lg px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50">
              Thử tải lại
            </button>
          </div>
        ) : !history?.items.length ? (
          <div className="p-10 text-center">
            <div aria-hidden="true" className="mb-3 text-4xl">✨</div>
            <p className="font-semibold text-slate-900">Bạn chưa có lượt nhận Star nào</p>
            <p className="mt-1 text-sm text-slate-500">Hãy hoàn thành video hoặc vượt qua bài kiểm tra để nhận Star đầu tiên.</p>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {history.items.map((entry) => {
                const positive = entry.amount > 0
                return (
                  <li key={entry.id} className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-slate-50/80 sm:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                      <span aria-hidden="true" className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg ${positive ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-600'}`}>
                        {positive ? '⭐' : '↩'}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">
                          {entry.detail || reasonLabels[entry.reason] || 'Nhận Star'}
                        </p>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                          <span>{formatAwardedAt(entry.awarded_at)}</span>
                          {entry.courseTitle && entry.detail && !entry.detail.includes(entry.courseTitle) && (
                            <>
                              <span>•</span>
                              <span className="truncate text-blue-700 font-medium">{entry.courseTitle}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <span className={`shrink-0 text-base font-extrabold tabular-nums ${positive ? 'text-emerald-700' : 'text-slate-600'}`}>
                      {positive ? '+' : ''}{entry.amount} ⭐
                    </span>
                  </li>
                )
              })}
            </ul>

            {totalPages > 1 && (
              <nav aria-label="Phân trang lịch sử Star" className="flex items-center justify-between border-t border-slate-100 px-5 py-4 sm:px-6">
                <p className="text-sm text-slate-500">Trang {page} / {totalPages}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPage((current) => Math.max(current - 1, 1))} disabled={page <= 1} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                    Trước
                  </button>
                  <button type="button" onClick={() => setPage((current) => Math.min(current + 1, totalPages))} disabled={page >= totalPages} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                    Tiếp
                  </button>
                </div>
              </nav>
            )}
          </>
        )}
      </section>
    </main>
  )
}
