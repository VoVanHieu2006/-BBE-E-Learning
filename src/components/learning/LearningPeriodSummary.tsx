'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/client'

export default function LearningPeriodSummary() {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let live = true
    setError(false)
    apiFetch<any>('/api/v1/learning/me').then((result) => {
      if (!live) return
      if (result.ok) setData(result.data); else setError(true)
    }).catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [retry])
  if (error) return <div role="alert" className="rounded-xl border border-red-100 p-4 text-sm">Chưa tải được kỳ học. <button className="font-semibold text-blue-700" onClick={() => setRetry((value) => value + 1)}>Thử lại</button></div>
  if (!data) return <div aria-busy="true" className="animate-pulse rounded-xl bg-slate-100 p-6">Đang tải kỳ học…</div>
  if (!data.active) return <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">Cơ chế tháng và chu kỳ mới chưa được kích hoạt. Sao và tiến độ hiện có được giữ trong lịch sử.</div>
  const date = (value: string) => new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium' }).format(new Date(value))
  return <section aria-label="Kỳ học và sao" className="space-y-3">
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{[
      ['Sao tháng', data.stars.month], ['Sao chu kỳ', data.stars.cycle], ['Sao lịch sử', data.stars.history],
    ].map(([label, amount]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-sm text-slate-600">{label}</p><p className="mt-1 text-2xl font-bold text-amber-600">★ {amount}</p></div>)}</div>
    <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-xl bg-blue-50 p-4 text-sm text-blue-950">
      <p>Chu kỳ từ {date(data.cycle.starts_at)}</p>
      <p>{data.path?.dueAt ? `Hạn chung lộ trình: ${date(data.path.dueAt)}` : 'Hiện không có hạn chung cần thực thi'}</p>
      {data.rewardsPaused && <p role="status">{data.rewardState?.paused ? 'Chapter chưa chuyển giao mùa hiện tại: vẫn học bình thường, tạm dừng sao và không cộng bù.' : 'Tài khoản đang tạm dừng nhận sao.'}</p>}
      <p>Replay tháng: {data.replay.filter((row: any) => row.completed_at).length} video hoàn tất.</p>
    </div>
    {data.notices?.map((notice: any) => <div key={notice.id} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><p className="font-semibold">{notice.title}</p><p className="mt-1">{notice.body}</p></div>)}
  </section>
}
