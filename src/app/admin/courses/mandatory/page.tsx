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
  const load = async () => {
    const res = await apiFetch('/api/v1/admin/mandatory-matrix', { noCache: true })
    if (res.ok) { setData(res.data); setDraft(structuredClone(res.data.cells)) }
    else setToast({ type: 'error', message: res.error?.message || 'Không tải được ma trận.' })
  }
  useEffect(() => { void load() }, [])
  const changes = useMemo(() => {
    if (!data || !draft) return []
    return data.courses.flatMap((course: any) => data.targets.flatMap((target: any) => {
      const before = data.cells[course.id][target.key]
      const after = draft[course.id][target.key]
      return before.enabled !== after.enabled || Number(before.dueDays || 30) !== Number(after.dueDays || 30) ? [{ courseId: course.id, targetKey: target.key, enabled: after.enabled, dueDays: Number(after.dueDays || 30) }] : []
    }))
  }, [data, draft])
  const setCell = (courseId: string, targetKey: string, patch: any) => setDraft((current: any) => ({ ...current, [courseId]: { ...current[courseId], [targetKey]: { ...current[courseId][targetKey], ...patch } } }))
  const save = async () => {
    if (!changes.length) return
    setSaving(true)
    const res = await apiFetch('/api/v1/admin/mandatory-matrix', { method: 'PUT', body: JSON.stringify({ changes }) })
    if (res.ok) { setToast({ type: 'success', message: `Đã lưu ${changes.length} thay đổi.` }); await load() }
    else setToast({ type: 'error', message: res.error?.message || 'Không lưu được cấu hình.' })
    setSaving(false)
  }
  return <><Toast toast={toast} onClose={() => setToast(null)}/>
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-bold text-[#172554]">Ma trận khóa học bắt buộc</h1><p className="mt-1 text-sm text-[#737686]">Chỉnh nhiều ô rồi bấm Lưu thay đổi một lần để hệ thống cập nhật nhanh và ổn định.</p></div><div className="flex gap-2"><Link href="/admin/courses"><Button variant="outline">← Khóa học</Button></Link><Button loading={saving} disabled={!changes.length} onClick={save}>Lưu thay đổi {changes.length ? `(${changes.length})` : ''}</Button></div></div>
    {changes.length > 0 && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">Có {changes.length} thay đổi chưa lưu.</div>}
    <Card className="overflow-x-auto p-0"><table className="min-w-[1500px] w-full text-sm"><thead className="sticky top-0 z-20 bg-[#172554] text-white"><tr><th className="sticky left-0 z-30 bg-[#172554] px-4 py-3 text-left">Khóa học</th>{data?.targets?.map((target:any)=><th key={target.key} className="min-w-[155px] px-3 py-3 text-center">{target.label}</th>)}</tr></thead><tbody className="divide-y">{data?.courses?.map((course:any)=><tr key={course.id}><td className="sticky left-0 z-10 bg-white px-4 py-3 font-semibold text-[#172554]">{course.title}</td>{data.targets.map((target:any)=>{const cell=draft?.[course.id]?.[target.key];return <td key={target.key} className="px-3 py-3"><label className="flex items-center justify-center gap-2"><input type="checkbox" checked={Boolean(cell?.enabled)} onChange={(e)=>setCell(course.id,target.key,{enabled:e.target.checked,dueDays:cell?.dueDays||30})}/><span>Bắt buộc</span></label><div className="mt-2 flex items-center justify-center gap-1"><input type="number" min={1} max={3650} disabled={!cell?.enabled} value={cell?.dueDays||30} onChange={(e)=>setCell(course.id,target.key,{dueDays:e.target.value})} className="w-20 rounded-lg border px-2 py-1 text-center disabled:bg-slate-100"/><span className="text-xs text-slate-500">ngày</span></div></td>})}</tr>)}</tbody></table>{!data&&<p className="p-8 text-center">Đang tải ma trận…</p>}</Card>
  </>
}
