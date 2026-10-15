'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import Toast, { ToastMessage } from '@/components/ui/Toast'
import { apiFetch } from '@/lib/api/client'

export default function MandatoryCourseMatrixPage() {
  const [data, setData] = useState<any>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [saving, setSaving] = useState('')
  const load = async () => { const res = await apiFetch('/api/v1/admin/mandatory-matrix', { noCache: true }); if (res.ok) setData(res.data); else setToast({ type: 'error', message: res.error?.message || 'Không tải được ma trận.' }) }
  useEffect(() => { void load() }, [])
  const update = async (courseId: string, targetKey: string, enabled: boolean, dueDays: number) => {
    const key = `${courseId}:${targetKey}`; setSaving(key)
    const res = await apiFetch('/api/v1/admin/mandatory-matrix', { method: 'PUT', body: JSON.stringify({ courseId, targetKey, enabled, dueDays }) })
    if (res.ok) { setToast({ type: 'success', message: 'Đã cập nhật khóa học bắt buộc và thời hạn.' }); await load() } else setToast({ type: 'error', message: res.error?.message || 'Không cập nhật được.' })
    setSaving('')
  }
  return <><Toast toast={toast} onClose={() => setToast(null)}/><div className="mb-6 flex items-start justify-between gap-4"><div><h1 className="text-3xl font-bold text-[#172554]">Ma trận khóa học bắt buộc</h1><p className="mt-1 text-sm text-[#737686]">Tick vai trò và đặt số ngày hoàn thành riêng cho từng khóa học.</p></div><Link href="/admin/courses"><Button variant="outline">← Khóa học</Button></Link></div>
    <Card className="overflow-x-auto p-0"><table className="min-w-[1500px] w-full text-sm"><thead className="sticky top-0 bg-[#172554] text-white"><tr><th className="sticky left-0 z-10 bg-[#172554] px-4 py-3 text-left">Khóa học</th>{data?.targets?.map((target:any)=><th key={target.key} className="min-w-[155px] px-3 py-3 text-center">{target.label}</th>)}</tr></thead><tbody className="divide-y">{data?.courses?.map((course:any)=><tr key={course.id}><td className="sticky left-0 bg-white px-4 py-3 font-semibold text-[#172554]">{course.title}</td>{data.targets.map((target:any)=>{const cell=data.cells[course.id][target.key];const key=`${course.id}:${target.key}`;return <td key={target.key} className="px-3 py-3"><label className="flex items-center justify-center gap-2"><input type="checkbox" checked={cell.enabled} disabled={saving===key} onChange={(e)=>void update(course.id,target.key,e.target.checked,cell.dueDays||30)}/><span>Bắt buộc</span></label><div className="mt-2 flex items-center gap-1"><input type="number" min={1} max={3650} disabled={!cell.enabled||saving===key} defaultValue={cell.dueDays||30} onBlur={(e)=>cell.enabled&&void update(course.id,target.key,true,Number(e.target.value))} className="w-20 rounded-lg border px-2 py-1 text-center"/><span className="text-xs text-slate-500">ngày</span></div></td>})}</tr>)}</tbody></table>{!data&&<p className="p-8 text-center">Đang tải ma trận…</p>}</Card></>
}
