'use client'
import PeriodLeaderboard from '@/components/learning/PeriodLeaderboard'
import { useEffect, useState } from 'react'
import Card from '@/components/ui/Card'
import { apiFetch } from '@/lib/api/client'

export default function DnaLeaderboardPage() {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { apiFetch('/api/v1/organization/dna-leaderboard').then((result) => {
    if (result.ok) setItems(result.data?.items || [])
    else setError(result.error?.message || 'Không tải được bảng xếp hạng DNA.')
    setLoading(false)
  }) }, [])
  return <div className="mx-auto max-w-6xl space-y-6">
      <PeriodLeaderboard />
    <header><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">DNA workspace</p><h1 className="mt-1 text-3xl font-bold text-[#172554]">Bảng xếp hạng nội bộ DNA</h1><p className="mt-1 text-sm text-[#737686]">Chỉ tính thành viên DNA đang hoạt động. Lead DNA là tài khoản quản lý nên không tham gia xếp hạng.</p></header>
    <Card className="overflow-hidden border border-[#eff4ff] p-0">
      {error ? <div className="p-6 text-sm text-red-700">{error}</div> : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-[#f8f9ff] text-xs uppercase text-[#737686]"><tr><th className="px-5 py-3">Hạng</th><th className="px-5 py-3">Thành viên DNA</th><th className="px-5 py-3">Nhóm</th><th className="px-5 py-3 text-right">Star</th></tr></thead><tbody className="divide-y divide-[#eff4ff]">{loading ? <tr><td colSpan={4} className="px-5 py-10 text-center text-[#737686]">Đang tải bảng xếp hạng…</td></tr> : items.length ? items.map((item) => <tr key={item.userId}><td className="px-5 py-4 text-lg font-black text-[#2563EB]">#{item.rank}</td><td className="px-5 py-4"><p className="font-bold text-[#172554]">{item.displayName || item.email}</p><p className="text-xs text-[#737686]">{item.email}</p></td><td className="px-5 py-4 text-[#596174]">{item.groupName || 'DNA chung'}</td><td className="px-5 py-4 text-right text-lg font-black text-amber-500">⭐ {item.stars}</td></tr>) : <tr><td colSpan={4} className="px-5 py-10 text-center text-[#737686]">Chưa có thành viên DNA để xếp hạng.</td></tr>}</tbody></table></div>}
    </Card>
  </div>
}
