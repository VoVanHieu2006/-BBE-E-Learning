'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api/client'
import { LEARNING_PROGRAMS } from '@/lib/learning-catalog'

export default function LearningPolicyPage() {
  const [data, setData] = useState<any>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function load() {
    setBusy(true)
    const response = await apiFetch<any>('/api/v1/admin/learning-policy', { noCache: true })
    if (response.ok) {
      setData(response.data)
      setMapping(Object.fromEntries(response.data.courses.map((course: any) => [course.id, response.data.programs.find((program: any) => program.id === course.program_id)?.code || ''])))
    } else setMessage(response.error?.message || 'Không tải được dữ liệu. Hãy thử lại.')
    setBusy(false)
  }
  useEffect(() => { load() }, [])
  async function save() {
    setBusy(true); setMessage('')
    const response = await apiFetch('/api/v1/admin/learning-policy', { method: 'PUT', body: JSON.stringify({ courses: Object.entries(mapping).map(([courseId, programCode]) => ({ courseId, programCode: programCode || null })) }) })
    setBusy(false)
    if (response.ok) { await load(); setMessage('Đã lưu mapping được chọn.') }
    else setMessage(response.error?.message || 'Không lưu được mapping. Hãy thử lại.')
  }
  async function normalizeOrganization() {
    setBusy(true)
    const response = await apiFetch('/api/v1/admin/learning-policy', { method: 'PUT', body: JSON.stringify({ normalizeOrganization: true }) })
    setBusy(false)
    setMessage(response.ok ? 'Đã gán mã chuẩn, bổ sung Ban còn thiếu và giữ các liên kết hiện có.' : response.error?.message || 'Chưa chuẩn hóa được. Kiểm tra Ban trùng và thử lại.')
    if (response.ok) await load()
  }
  async function retrySynchronization() {
    setBusy(true)
    const response = await apiFetch('/api/v1/admin/learning-policy', { method: 'PUT', body: JSON.stringify({ retryOutboxIds: data.failed.map((event: any) => event.id) }) })
    if (response.ok) { await load(); setMessage('Đã đưa tác vụ lỗi vào lượt xử lý kế tiếp. Reset chu kỳ không chạy lại.') }
    else { setBusy(false); setMessage(response.error?.message || 'Chưa đưa được tác vụ vào hàng đợi. Hãy thử lại.') }
  }
  const unclassified = data?.courses.filter((course: any) => course.status === 'PUBLISHED' && !mapping[course.id]).length || 0
  return <div className="mx-auto max-w-7xl space-y-6">
    <header><h1 className="text-2xl font-bold text-slate-900">Chương trình và phân loại khóa học</h1><p className="mt-2 text-sm text-slate-600">Duyệt từng khóa sau khi xem nội dung. Đề xuất chỉ hỗ trợ phân loại; tiến độ, sao và hạn hiện tại được giữ nguyên.</p></header>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{LEARNING_PROGRAMS.map((program) => <div key={program.code} className="rounded-xl border bg-white p-4"><h2 className="font-semibold">{program.name}</h2><p className="mt-2 text-sm text-slate-600">{Object.values(mapping).filter((code) => code === program.code).length} khóa đã chọn{program.code === 'EXTENDED' ? ' · Không tính mốc 70%' : ' · Tính mốc 70%'}</p></div>)}</div>
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-blue-50 p-4 text-sm"><p>Còn {unclassified} khóa published chưa phân loại.</p><button disabled={busy} onClick={save} className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Đang xử lý…' : 'Lưu mapping đã duyệt'}</button><button disabled={busy} onClick={load} className="rounded-lg border bg-white px-4 py-2">Tải lại</button><Link href="/admin/courses/mandatory" className="font-semibold text-blue-800">Ma trận 18 target →</Link></div>
    {message && <p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}
    {!data ? <p aria-busy={busy}>Đang tải danh sách khóa học…</p> : <div className="space-y-3">{data.courses.map((course: any) => <article key={course.id} className="grid gap-4 rounded-xl border bg-white p-4 md:grid-cols-[1fr_1fr]">
      <div><Link href={`/admin/courses/${course.id}/edit`} className="font-semibold text-blue-800">{course.title}</Link><p className="mt-1 text-xs text-slate-500">{course.status} · {course.id}</p><p className="mt-2 text-sm text-slate-600">Đề xuất: {course.proposal.code || 'Chưa xác định'}. {course.proposal.reason}</p></div>
      <label className="text-sm font-medium">Chương trình được duyệt<select aria-label={`Chương trình của ${course.title}`} value={mapping[course.id] || ''} onChange={(event) => setMapping((current) => ({ ...current, [course.id]: event.target.value }))} className="mt-2 block w-full rounded-lg border bg-white p-3"><option value="">Chưa phân loại</option>{LEARNING_PROGRAMS.map((program) => <option key={program.code} value={program.code}>{program.name}</option>)}</select></label>
    </article>)}</div>}
    <button disabled={busy} onClick={normalizeOrganization} className="rounded-lg border bg-white px-4 py-2 text-sm font-semibold">Chuẩn hóa danh mục 7 Ban và nhóm DNA</button>
    <section className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Tác vụ đồng bộ</h2><p className="mt-2 text-sm">{data?.pending || 0} tác vụ đang chờ. Các lỗi được lưu lại và tự retry.</p>{data?.failed?.length > 0 && <button disabled={busy} onClick={retrySynchronization} className="mt-3 rounded-lg border px-4 py-2 text-sm">Thử lại tác vụ lỗi</button>}{data?.failed?.map((event: any) => <p key={event.id} className="mt-2 break-words text-xs text-red-700">{event.kind} · lần {event.attempts}: {event.last_error}</p>)}</section>
  </div>
}
