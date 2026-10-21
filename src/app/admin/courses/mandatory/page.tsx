'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import Toast, { ToastMessage } from '@/components/ui/Toast'
import { apiFetch } from '@/lib/api/client'

export default function MandatoryCourseMatrixPage() {
  const [data, setData] = useState<any>(null)
  const [draft, setDraft] = useState<any>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [saving, setSaving] = useState(false)
  const [rowDays, setRowDays] = useState<Record<string, number>>({})
  const load = async () => {
    const res = await apiFetch('/api/v1/admin/mandatory-matrix', { noCache: true })
    if (res.ok) { setData(res.data); setDraft(structuredClone(res.data.cells)); setRowDays(Object.fromEntries(res.data.courses.map((course:any)=>[course.id, course.defaultDueDays || 30]))) }
    else setToast({ type: 'error', message: res.error?.message || 'Không tải được ma trận.' })
  }
  useEffect(() => { void load() }, [])
  const changes = useMemo(() => {
    if (!data || !draft) return []
    return data.courses.flatMap((course: any) => data.targets.flatMap((target: any) => {
      const before = data.cells[course.id][target.key]
      const after = draft[course.id][target.key]
      const enabledChanged = before.enabled !== after.enabled
      const enabledDueDaysChanged = after.enabled && Number(before.dueDays || 30) !== Number(after.dueDays || 30)
      return enabledChanged || enabledDueDaysChanged ? [{ courseId: course.id, targetKey: target.key, enabled: after.enabled, dueDays: Number(after.dueDays || 30) }] : []
    }))
  }, [data, draft])
  const rowDefaults = useMemo(() => data ? data.courses.filter((course:any)=>Number(rowDays[course.id]||30)!==Number(course.defaultDueDays||30)).map((course:any)=>({courseId:course.id,dueDays:Number(rowDays[course.id]||30)})) : [], [data,rowDays])
  const setCell = (courseId: string, targetKey: string, patch: any) => setDraft((current: any) => ({ ...current, [courseId]: { ...current[courseId], [targetKey]: { ...current[courseId][targetKey], ...patch } } }))
  const syncRowDays = (courseId: string) => setDraft((current: any) => ({
    ...current,
    [courseId]: Object.fromEntries(data.targets.map((target: any) => [
      target.key,
      { ...current[courseId][target.key], dueDays: rowDays[courseId] || 30 },
    ])),
  }))
  const setRowEnabled = (course: any, enabled: boolean) => setDraft((current: any) => ({
    ...current,
    [course.id]: Object.fromEntries(data.targets.map((target: any) => {
      const cell = current[course.id][target.key]
      return [target.key, { ...cell, enabled, dueDays: cell.dueDays || rowDays[course.id] || course.defaultDueDays || 30 }]
    })),
  }))
  const setColumnEnabled = (targetKey: string, enabled: boolean) => setDraft((current: any) => ({
    ...current,
    ...Object.fromEntries(data.courses.map((course: any) => {
      const cell = current[course.id][targetKey]
      return [course.id, {
        ...current[course.id],
        [targetKey]: { ...cell, enabled, dueDays: cell.dueDays || rowDays[course.id] || course.defaultDueDays || 30 },
      }]
    })),
  }))
  const save = async () => {
    if (!changes.length && !rowDefaults.length) return
    setSaving(true)
    try {
      const res = await apiFetch('/api/v1/admin/mandatory-matrix', { method: 'PUT', body: JSON.stringify({ changes, rowDefaults }) })
      if (res.ok) {
        setData((current: any) => ({
          ...current,
          cells: structuredClone(draft),
          courses: current.courses.map((course: any) => ({
            ...course,
            defaultDueDays: rowDays[course.id] || course.defaultDueDays,
          })),
        }))
        setToast({ type: 'success', message: `Đã lưu cấu hình bắt buộc.` })
      }
      else setToast({ type: 'error', message: res.error?.message || 'Không lưu được cấu hình.' })
    } finally { setSaving(false) }
  }
  return <><Toast toast={toast} onClose={() => setToast(null)}/>
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-bold text-[#172554]">Ma trận khóa học bắt buộc</h1><p className="mt-1 text-sm text-[#737686]">Chỉnh nhiều ô rồi bấm Lưu thay đổi một lần để hệ thống cập nhật nhanh và ổn định.</p></div><div className="flex gap-2"><Link href="/admin/courses"><Button variant="outline">← Khóa học</Button></Link><Button loading={saving} disabled={!changes.length&&!rowDefaults.length} onClick={save}>Lưu thay đổi {(changes.length+rowDefaults.length) ? `(${changes.length+rowDefaults.length})` : ''}</Button></div></div>
    {changes.length > 0 && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">Có {changes.length} thay đổi chưa lưu.</div>}
    <div className="space-y-3 md:hidden">{data?.courses?.map((course: any) => <details key={course.id} className="rounded-xl border bg-white p-4">
      <summary className="cursor-pointer font-semibold text-slate-900">{course.title}</summary>
      <label className="mt-3 flex items-center gap-2 text-sm">Ngân sách chung <input aria-label={`Ngày học ${course.title}`} type="number" min={1} max={3650} value={rowDays[course.id] || 30} onChange={(event) => setRowDays((current) => ({ ...current, [course.id]: Number(event.target.value) }))} className="w-20 rounded-lg border p-2" /> ngày</label>
      <div className="mt-3 grid gap-2">{data.targets.map((target: any) => <label key={target.key} className="flex items-center gap-3 rounded-lg bg-slate-50 p-3 text-sm"><input type="checkbox" checked={Boolean(draft?.[course.id]?.[target.key]?.enabled)} onChange={(event) => setCell(course.id, target.key, { enabled: event.target.checked, dueDays: rowDays[course.id] || 30 })} />{target.label}</label>)}</div>
    </details>)}</div>
    <Card className="hidden overflow-x-auto p-0 md:block">
      <table className="min-w-[900px] w-full text-sm">
        <thead className="sticky top-0 z-20 bg-[#172554] text-white">
          <tr>
            <th className="sticky left-0 z-30 min-w-[240px] bg-[#172554] px-4 py-3 text-left">Khóa học / Đồng bộ ngày</th>
            {data?.targets?.map((target: any) => {
              const allEnabled = data.courses.length > 0 && data.courses.every((course: any) => draft?.[course.id]?.[target.key]?.enabled)
              return <th key={target.key} className="min-w-[130px] px-3 py-3 text-center">
                <div>{target.label}</div>
                <button type="button" onClick={() => setColumnEnabled(target.key, !allEnabled)} className="mt-2 whitespace-nowrap rounded-md bg-white/15 px-2 py-1 text-[11px] font-semibold hover:bg-white/25">
                  {allEnabled ? 'Bỏ tick cả cột' : 'Tick cả cột'}
                </button>
              </th>
            })}
          </tr>
        </thead>
        <tbody className="divide-y">
          {data?.courses?.map((course: any) => {
            const allEnabled = data.targets.length > 0 && data.targets.every((target: any) => draft?.[course.id]?.[target.key]?.enabled)
            return <tr key={course.id}>
              <td className="sticky left-0 z-10 bg-white px-4 py-3">
                <p className="font-semibold text-[#172554]">{course.title}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="number" min={1} max={3650} value={rowDays[course.id] || 30} onChange={e => setRowDays(v => ({ ...v, [course.id]: Number(e.target.value) }))} className="w-20 rounded-lg border px-2 py-1 text-center"/>
                  <span className="text-xs text-slate-500">ngày</span>
                  <button type="button" onClick={() => syncRowDays(course.id)} className="rounded-lg bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100">Đồng bộ cả dòng</button>
                  <button type="button" onClick={() => setRowEnabled(course, !allEnabled)} className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-200">
                    {allEnabled ? 'Bỏ tick cả dòng' : 'Tick cả dòng'}
                  </button>
                </div>
              </td>
              {data.targets.map((target: any) => {
                const cell = draft?.[course.id]?.[target.key]
                return <td key={target.key} className="px-3 py-3">
                  <label className="flex items-center justify-center gap-2"><input type="checkbox" checked={Boolean(cell?.enabled)} onChange={(e) => setCell(course.id, target.key, { enabled: e.target.checked, dueDays: cell?.dueDays || rowDays[course.id] || course.defaultDueDays || 30 })}/><span>Bắt buộc</span></label>
                </td>
              })}
            </tr>
          })}
        </tbody>
      </table>
      {!data && <p className="p-8 text-center">Đang tải ma trận…</p>}
    </Card>
  </>
}
