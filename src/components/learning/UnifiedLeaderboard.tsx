'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import Modal from '@/components/ui/Modal'
import { apiFetch, clearApiCache, getCachedApiData } from '@/lib/api/client'

export interface UnifiedLeaderboardProps {
  initialGroup?: 'MEMBER' | 'LT' | 'DNA' | 'CHAPTER'
  initialPeriodType?: 'MONTH' | 'TERM'
  chapterId?: string
  chapterName?: string
  showChapterSelector?: boolean
}

interface LeaderboardItem {
  userId?: string
  id?: string
  chapterId?: string
  displayName?: string
  name?: string
  email?: string
  chapterName?: string
  departmentName?: string
  department?: any
  groupName?: string
  stars?: number
  score?: number
  rank?: number
  memberCount?: number
  completedCourses?: number
  totalCourses?: number
  completedLessons?: number
  totalLessons?: number
  avgProgress?: number
  avgScore?: number
  avgQuizScore?: number
  assessmentAverageScore?: number
  kpiStatus?: string
  kpi?: any
  completion?: any
  atLeast70Percent?: number
  reasons?: string[]
  eligible?: boolean
}

export default function UnifiedLeaderboard({
  initialGroup = 'MEMBER',
  initialPeriodType = 'MONTH',
  chapterId: propChapterId,
  chapterName: propChapterName,
  showChapterSelector = true,
}: UnifiedLeaderboardProps) {
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [group, setGroup] = useState<'MEMBER' | 'LT' | 'DNA' | 'CHAPTER'>(initialGroup)
  const [periodType, setPeriodType] = useState<'MONTH' | 'TERM'>(initialPeriodType)
  const [selectedChapterId, setSelectedChapterId] = useState<string>(propChapterId || '')
  const [chapterList, setChapterList] = useState<Array<{ id: string; name: string }>>([])

  const [items, setItems] = useState<LeaderboardItem[]>([])
  const [excludedChapters, setExcludedChapters] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showRulesModal, setShowRulesModal] = useState(false)

  // Đọc currentUser từ localStorage & API
  const refreshCurrentUser = useCallback(() => {
    if (typeof window === 'undefined') return null
    try {
      const u = localStorage.getItem('user')
      if (u) {
        const parsed = JSON.parse(u)
        setCurrentUser(parsed)
        if (!selectedChapterId && parsed.chapterId) {
          setSelectedChapterId(parsed.chapterId)
        }
        return parsed
      }
    } catch {}
    return null
  }, [selectedChapterId])

  useEffect(() => {
    const user = refreshCurrentUser()
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search)
      const g = sp.get('group') as any
      const p = sp.get('periodType') as any
      const c = sp.get('chapterId')
      if (['MEMBER', 'LT', 'DNA', 'CHAPTER'].includes(g)) setGroup(g)
      if (['MONTH', 'TERM'].includes(p)) setPeriodType(p)
      if (c) setSelectedChapterId(c)
    }
    // Lấy danh sách Chapter cho bộ lọc
    apiFetch<any>('/api/v1/learning/periods').then((res) => {
      if (res.ok && res.data?.terms) {
        const uniqueChapters = new Map<string, string>()
        res.data.terms.forEach((t: any) => {
          if (t.chapter_id && t.chapterName) uniqueChapters.set(t.chapter_id, t.chapterName)
        })
        const list = Array.from(uniqueChapters.entries()).map(([id, name]) => ({ id, name }))
        setChapterList(list)
      }
    }).catch(() => {})
  }, [refreshCurrentUser])

  // Tải dữ liệu bảng xếp hạng
  const loadLeaderboardData = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true)
      clearApiCache('/api/v1/leaderboard')
      clearApiCache('/api/v1/organization/dna-leaderboard')
      refreshCurrentUser()
    } else {
      setLoading(true)
    }

    try {
      const activeChapId = selectedChapterId || currentUser?.chapterId || propChapterId

      if (group === 'CHAPTER') {
        // Bảng toàn bộ Chapter
        const url = `/api/v1/leaderboard/chapters`
        const res = await apiFetch<any>(url, { noCache: forceRefresh })
        if (res.ok && res.data) {
          const list: LeaderboardItem[] = (res.data.items || []).map((ch: any, idx: number) => ({
            ...ch,
            rank: ch.rank ?? idx + 1,
            chapterId: ch.chapterId || ch.id,
            displayName: ch.name,
            score: ch.score ?? 0,
            stars: ch.stars?.averagePerMember ?? 0,
            memberCount: ch.memberCount ?? 0,
            atLeast70Percent: ch.completion?.atLeast70Percent ?? 0,
            kpiStatus: ch.kpi?.status || 'N/A',
          }))
          setItems(list)
          setExcludedChapters(res.data.excluded || [])
        } else {
          setItems([])
        }
      } else if (group === 'DNA') {
        // Bảng nội bộ khối DNA
        const url = '/api/v1/organization/dna-leaderboard'
        const res = await apiFetch<any>(url, { noCache: forceRefresh })
        if (res.ok && res.data) {
          const list: LeaderboardItem[] = (res.data.items || []).map((item: any, idx: number) => ({
            ...item,
            rank: item.rank ?? idx + 1,
            displayName: item.displayName || item.email?.split('@')[0],
            groupName: item.groupName || 'DNA chung',
            stars: item.stars ?? 0,
          }))
          setItems(list)
        } else {
          setItems([])
        }
      } else if (group === 'LT') {
        // Bảng Ban Lãnh Đạo (LT) của Chapter
        if (activeChapId) {
          const url = `/api/v1/leaderboard/chapters/${activeChapId}`
          const res = await apiFetch<any>(url, { noCache: forceRefresh })
          if (res.ok && res.data) {
            const list: LeaderboardItem[] = (res.data.items || [])
              .filter((m: any) => {
                const dept = typeof m.department === 'string' ? m.department : m.department?.name
                return m.isLead || dept === 'Chủ Tịch' || dept?.toLowerCase().includes('trưởng')
              })
              .map((m: any, idx: number) => ({
                ...m,
                rank: idx + 1,
                displayName: m.displayName || m.email?.split('@')[0],
                departmentName: typeof m.department === 'string' ? m.department : (m.department?.name || 'Ban LT'),
              }))
            setItems(list)
          } else {
            setItems([])
          }
        } else {
          setItems([])
        }
      } else {
        // Bảng Thành viên (MEMBER)
        if (activeChapId) {
          const url = `/api/v1/leaderboard/chapters/${activeChapId}`
          const res = await apiFetch<any>(url, { noCache: forceRefresh })
          if (res.ok && res.data) {
            const list: LeaderboardItem[] = (res.data.items || []).map((m: any, idx: number) => ({
              ...m,
              rank: idx + 1,
              displayName: m.displayName || m.email?.split('@')[0],
              departmentName: typeof m.department === 'string' ? m.department : (m.department?.name || 'Chưa phân ban'),
            }))
            setItems(list)
          } else {
            setItems([])
          }
        } else {
          // Global members
          const res = await apiFetch<any>('/api/v1/leaderboard', { noCache: forceRefresh })
          if (res.ok && res.data) {
            const list: LeaderboardItem[] = (res.data.items || []).map((m: any, idx: number) => ({
              ...m,
              rank: idx + 1,
              displayName: m.displayName || m.email?.split('@')[0],
            }))
            setItems(list)
          } else {
            setItems([])
          }
        }
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [group, periodType, selectedChapterId, currentUser, propChapterId, refreshCurrentUser])

  useEffect(() => {
    loadLeaderboardData()
  }, [loadLeaderboardData])

  // Kiểm tra hàng hiện tại có phải của chính người đang đăng nhập
  const isCurrentUserItem = (item: LeaderboardItem) => {
    if (!currentUser) return false
    if (group === 'CHAPTER') {
      return (
        Boolean(currentUser.chapterId && item.chapterId === currentUser.chapterId) ||
        Boolean(currentUser.chapterName && item.displayName === currentUser.chapterName)
      )
    }
    const currentId = currentUser.id || currentUser.userId
    const currentEmail = currentUser.email?.toLowerCase()
    return (
      (currentId && (item.userId === currentId || item.id === currentId)) ||
      (currentEmail && item.email && item.email.toLowerCase() === currentEmail)
    )
  }

  const topThree = items.slice(0, 3)

  const getMedalBadge = (rank: number) => {
    if (rank === 1) return <span className="text-2xl">🥇</span>
    if (rank === 2) return <span className="text-2xl">🥈</span>
    if (rank === 3) return <span className="text-2xl">🥉</span>
    return <span className="font-bold text-slate-500">#{rank}</span>
  }

  return (
    <div className="w-full space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-[#eff4ff] shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold px-3 py-1 bg-[#2563EB]/10 text-[#2563EB] rounded-full inline-flex items-center gap-1">
              🏆 Bảng Vinh Danh BBE E-Learning
            </span>
            <span className="text-xs font-semibold px-2.5 py-0.5 bg-slate-100 text-slate-700 rounded-full">
              {periodType === 'MONTH' ? '📅 Theo Tháng' : '🎯 Theo Nhiệm kỳ'}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Bảng Xếp Hạng Thi Đua
          </h1>
          <p className="text-xs sm:text-sm text-[#737686] mt-1">
            {group === 'CHAPTER'
              ? 'Xếp hạng chất lượng đào tạo giữa các Chapter theo chuẩn BBE'
              : group === 'DNA'
              ? 'Xếp hạng tích lũy Star thành viên nội bộ Khối DNA'
              : group === 'LT'
              ? 'Vinh danh Ban Lãnh đạo (LT) gương mẫu'
              : 'Xếp hạng thành viên theo số Star tích lũy'}
          </p>
        </div>

        {/* Nút hành động */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setShowRulesModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-50 text-[#2563EB] text-xs font-bold hover:bg-blue-100 transition border border-blue-200 shadow-2xs"
          >
            <span>ℹ️</span> Thể lệ tính điểm
          </button>

          <button
            onClick={() => loadLeaderboardData(true)}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#2563EB] text-white text-xs font-bold hover:bg-[#1d4ed8] active:scale-95 transition shadow-sm disabled:opacity-50"
            title="Làm mới dữ liệu từ server (Cập nhật tên mới ngay)"
          >
            <span className={`inline-block ${refreshing ? 'animate-spin' : ''}`}>🔄</span>
            {refreshing ? 'Đang làm mới…' : 'Làm mới dữ liệu'}
          </button>
        </div>
      </div>

      {/* Bộ lọc Tab Nhóm & Chu kỳ */}
      <div className="bg-white p-4 rounded-3xl border border-[#eff4ff] shadow-sm space-y-4">
        {/* Hàng 1: 4 Tab Đối tượng */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-2xl">
            <button
              onClick={() => setGroup('MEMBER')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                group === 'MEMBER'
                  ? 'bg-white text-[#2563EB] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              👤 Thành viên
            </button>
            <button
              onClick={() => setGroup('LT')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                group === 'LT'
                  ? 'bg-white text-[#2563EB] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              👑 Ban LT
            </button>
            <button
              onClick={() => setGroup('DNA')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                group === 'DNA'
                  ? 'bg-white text-[#2563EB] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🧬 Khối DNA
            </button>
            <button
              onClick={() => setGroup('CHAPTER')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                group === 'CHAPTER'
                  ? 'bg-white text-[#2563EB] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🏛️ Toàn Chapter
            </button>
          </div>

          {/* Hàng 2: Chu kỳ Tháng / Nhiệm kỳ */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl">
            <button
              onClick={() => setPeriodType('MONTH')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
                periodType === 'MONTH'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📅 Theo Tháng
            </button>
            <button
              onClick={() => setPeriodType('TERM')}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
                periodType === 'TERM'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🎯 Theo Nhiệm kỳ
            </button>
          </div>
        </div>

        {/* Lọc theo Chapter nếu xem Thành viên hoặc LT */}
        {(group === 'MEMBER' || group === 'LT') && showChapterSelector && chapterList.length > 0 && (
          <div className="flex items-center gap-3 pt-2 border-t border-slate-100 text-xs">
            <span className="font-semibold text-slate-600 shrink-0">Lọc theo Chapter:</span>
            <select
              value={selectedChapterId}
              onChange={(e) => setSelectedChapterId(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 font-semibold text-slate-800 outline-none focus:border-blue-500 max-w-xs"
            >
              <option value="">Tất cả / Chapter của bạn</option>
              {chapterList.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {loading ? (
        <Card className="p-16 text-center text-[#737686]">
          <div className="w-10 h-10 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-xs font-medium">Đang tải bảng xếp hạng…</p>
        </Card>
      ) : items.length === 0 ? (
        <Card className="p-16 text-center text-[#737686] space-y-2">
          <div className="text-5xl">⭐</div>
          <h3 className="text-base font-bold text-[#172554]">Chưa có dữ liệu xếp hạng</h3>
          <p className="text-xs max-w-md mx-auto">
            Chưa có thành viên hoặc Chapter nào ghi nhận thành tích trong chu kỳ này.
          </p>
        </Card>
      ) : (
        <>
          {/* Top 3 Podium Cards */}
          {topThree.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-3 items-end">
              {/* Hạng 2: Bạc (Silver) */}
              {topThree[1] ? (
                <Card className="p-6 text-center border-t-4 border-t-slate-400 bg-gradient-to-b from-slate-50/70 to-white hover:shadow-md transition rounded-3xl relative">
                  <div className="text-4xl mb-1">🥈</div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Hạng 2 • Á quân
                  </div>
                  <div className="font-extrabold text-[#172554] text-base truncate mb-0.5">
                    {topThree[1].displayName}
                    {isCurrentUserItem(topThree[1]) && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-[#2563EB] text-white">
                        Bạn
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#737686] truncate mb-3">
                    {group === 'CHAPTER'
                      ? `${topThree[1].memberCount || 0} học viên • Đạt ≥70%: ${topThree[1].atLeast70Percent || 0}%`
                      : topThree[1].departmentName || topThree[1].groupName || topThree[1].email || 'Thành viên'}
                  </p>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-800 rounded-full text-sm font-black border border-slate-200">
                    <span>{group === 'CHAPTER' ? '🏆 Điểm:' : '⭐'}</span>{' '}
                    {(topThree[1].score ?? topThree[1].stars ?? 0).toLocaleString('vi-VN')}
                  </div>
                </Card>
              ) : (
                <div />
              )}

              {/* Hạng 1: Vàng (Gold) */}
              {topThree[0] && (
                <Card className="p-8 text-center border-t-4 border-t-amber-400 bg-gradient-to-b from-amber-50/60 to-white shadow-xl hover:shadow-2xl transition rounded-3xl relative -mt-3 md:-mt-5">
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-amber-500 to-amber-600 text-white text-[11px] font-black px-4 py-0.5 rounded-full shadow-md uppercase tracking-wider">
                    👑 TOP 1 • Quán quân
                  </div>
                  <div className="text-5xl mb-1">🥇</div>
                  <div className="font-black text-lg text-[#172554] truncate mb-0.5">
                    {topThree[0].displayName}
                    {isCurrentUserItem(topThree[0]) && (
                      <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black bg-[#2563EB] text-white">
                        Bạn
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#737686] truncate mb-3">
                    {group === 'CHAPTER'
                      ? `${topThree[0].memberCount || 0} học viên • Đạt ≥70%: ${topThree[0].atLeast70Percent || 0}%`
                      : topThree[0].departmentName || topThree[0].groupName || topThree[0].email || 'Thành viên'}
                  </p>
                  <div className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-amber-100 text-amber-900 rounded-full text-base font-black border border-amber-300 shadow-inner">
                    <span>{group === 'CHAPTER' ? '🏆 Điểm:' : '⭐'}</span>{' '}
                    {(topThree[0].score ?? topThree[0].stars ?? 0).toLocaleString('vi-VN')}
                  </div>
                </Card>
              )}

              {/* Hạng 3: Đồng (Bronze) */}
              {topThree[2] ? (
                <Card className="p-6 text-center border-t-4 border-t-amber-700/60 bg-gradient-to-b from-amber-50/20 to-white hover:shadow-md transition rounded-3xl relative">
                  <div className="text-4xl mb-1">🥉</div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800 mb-1">
                    Hạng 3 • Quý quân
                  </div>
                  <div className="font-extrabold text-[#172554] text-base truncate mb-0.5">
                    {topThree[2].displayName}
                    {isCurrentUserItem(topThree[2]) && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-[#2563EB] text-white">
                        Bạn
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#737686] truncate mb-3">
                    {group === 'CHAPTER'
                      ? `${topThree[2].memberCount || 0} học viên • Đạt ≥70%: ${topThree[2].atLeast70Percent || 0}%`
                      : topThree[2].departmentName || topThree[2].groupName || topThree[2].email || 'Thành viên'}
                  </p>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-900 rounded-full text-sm font-black border border-amber-200">
                    <span>{group === 'CHAPTER' ? '🏆 Điểm:' : '⭐'}</span>{' '}
                    {(topThree[2].score ?? topThree[2].stars ?? 0).toLocaleString('vi-VN')}
                  </div>
                </Card>
              ) : (
                <div />
              )}
            </div>
          )}

          {/* Bảng danh sách chi tiết */}
          <Card className="p-0 overflow-hidden border border-[#eff4ff] shadow-sm rounded-3xl">
            <div className="px-6 py-4 border-b border-[#eff4ff] bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-[#172554]">
                Toàn bộ danh sách ({items.length} {group === 'CHAPTER' ? 'Chapter' : 'thành viên'})
              </h2>
              <span className="text-xs text-[#737686]">
                Sắp xếp theo {group === 'CHAPTER' ? 'Điểm BXH' : 'Tổng ⭐ Star tích lũy'}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[#eff4ff] bg-slate-50/80 text-[11px] font-bold text-[#737686] uppercase tracking-wider">
                    <th className="py-3.5 px-6 text-center w-20">Hạng</th>
                    <th className="py-3.5 px-6">{group === 'CHAPTER' ? 'Chapter' : 'Thành viên'}</th>
                    <th className="py-3.5 px-6">{group === 'CHAPTER' ? 'Quy mô' : 'Ban / Nhóm'}</th>
                    <th className="py-3.5 px-6 text-right">
                      {group === 'CHAPTER' ? 'Điểm BXH' : 'Tổng ⭐ Star'}
                    </th>
                    <th className="py-3.5 px-6 text-center">
                      {group === 'CHAPTER' ? 'KPI Tháng' : 'Tiến độ'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eff4ff]">
                  {items.map((item, idx) => {
                    const rank = item.rank ?? idx + 1
                    const isYou = isCurrentUserItem(item)

                    return (
                      <tr
                        key={item.userId || item.chapterId || idx}
                        className={`transition-colors ${
                          isYou
                            ? 'bg-blue-50/80 border-l-4 border-l-[#2563EB] font-semibold text-[#172554]'
                            : 'hover:bg-[#f8f9ff] text-[#434655]'
                        }`}
                      >
                        {/* Hạng */}
                        <td className="py-4 px-6 text-center">
                          <span className="inline-flex items-center justify-center font-bold">
                            {getMedalBadge(rank)}
                          </span>
                        </td>

                        {/* Tên & Nhãn Bạn */}
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                                isYou
                                  ? 'bg-[#2563EB] text-white shadow-xs'
                                  : 'bg-[#eff4ff] text-[#2563EB]'
                              }`}
                            >
                              {(item.displayName || item.name || 'U').charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="font-bold text-[#172554] truncate flex items-center gap-2">
                                <span>{item.displayName || item.name || item.email}</span>
                                {isYou && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-[#2563EB] text-white shadow-2xs">
                                    Bạn
                                  </span>
                                )}
                              </p>
                              {item.email && group !== 'CHAPTER' && (
                                <p className="text-[11px] text-[#737686] truncate">{item.email}</p>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Ban / Nhóm / Quy mô */}
                        <td className="py-4 px-6">
                          {group === 'CHAPTER' ? (
                            <span className="inline-block px-2.5 py-1 rounded-full bg-blue-50 text-[#2563EB] text-xs font-bold">
                              {item.memberCount || 0} học viên
                            </span>
                          ) : (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                              {item.departmentName || item.groupName || item.chapterName || '—'}
                            </span>
                          )}
                        </td>

                        {/* Star hoặc Điểm */}
                        <td className="py-4 px-6 text-right">
                          <span className="inline-flex items-center gap-1 font-extrabold text-amber-600 bg-amber-50 px-3 py-1 rounded-xl border border-amber-200">
                            ⭐ {(item.score ?? item.stars ?? 0).toLocaleString('vi-VN')}
                          </span>
                        </td>

                        {/* Thông tin phụ: Tiến độ hoặc KPI */}
                        <td className="py-4 px-6 text-center text-xs">
                          {group === 'CHAPTER' ? (
                            <span
                              className={`inline-block px-2.5 py-1 rounded-full font-bold ${
                                item.kpiStatus === 'GREEN'
                                  ? 'bg-green-100 text-green-700'
                                  : item.kpiStatus === 'YELLOW'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {item.kpiStatus === 'GREEN' ? 'Xanh +20' : item.kpiStatus === 'YELLOW' ? 'Vàng +0' : item.kpiStatus || 'N/A'}
                            </span>
                          ) : item.completedLessons !== undefined && item.totalLessons !== undefined ? (
                            <span className="font-semibold text-slate-700">
                              {item.completedLessons} / {item.totalLessons} bài
                            </span>
                          ) : item.completedCourses !== undefined ? (
                            <span className="font-semibold text-slate-700">
                              {item.completedCourses} khóa
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Chapter chưa đủ điều kiện (nếu đang ở tab Chapter) */}
          {group === 'CHAPTER' && excludedChapters.length > 0 && (
            <Card className="border border-amber-200 bg-amber-50/50 p-6 rounded-3xl space-y-3">
              <h3 className="font-bold text-[#172554] text-sm">
                🏛️ Chapter chưa đủ điều kiện tham gia xếp hạng ({excludedChapters.length})
              </h3>
              <p className="text-xs text-[#737686]">
                Theo thể lệ BBE, Chapter cần tối thiểu 20 thành viên, tỷ lệ đạt ≥70% bài học tối thiểu 50% và không có KPI Đỏ/Đen.
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 pt-1">
                {excludedChapters.map((ch: any) => (
                  <div key={ch.chapterId || ch.id} className="p-3 bg-white border border-amber-200 rounded-2xl text-xs space-y-1">
                    <p className="font-bold text-[#172554]">{ch.name}</p>
                    <div className="flex flex-col gap-0.5 text-slate-600">
                      {(ch.reasons || []).map((r: string, rIdx: number) => (
                        <span key={rIdx} className="text-amber-800 font-medium">
                          • {r === 'MINIMUM_MEMBERS' ? `Chưa đủ 20 thành viên (${ch.memberCount})` : r === 'COMPLETION_THRESHOLD' ? `Chưa đạt 50% thành viên ≥70%` : r}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {/* Modal Thể Lệ Xếp Hạng Chuẩn */}
      <Modal
        isOpen={showRulesModal}
        onClose={() => setShowRulesModal(false)}
        maxWidth="max-w-2xl"
      >
        <div className="p-6 space-y-5 max-h-[85vh] overflow-y-auto">
          <div className="flex items-center justify-between border-b border-[#eff4ff] pb-4">
            <div>
              <h3 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                ℹ️ Thể Lệ Tính Điểm & Xếp Hạng BBE
              </h3>
              <p className="text-xs text-[#737686] mt-0.5">Quy chuẩn thi đua và vinh danh học tập chính thức</p>
            </div>
            <button
              onClick={() => setShowRulesModal(false)}
              className="text-[#737686] hover:text-[#172554] text-xl font-bold p-1 rounded-lg hover:bg-slate-100 transition"
            >
              ✕
            </button>
          </div>

          <div className="space-y-4 text-xs text-slate-700 leading-relaxed">
            {/* Mục 1: Thành viên & LT */}
            <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100 space-y-1.5">
              <h4 className="font-bold text-sm text-[#2563EB]">1. Xếp Hạng Thành Viên & Ban LT</h4>
              <ul className="list-disc pl-4 space-y-1">
                <li><strong>Video bài giảng:</strong> Nhận 1 Star cho mỗi phút thời lượng chuẩn của video (làm tròn lên).</li>
                <li><strong>Quiz bài học:</strong> Đạt điểm từ <strong>≥ 85%</strong> trở lên mới nhận sao. Áp dụng cơ chế <em>High-Water Mark</em>: làm lại đạt điểm cao hơn kỷ lục cũ sẽ nhận phần sao chênh lệch.</li>
                <li><strong>Bài thi cuối khóa:</strong> Đạt từ <strong>≥ 85%</strong> trở lên nhận thưởng sao cuối khóa.</li>
                <li><strong>Tiêu chí hòa sao:</strong> Nếu hai người có cùng số Star, hệ thống ưu tiên người đạt mốc sao đó sớm hơn theo thời gian thực tế.</li>
              </ul>
            </div>

            {/* Mục 2: Khối DNA */}
            <div className="bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100 space-y-1.5">
              <h4 className="font-bold text-sm text-emerald-800">2. Xếp Hạng Khối DNA</h4>
              <ul className="list-disc pl-4 space-y-1">
                <li>Chỉ áp dụng cho các <strong>Thành viên DNA</strong> đang hoạt động.</li>
                <li>Tài khoản <strong>Lead DNA</strong> là vai trò quản lý cấp hệ thống nên không tham gia thi đua để bảo đảm tính khách quan.</li>
              </ul>
            </div>

            {/* Mục 3: Toàn Chapter */}
            <div className="bg-amber-50/50 p-4 rounded-2xl border border-amber-100 space-y-1.5">
              <h4 className="font-bold text-sm text-amber-900">3. Xếp Hạng Toàn Chapter</h4>
              <ul className="list-disc pl-4 space-y-1">
                <li>
                  <strong>Công thức tính điểm:</strong>
                  <div className="my-1.5 p-2 bg-white rounded-xl border border-amber-200 font-mono text-center font-bold text-amber-900">
                    Điểm BXH = (Tổng Star hợp lệ ÷ Quân số Chapter) + Thưởng KPI
                  </div>
                </li>
                <li><strong>Điều kiện tối thiểu để được xếp hạng:</strong>
                  <ul className="list-circle pl-4 mt-0.5 space-y-0.5">
                    <li>Quân số Chapter phải có tối thiểu từ <strong>20 thành viên</strong> trở lên.</li>
                    <li>Tối thiểu <strong>50%</strong> thành viên phải đạt tiến độ từ <strong>70%</strong> bài học bắt buộc trở lên.</li>
                  </ul>
                </li>
                <li><strong>Điểm thưởng KPI:</strong> KPI Xanh: +20 điểm • KPI Vàng: +0 điểm • KPI Đỏ/Đen: Tạm ngưng xếp hạng kỳ đó.</li>
              </ul>
            </div>
          </div>

          <div className="pt-2 text-right">
            <button
              onClick={() => setShowRulesModal(false)}
              className="px-5 py-2 bg-[#2563EB] text-white text-xs font-bold rounded-xl hover:bg-[#1d4ed8] transition"
            >
              Đã hiểu
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
