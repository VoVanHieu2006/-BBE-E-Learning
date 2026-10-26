'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api/client'

const date = (value: string | null) => value ? new Date(value).toLocaleString('vi-VN') : 'Chưa kết thúc'

export default function OrganizationHistory({ params }: { params: { userId: string } }) {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    apiFetch(`/api/v1/admin/organization/history?userId=${encodeURIComponent(params.userId)}`, { noCache: true }).then(result => {
      if (!active) return
      if (result.ok) setData(result.data)
      else setError(result.error?.message || 'Không thể xem lịch sử tổ chức.')
    })
    return () => { active = false }
  }, [params.userId])
  return <div className="space-y-5">
    <Link href="/admin/users" className="text-blue-700">← Danh sách hiện tại</Link>
    <h1 className="text-2xl font-bold">Lịch sử tổ chức</h1>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p>Đang tải…</p>}
    {data && <>
      <p>{data.user.display_name || data.user.email}</p>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-sm"><caption className="p-3 text-left font-semibold">Chapter — khoảng lịch sử được lưu tại thời điểm phát sinh</caption>
          <thead><tr><th className="p-3">Chapter</th><th>Trạng thái</th><th>Từ</th><th>Đến</th></tr></thead>
          <tbody>{data.chapters.map((row: any) => <tr key={row.id} className="border-t"><td className="p-3">{row.name}</td><td>{row.label}</td><td>{date(row.starts_at)}</td><td>{date(row.ends_at)}</td></tr>)}</tbody>
        </table>
        {!data.chapters.length && <p className="p-3">Chưa có khoảng lịch sử được ghi nhận. Không suy diễn các giai đoạn trước đây.</p>}
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-sm"><caption className="p-3 text-left font-semibold">Đơn vị / Ban / DNA</caption>
          <thead><tr><th className="p-3">Đơn vị</th><th>Loại đơn vị</th><th>Trạng thái</th><th>Từ</th><th>Đến</th></tr></thead>
          <tbody>{data.memberships.map((row: any) => <tr key={row.id} className="border-t"><td className="p-3">{row.unit.name}</td><td>{row.unit.type === 'DEPARTMENT' ? 'Ban (DEPARTMENT)' : row.unit.type === 'DNA_GROUP' ? 'Nhóm DNA (DNA_GROUP)' : row.unit.type}</td><td>{row.status === 'ENDED' || (row.ends_at && new Date(row.ends_at) <= new Date()) ? 'Đã kết thúc' : new Date(row.starts_at) > new Date() ? 'Chưa có hiệu lực' : 'Đang hoạt động'}</td><td>{date(row.starts_at)}</td><td>{date(row.ends_at)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-left text-sm"><caption className="p-3 text-left font-semibold">Nhiệm kỳ chức vụ</caption>
          <thead><tr><th className="p-3">Chức vụ</th><th>Đơn vị</th><th>Từ</th><th>Đến</th></tr></thead>
          <tbody>{data.positions.map((row: any) => <tr key={row.id} className="border-t"><td className="p-3">{row.position.name}</td><td>{row.unit.name}</td><td>{date(row.starts_at)}</td><td>{date(row.ends_at)}</td></tr>)}</tbody>
        </table>
      </div>
    </>}
  </div>
}
