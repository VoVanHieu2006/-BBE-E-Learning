'use client'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api/client'

export default function PeriodLeaderboard() {
  const [group, setGroup] = useState('MEMBER'), [periodType, setPeriodType] = useState('MONTH')
  const [data, setData] = useState<any>(null), [error, setError] = useState(false), [retry, setRetry] = useState(0)
  const [catalog, setCatalog] = useState<any>(null), [periodId, setPeriodId] = useState('')
  useEffect(() => { apiFetch<any>('/api/v1/learning/periods').then((response) => { if (response.ok) setCatalog(response.data) }).catch(() => {}) }, [])
  useEffect(() => { setPeriodId('') }, [group, periodType])
  useEffect(() => {
    let live = true
    setData(null); setError(false)
    apiFetch<any>(`/api/v1/leaderboard?group=${group}&periodType=${periodType}${periodId ? `&periodId=${encodeURIComponent(periodId)}` : ''}`).then((response) => {
      if (!live) return
      if (response.ok) setData(response.data); else setError(true)
    }).catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [group, periodType, periodId, retry])
  const states: Record<string, string> = { FINALIZED: 'Kết quả đã chốt.', WAITING_KPI: 'Dữ liệu học tập và sao đã chốt; đang chờ KPI.', AWAITING_CUTOVER: 'Chờ kích hoạt sau khi mapping được duyệt.', PERIOD_UNAVAILABLE: 'Chưa có kỳ phù hợp.', AWAITING_SNAPSHOT: 'Kỳ đã kết thúc, đang chờ chốt kết quả.', AWAITING_STAGE_SNAPSHOTS: 'Đang chờ chốt giai đoạn để tính điểm Chapter.', OPEN: 'Kết quả tạm tính trong kỳ.' }
  return <section aria-label="Bảng xếp hạng theo kỳ" className="space-y-4 rounded-xl border bg-white p-4 sm:p-6">
    <h2 className="text-xl font-bold text-slate-900">Bảng xếp hạng theo kỳ</h2>
    <div className="flex flex-wrap gap-2">{[['MEMBER', 'Thành viên'], ['LT', 'LT'], ['DNA', 'DNA'], ['CHAPTER', 'Chapter']].map(([key, label]) => <button key={key} aria-pressed={group === key} onClick={() => setGroup(key)} className={`rounded-lg px-4 py-2 text-sm ${group === key ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-800'}`}>{label}</button>)}</div>
    <div className="flex gap-2">{[['MONTH', 'Tháng'], ['TERM', 'Nhiệm kỳ']].map(([key, label]) => <button key={key} aria-pressed={periodType === key} onClick={() => setPeriodType(key)} className={`rounded-lg border px-4 py-2 text-sm ${periodType === key ? 'border-blue-600 text-blue-800' : 'text-slate-600'}`}>{label}</button>)}</div>
    <label className="block text-sm font-medium">Kỳ cụ thể<select value={periodId} onChange={(event) => setPeriodId(event.target.value)} className="mt-1 block w-full rounded-lg border p-2 sm:max-w-md"><option value="">Kỳ hiện tại trong phạm vi của bạn</option>{(periodType === 'MONTH' ? catalog?.months || [] : group === 'DNA' || group === 'CHAPTER' ? catalog?.seasons || [] : catalog?.terms || []).map((period: any) => <option key={period.id} value={periodType === 'MONTH' ? period.key : period.id}>{period.key || period.code || `${period.chapterName} · ${new Date(period.starts_at).toLocaleDateString('vi-VN')}`}</option>)}</select></label>
    {error ? <p role="alert">Không tải được bảng. <button className="text-blue-700" onClick={() => setRetry((value) => value + 1)}>Thử lại</button></p> : !data ? <p aria-busy="true">Đang tải…</p> : <>
      <p role="status" className="text-sm text-slate-600">{states[data.state] || data.state}</p>
      {data.formula && <p className="text-xs text-slate-500">{data.formula}</p>}
      {data.items?.length > 0 && <ol className="divide-y">{data.items.map((item: any) => <li key={item.userId || item.chapterId} className="flex items-center gap-3 py-3"><span className="w-8 font-bold text-blue-800">{item.rank ? `#${item.rank}` : '—'}</span><div className="min-w-0 flex-1"><p className="truncate font-semibold">{item.displayName || item.chapterName}</p><p className="text-xs text-slate-500">{item.eligible === false ? 'Chưa đủ điều kiện xếp hạng' : item.chapterName}</p></div><span className="font-bold text-amber-600">★ {Number(item.stars ?? item.score).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}</span></li>)}</ol>}
    </>}
  </section>
}
