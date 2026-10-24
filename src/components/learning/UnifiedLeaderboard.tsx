'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import Card from '@/components/ui/Card'
import Modal from '@/components/ui/Modal'
import LearnerProfileView from '@/components/learner/LearnerProfileView'
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
  positionName?: string
  dnaUnitId?: string
  dnaUnitName?: string
  department?: any
  groupName?: string
  stars?: number
  score?: number | null
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
  kpiStatus?: string | null
  kpi?: any
  completion?: any
  atLeast70Percent?: number | null
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

  const [allowedGroups, setAllowedGroups] = useState<Array<'MEMBER' | 'LT' | 'DNA' | 'CHAPTER'>>(['MEMBER', 'LT', 'DNA', 'CHAPTER'])
  const [isGlobal, setIsGlobal] = useState<boolean>(true)
  const requestSeqRef = useRef<number>(0)

  const [items, setItems] = useState<LeaderboardItem[]>([])
  const [excludedChapters, setExcludedChapters] = useState<any[]>([])
  const [leaderboardState, setLeaderboardState] = useState<string>('')
  const [accessError, setAccessError] = useState<string>('')
  const [periodId, setPeriodId] = useState('')
  const [periodCatalog, setPeriodCatalog] = useState<{ months: any[]; terms: any[]; seasons: any[] }>({ months: [], terms: [], seasons: [] })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showRulesModal, setShowRulesModal] = useState(false)

  const formatChapterScore = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '—'
    return Number(val).toLocaleString('vi-VN', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    })
  }

  // Profile Modal State
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [selectedUserData, setSelectedUserData] = useState<any>(null)
  const [loadingProfile, setLoadingProfile] = useState(false)

  const canViewProfile = Boolean(currentUser && ['ADMIN', 'CHAPTER_LEADER'].includes(currentUser.role))

  const handleOpenProfile = async (memberId: string, chapId?: string) => {
    if (!canViewProfile) return
    setSelectedUserId(memberId)
    setLoadingProfile(true)
    const targetChapter = chapId || selectedChapterId || currentUser?.chapterId || propChapterId || 'me'
    try {
      const res = await apiFetch<any>(`/api/v1/chapters/${targetChapter}/members/${memberId}/course-progress`, { noCache: true })
      if (res.data) {
        setSelectedUserData(res.data)
      }
    } catch (err) {
      console.error('Failed to load profile:', err)
    } finally {
      setLoadingProfile(false)
    }
  }

  // Đọc currentUser từ localStorage
  const refreshCurrentUser = useCallback(() => {
    if (typeof window === 'undefined') return null
    try {
      const u = localStorage.getItem('user')
      if (u) {
        const parsed = JSON.parse(u)
        setCurrentUser(parsed)
        return parsed
      }
    } catch {}
    return null
  }, [])

  useEffect(() => {
    refreshCurrentUser()
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search)
      const g = sp.get('group') as any
      const p = sp.get('periodType') as any
      const c = sp.get('chapterId')
      if (['MEMBER', 'LT', 'DNA', 'CHAPTER'].includes(g)) setGroup(g)
      if (['MONTH', 'TERM'].includes(p)) setPeriodType(p)
      if (c) setSelectedChapterId(c)
    }

    const storedUser = (() => {
      try { return JSON.parse(localStorage.getItem('user') || 'null') } catch { return null }
    })()

    if (storedUser?.role === 'CHAPTER_LEADER' && storedUser.chapterId) {
      setChapterList([{ id: storedUser.chapterId, name: storedUser.chapterName || 'Chapter của tôi' }])
      setSelectedChapterId((current) => current || storedUser.chapterId)
    }

    apiFetch<any>('/api/v1/learning/periods').then((res) => {
      if (res.ok && res.data) {
        const scope = res.data.scope
        const allowed = (scope?.allowedGroups as Array<'MEMBER' | 'LT' | 'DNA' | 'CHAPTER'>) || ['MEMBER', 'LT', 'DNA', 'CHAPTER']
        setAllowedGroups(allowed)
        const globalScope = scope?.isGlobal ?? true
        setIsGlobal(globalScope)

        setPeriodCatalog({
          months: res.data.months || [],
          terms: res.data.terms || [],
          seasons: res.data.seasons || [],
        })

        // Tự động chuyển tab nếu tab hiện tại nằm ngoài danh mục được phép
        setGroup((curr) => (allowed.includes(curr) ? curr : allowed[0]))

        const uniqueChapters = new Map<string, string>()
        res.data.terms?.forEach((t: any) => {
          if (t.chapter_id && t.chapterName) uniqueChapters.set(t.chapter_id, t.chapterName)
        })
        const list = Array.from(uniqueChapters.entries()).map(([id, name]) => ({ id, name }))
        if (storedUser?.role === 'CHAPTER_LEADER' && storedUser.chapterId) {
          setChapterList(list.filter((chapter) => chapter.id === storedUser.chapterId))
        } else {
          setChapterList(list)
        }
      }
    }).catch(() => {})
  }, [refreshCurrentUser])

  useEffect(() => {
    setPeriodId('')
  }, [group, periodType])

  // Tải dữ liệu bảng xếp hạng với cơ chế chống race-condition
  const loadLeaderboardData = useCallback(async (forceRefresh = false) => {
    const currentSeq = ++requestSeqRef.current

    if (forceRefresh) {
      setRefreshing(true)
      clearApiCache('/api/v1/leaderboard')
      clearApiCache('/api/v1/organization/dna-leaderboard')
      refreshCurrentUser()
    } else {
      setLoading(true)
    }

    try {
      setAccessError('')
      setExcludedChapters([])
      // Bảng tổng toàn hệ thống không âm thầm gán chapterId từ user
      const activeChapId = isGlobal ? (selectedChapterId || '') : (selectedChapterId || currentUser?.chapterId || propChapterId || '')
      const params = new URLSearchParams({ group, periodType })
      if ((group === 'MEMBER' || group === 'LT') && activeChapId) {
        params.set('chapterId', activeChapId)
      }
      if (periodId) {
        params.set('periodId', periodId)
      }

      const res = await apiFetch<any>(`/api/v1/leaderboard?${params.toString()}`, { noCache: forceRefresh })

      // Nếu request mới hơn đã chạy, bỏ qua response cũ này để tránh hiện sai dữ liệu
      if (currentSeq !== requestSeqRef.current) return

      if (!res.ok) {
        setItems([])
        setLeaderboardState('ERROR')
        setAccessError(res.error?.message || 'Không tải được bảng xếp hạng trong phạm vi của bạn.')
        return
      }

      const data = res.data || {}
      setLeaderboardState(data.state || '')
      setExcludedChapters(data.excluded || [])
      const list: LeaderboardItem[] = (data.items || []).map((item: any, idx: number) => ({
        ...item,
        rank: item.rank ?? idx + 1,
        chapterId: item.chapterId || item.id,
        displayName: item.displayName || item.name || (item.email ? item.email.split('@')[0] : 'Thành viên'),
        name: item.name || item.displayName,
        score: item.score ?? null,
        stars: item.stars ?? item.totalStars ?? 0,
        memberCount: item.memberCount ?? 0,
        atLeast70Percent: item.atLeast70Percent ?? null,
        kpiStatus: item.kpiStatus || item.kpi?.status || null,
        departmentName: item.departmentName || item.groupName || (group === 'DNA' ? (item.dnaUnitName || 'Khối DNA') : '—'),
        positionName: item.positionName || (group === 'LT' ? 'Ban Lãnh Đạo (LT)' : group === 'DNA' ? 'Thành viên DNA' : 'Thành viên'),
      }))
      setItems(list)
    } catch (err: any) {
      if (currentSeq !== requestSeqRef.current) return
      setItems([])
      setLeaderboardState('ERROR')
      setAccessError(err?.message || 'Lỗi tải dữ liệu bảng xếp hạng.')
    } finally {
      if (currentSeq === requestSeqRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [group, periodType, periodId, selectedChapterId, isGlobal, currentUser, propChapterId, refreshCurrentUser])

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
        {/* Hàng 1: Tab Đối tượng (chỉ hiển thị các tab được phép cho role này) */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-2xl">
            {allowedGroups.includes('MEMBER') && (
              <button
                type="button"
                onClick={() => setGroup('MEMBER')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                  group === 'MEMBER'
                    ? 'bg-white text-[#2563EB] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                👤 Thành viên
              </button>
            )}
            {allowedGroups.includes('LT') && (
              <button
                type="button"
                onClick={() => setGroup('LT')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                  group === 'LT'
                    ? 'bg-white text-[#2563EB] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                👑 LT
              </button>
            )}
            {allowedGroups.includes('DNA') && (
              <button
                type="button"
                onClick={() => setGroup('DNA')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                  group === 'DNA'
                    ? 'bg-white text-[#2563EB] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                🧬 Khối DNA
              </button>
            )}
            {allowedGroups.includes('CHAPTER') && (
              <button
                type="button"
                onClick={() => setGroup('CHAPTER')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                  group === 'CHAPTER'
                    ? 'bg-white text-[#2563EB] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                🏛️ Toàn Chapter
              </button>
            )}
          </div>

          {/* Hàng 2: Chu kỳ Tháng / Nhiệm kỳ */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-2xl">
            <button
              type="button"
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
              type="button"
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

        {/* Bộ chọn kỳ & Chip nhanh theo tháng */}
        <div className="flex flex-col gap-2 pt-2 border-t border-slate-100 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold text-slate-600 shrink-0">Kỳ xếp hạng:</span>
            <select
              value={periodId}
              onChange={(event) => setPeriodId(event.target.value)}
              className="max-w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 font-semibold text-slate-800 outline-none focus:border-blue-500 sm:max-w-xs"
            >
              <option value="">Kỳ hiện tại (Mặc định)</option>
              {periodType === 'MONTH'
                ? periodCatalog.months.map((month) => (
                    <option key={month.id} value={month.key}>
                      Tháng {month.key} {month.hasData ? '• 🟢 [Có dữ liệu]' : '• ⚪ [Chưa có dữ liệu]'}
                    </option>
                  ))
                : (group === 'CHAPTER' || group === 'DNA' || !selectedChapterId
                    ? periodCatalog.seasons
                    : periodCatalog.terms.filter((term) => !selectedChapterId || term.chapter_id === selectedChapterId)
                  ).map((term: any) => (
                    <option key={term.id} value={term.id}>
                      {term.code || `${term.chapterName || 'Chapter'} · ${new Date(term.starts_at).toLocaleDateString('vi-VN')}`}
                    </option>
                  ))}
            </select>
          </div>

          {/* Quick-select chips cho danh sách tháng, hiển thị trạng thái có dữ liệu màu xanh */}
          {periodType === 'MONTH' && periodCatalog.months.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] font-medium text-slate-400 mr-1">Chọn nhanh:</span>
              <button
                type="button"
                onClick={() => setPeriodId('')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition border ${
                  periodId === ''
                    ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-2xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                Kỳ hiện tại
              </button>
              {periodCatalog.months.slice(0, 6).map((m: any) => {
                const isSelected = periodId === m.key
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPeriodId(m.key)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition border ${
                      isSelected
                        ? 'bg-blue-600 border-blue-600 text-white shadow-2xs'
                        : m.hasData
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                        : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100'
                    }`}
                    title={m.hasData ? `Tháng ${m.key}: Có dữ liệu xếp hạng` : `Tháng ${m.key}: Chưa có dữ liệu`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : m.hasData ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    {m.key}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Lọc theo Chapter nếu xem Thành viên hoặc LT (Khối DNA không dùng Chapter) */}
        {(group === 'MEMBER' || group === 'LT') && showChapterSelector && chapterList.length > 0 && (
          <div className="flex items-center gap-3 pt-2 border-t border-slate-100 text-xs">
            <span className="font-semibold text-slate-600 shrink-0">Lọc theo Chapter:</span>
            <select
              value={selectedChapterId}
              onChange={(e) => setSelectedChapterId(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 font-semibold text-slate-800 outline-none focus:border-blue-500 max-w-xs"
            >
              <option value="">{isGlobal ? 'Tất cả Chapter (Toàn hệ thống)' : 'Chapter của bạn'}</option>
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
      {accessError ? (
        <Card className="space-y-3 border border-rose-200 bg-rose-50 p-8 text-center text-rose-800 rounded-3xl">
          <div className="text-3xl">🔒</div>
          <h3 className="text-base font-bold">Không có quyền xem bảng xếp hạng</h3>
          <p className="text-sm">{accessError}</p>
          <button type="button" onClick={() => loadLeaderboardData(true)} className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 transition">
            Thử lại
          </button>
        </Card>
      ) : leaderboardState === 'AWAITING_CUTOVER' ? (
        <Card className="p-12 text-center text-sm text-slate-600 rounded-3xl space-y-2">
          <div className="text-4xl">⏳</div>
          <h3 className="text-base font-bold text-[#172554]">Kỳ chưa được kích hoạt</h3>
          <p className="text-xs text-slate-500">Bảng xếp hạng đang chờ Quản trị viên kích hoạt chu kỳ học tập.</p>
        </Card>
      ) : leaderboardState === 'PERIOD_UNAVAILABLE' ? (
        <Card className="p-12 text-center text-sm text-slate-600 rounded-3xl space-y-2">
          <div className="text-4xl">🔍</div>
          <h3 className="text-base font-bold text-[#172554]">Kỳ xếp hạng chưa mở</h3>
          <p className="text-xs text-slate-500">Chưa có thông tin kỳ thi đua hoặc kỳ được chọn chưa diễn ra.</p>
        </Card>
      ) : leaderboardState === 'AWAITING_SNAPSHOT' ? (
        <Card className="p-12 text-center text-sm text-slate-600 rounded-3xl space-y-2">
          <div className="text-4xl">📸</div>
          <h3 className="text-base font-bold text-[#172554]">Đang chờ chốt bảng xếp hạng</h3>
          <p className="text-xs text-slate-500">Kỳ đã kết thúc và đang trong tiến trình chốt snapshot thành tích chính thức.</p>
        </Card>
      ) : leaderboardState === 'WAITING_KPI' ? (
        <Card className="p-12 text-center text-sm text-slate-600 rounded-3xl space-y-2">
          <div className="text-4xl">📊</div>
          <h3 className="text-base font-bold text-[#172554]">Đang chờ cập nhật KPI</h3>
          <p className="text-xs text-slate-500">Tháng đã kết thúc, đang chờ tổng hợp dữ liệu KPI chính thức từ Chapter.</p>
        </Card>
      ) : loading ? (
        <Card className="p-16 text-center text-[#737686] rounded-3xl">
          <div className="w-10 h-10 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-xs font-medium">Đang tải bảng xếp hạng…</p>
        </Card>
      ) : items.length === 0 ? (
        <Card className="p-16 text-center text-[#737686] space-y-2 rounded-3xl">
          <div className="text-5xl">⭐</div>
          <h3 className="text-base font-bold text-[#172554]">Chưa có dữ liệu xếp hạng</h3>
          <p className="text-xs max-w-md mx-auto">
            Chưa có thành viên hoặc Chapter nào ghi nhận thành tích (0 sao) trong kỳ này.
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
                    {group !== 'CHAPTER' && canViewProfile && (topThree[1].userId || topThree[1].id) ? (
                      <button
                        type="button"
                        onClick={() => handleOpenProfile((topThree[1].userId || topThree[1].id)!, topThree[1].chapterId)}
                        className="hover:text-[#2563EB] hover:underline cursor-pointer transition-colors"
                      >
                        {topThree[1].displayName}
                      </button>
                    ) : (
                      <span>{topThree[1].displayName}</span>
                    )}
                    {isCurrentUserItem(topThree[1]) && (
                      <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black bg-[#2563EB] text-white">
                        Bạn
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#737686] truncate mb-3">
                    {group === 'CHAPTER'
                      ? `${topThree[1].memberCount || 0} học viên • Đạt ≥70%: ${topThree[1].atLeast70Percent !== null && topThree[1].atLeast70Percent !== undefined ? `${topThree[1].atLeast70Percent}%` : '—'}`
                      : `${topThree[1].positionName || 'Thành viên'} • ${topThree[1].departmentName || (group === 'DNA' ? 'Khối DNA' : '—')}${isGlobal && topThree[1].chapterName ? ` • ${topThree[1].chapterName}` : ''}`}
                  </p>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-800 rounded-full text-sm font-black border border-slate-200">
                    <span>{group === 'CHAPTER' ? '🏆 Điểm:' : '⭐'}</span>{' '}
                    {group === 'CHAPTER'
                      ? formatChapterScore(topThree[1].score)
                      : (topThree[1].stars ?? 0).toLocaleString('vi-VN')}
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
                    {group !== 'CHAPTER' && canViewProfile && (topThree[0].userId || topThree[0].id) ? (
                      <button
                        type="button"
                        onClick={() => handleOpenProfile((topThree[0].userId || topThree[0].id)!, topThree[0].chapterId)}
                        className="hover:text-[#2563EB] hover:underline cursor-pointer transition-colors"
                      >
                        {topThree[0].displayName}
                      </button>
                    ) : (
                      <span>{topThree[0].displayName}</span>
                    )}
                    {isCurrentUserItem(topThree[0]) && (
                      <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black bg-[#2563EB] text-white">
                        Bạn
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#737686] truncate mb-3">
                    {group === 'CHAPTER'
                      ? `${topThree[0].memberCount || 0} học viên • Đạt ≥70%: ${topThree[0].atLeast70Percent !== null && topThree[0].atLeast70Percent !== undefined ? `${topThree[0].atLeast70Percent}%` : '—'}`
                      : `${topThree[0].positionName || 'Thành viên'} • ${topThree[0].departmentName || (group === 'DNA' ? 'Khối DNA' : '—')}${isGlobal && topThree[0].chapterName ? ` • ${topThree[0].chapterName}` : ''}`}
                  </p>
                  <div className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-amber-100 text-amber-900 rounded-full text-base font-black border border-amber-300 shadow-inner">
                    <span>{group === 'CHAPTER' ? '🏆 Điểm:' : '⭐'}</span>{' '}
                    {group === 'CHAPTER'
                      ? formatChapterScore(topThree[0].score)
                      : (topThree[0].stars ?? 0).toLocaleString('vi-VN')}
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
                    {group !== 'CHAPTER' && canViewProfile && (topThree[2].userId || topThree[2].id) ? (
                      <button
                        type="button"
                        onClick={() => handleOpenProfile((topThree[2].userId || topThree[2].id)!, topThree[2].chapterId)}
                        className="hover:text-[#2563EB] hover:underline cursor-pointer transition-colors"
                      >
                        {topThree[2].displayName}
                      </button>
                    ) : (
                      <span>{topThree[2].displayName}</span>
                    )}
                    {isCurrentUserItem(topThree[2]) && (
                      <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black bg-[#2563EB] text-white">
                        Bạn
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#737686] truncate mb-3">
                    {group === 'CHAPTER'
                      ? `${topThree[2].memberCount || 0} học viên • Đạt ≥70%: ${topThree[2].atLeast70Percent !== null && topThree[2].atLeast70Percent !== undefined ? `${topThree[2].atLeast70Percent}%` : '—'}`
                      : `${topThree[2].positionName || 'Thành viên'} • ${topThree[2].departmentName || (group === 'DNA' ? 'Khối DNA' : '—')}${isGlobal && topThree[2].chapterName ? ` • ${topThree[2].chapterName}` : ''}`}
                  </p>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-900 rounded-full text-sm font-black border border-amber-200">
                    <span>{group === 'CHAPTER' ? '🏆 Điểm:' : '⭐'}</span>{' '}
                    {group === 'CHAPTER'
                      ? formatChapterScore(topThree[2].score)
                      : (topThree[2].stars ?? 0).toLocaleString('vi-VN')}
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
                    <th className="py-3.5 px-6">{group === 'CHAPTER' ? 'Chapter' : 'Họ và tên'}</th>
                    <th className="py-3.5 px-6">{group === 'CHAPTER' ? 'Quy mô' : 'Ban / Đơn vị'}</th>
                    {isGlobal && group !== 'CHAPTER' && group !== 'DNA' && (
                      <th className="py-3.5 px-6">Chapter</th>
                    )}
                    {group === 'CHAPTER' && periodType === 'TERM' && (
                      <th className="py-3.5 px-6 text-center">Tháng đạt chuẩn</th>
                    )}
                    <th className="py-3.5 px-6 text-right">
                      {group === 'CHAPTER' ? 'Điểm BXH' : 'Tổng ⭐ Star'}
                    </th>
                    <th className="py-3.5 px-6 text-center">
                      {group === 'CHAPTER' ? (periodType === 'TERM' ? 'Trạng thái' : 'KPI Tháng') : 'Tiến độ'}
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

                        {/* Tên, Chức vụ & Nhãn Bạn */}
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
                              {group !== 'CHAPTER' && canViewProfile && (item.userId || item.id) ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpenProfile((item.userId || item.id)!, item.chapterId)}
                                  className="text-left group cursor-pointer block"
                                >
                                  <p className="font-bold text-[#172554] group-hover:text-[#2563EB] transition-colors truncate flex items-center gap-2">
                                    <span>{item.displayName || item.name}</span>
                                    {isYou && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-[#2563EB] text-white shadow-2xs">
                                        Bạn
                                      </span>
                                    )}
                                  </p>
                                  {item.positionName && (
                                    <span className="text-[11px] text-slate-500 font-medium block truncate">
                                      {item.positionName}
                                    </span>
                                  )}
                                  {item.email && currentUser && (
                                    <p className="text-[11px] text-[#737686] group-hover:text-[#2563EB] transition-colors truncate">{item.email}</p>
                                  )}
                                </button>
                              ) : (
                                <>
                                  <p className="font-bold text-[#172554] truncate flex items-center gap-2">
                                    <span>{item.displayName || item.name}</span>
                                    {isYou && (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-[#2563EB] text-white shadow-2xs">
                                        Bạn
                                      </span>
                                    )}
                                  </p>
                                  {group !== 'CHAPTER' && item.positionName && (
                                    <span className="text-[11px] text-slate-500 font-medium block truncate">
                                      {item.positionName}
                                    </span>
                                  )}
                                  {item.email && currentUser && group !== 'CHAPTER' && (
                                    <p className="text-[11px] text-[#737686] truncate">{item.email}</p>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Ban / Đơn vị / Quy mô */}
                        <td className="py-4 px-6">
                          {group === 'CHAPTER' ? (
                            <span className="inline-block px-2.5 py-1 rounded-full bg-blue-50 text-[#2563EB] text-xs font-bold">
                              {item.memberCount || 0} học viên
                            </span>
                          ) : (
                            <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                              {item.departmentName || (group === 'DNA' ? (item.dnaUnitName || 'Khối DNA') : '—')}
                            </span>
                          )}
                        </td>

                        {/* Chapter (nếu xem bảng Thành viên / LT toàn hệ thống) */}
                        {isGlobal && group !== 'CHAPTER' && group !== 'DNA' && (
                          <td className="py-4 px-6">
                            <span className="text-xs font-semibold text-slate-700">
                              {item.chapterName || '—'}
                            </span>
                          </td>
                        )}

                        {/* Tháng đạt chuẩn (khi xem Chapter theo Nhiệm kỳ) */}
                        {group === 'CHAPTER' && periodType === 'TERM' && (
                          <td className="py-4 px-6 text-center">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700">
                              {(item as any).qualifiedMonthCount ?? 0} tháng
                            </span>
                          </td>
                        )}

                        {/* Star hoặc Điểm BXH (Hiển thị 3 chữ số thập phân cho Chapter) */}
                        <td className="py-4 px-6 text-right">
                          <span className="inline-flex items-center gap-1 font-extrabold text-amber-600 bg-amber-50 px-3 py-1 rounded-xl border border-amber-200">
                            ⭐ {group === 'CHAPTER'
                              ? formatChapterScore(item.score)
                              : (item.stars ?? 0).toLocaleString('vi-VN')}
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
                                  : item.kpiStatus === 'RED'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {item.kpiStatus === 'GREEN'
                                ? 'Xanh'
                                : item.kpiStatus === 'YELLOW'
                                ? 'Vàng'
                                : item.kpiStatus === 'RED'
                                ? 'Đỏ'
                                : 'Chờ KPI'}
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
                Theo thể lệ BBE, Chapter cần <strong>trên 20</strong> thành viên, tỷ lệ đạt ≥70% bài lõi tối thiểu 50% và KPI Vàng hoặc Xanh.
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 pt-1">
                {excludedChapters.map((ch: any) => (
                  <div key={ch.chapterId || ch.id} className="p-3 bg-white border border-amber-200 rounded-2xl text-xs space-y-1">
                    <p className="font-bold text-[#172554]">{ch.name}</p>
                    <div className="flex flex-col gap-0.5 text-slate-600">
                      {(ch.reasons || []).map((r: string, rIdx: number) => (
                        <span key={rIdx} className="text-amber-800 font-medium">
                          • {r === 'MEMBER_COUNT_NOT_ABOVE_20' || r === 'MINIMUM_MEMBERS' ? `Chưa có trên 20 thành viên (${ch.memberCount ?? ch.averageMemberCount ?? 0})` : r === 'CORE_COMPLETION_BELOW_50_PERCENT' || r === 'COMPLETION_THRESHOLD' ? `Chưa đạt 50% thành viên ≥70% bài lõi` : r === 'KPI_NOT_ELIGIBLE' ? 'KPI không phải Vàng/Xanh' : r}
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
                <li><strong>Video bài giảng:</strong> Nhận 1 Star cho mỗi phút thời lượng chuẩn (tối thiểu 1 Star), chỉ khi backend xác nhận đã xem đủ nội dung.</li>
                <li><strong>Quiz bài học:</strong> Đạt điểm từ <strong>≥ 85%</strong> trở lên mới nhận sao. Áp dụng cơ chế <em>High-Water Mark</em>: làm lại đạt điểm cao hơn kỷ lục cũ sẽ nhận phần sao chênh lệch.</li>
                <li><strong>Bài thi cuối khóa:</strong> Đạt từ <strong>≥ 85%</strong> trở lên nhận thưởng sao cuối khóa.</li>
                <li><strong>Quy tắc phá hòa cá nhân:</strong> Ưu tiên tổng Star cao hơn; nếu bằng nhau, ưu tiên người đạt mốc sao cuối sớm hơn tính từ đầu kỳ (chính xác đến giây); nếu tiếp tục bằng nhau thì <strong>đồng hạng</strong>. Không dùng ID/tên để phân hạng.</li>
              </ul>
            </div>

            {/* Mục 2: Khối DNA */}
            <div className="bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100 space-y-1.5">
              <h4 className="font-bold text-sm text-emerald-800">2. Xếp Hạng Khối DNA</h4>
              <ul className="list-disc pl-4 space-y-1">
                <li>Chỉ tính thành viên <strong>SGDC</strong> và <strong>LDC</strong> hợp lệ. Thành viên nhóm <strong>TT</strong> và tài khoản <strong>Lead DNA / Admin</strong> không tham gia thi đua.</li>
                <li><strong>Chu kỳ nhiệm kỳ DNA:</strong> Cố định kết thúc vào 31/03 và 30/09; ranh giới xử lý lúc 00:00 ngày 01/04 và 01/10 theo giờ Việt Nam.</li>
              </ul>
            </div>

            {/* Mục 3: Toàn Chapter */}
            <div className="bg-amber-50/50 p-4 rounded-2xl border border-amber-100 space-y-1.5">
              <h4 className="font-bold text-sm text-amber-900">3. Xếp Hạng Toàn Chapter</h4>
              <ul className="list-disc pl-4 space-y-1">
                <li>
                  <strong>Công thức tính điểm tháng:</strong>
                  <div className="my-1.5 p-2 bg-white rounded-xl border border-amber-200 font-mono text-center font-bold text-amber-900 space-y-1">
                    <div>Tháng thường: S_m = A_m / N_m</div>
                    <div className="text-[11px] text-amber-800">Tháng có chuyển giao: S_m = A_1 / N_1 + A_2 / N_2</div>
                  </div>
                  <p className="text-[11px] text-amber-900/90">
                    A_m, A_1, A_2: Tổng Star hợp lệ trong kỳ/giai đoạn. N_m, N_1, N_2: Quân số snapshot hợp lệ tại mốc chốt.
                  </p>
                </li>
                <li>
                  <strong>Phân bổ điểm tháng chuyển giao vào 2 nhiệm kỳ:</strong>
                  Điểm giai đoạn trước chuyển giao (A_1/N_1) được cộng vào nhiệm kỳ cũ; điểm giai đoạn sau chuyển giao (A_2/N_2) được cộng vào nhiệm kỳ mới.
                </li>
                <li><strong>Điều kiện Chapter đủ tư cách tham gia:</strong>
                  <ul className="list-circle pl-4 mt-0.5 space-y-0.5">
                    <li>Quân số Chapter phải <strong>lớn hơn 20 thành viên</strong> (20 bị loại, 21 đạt).</li>
                    <li>Tối thiểu <strong>50%</strong> thành viên đạt tiến độ từ <strong>70%</strong> tổng bài lõi đã xuất bản của cả 3 chương trình (Thành viên, LT, DNA).</li>
                    <li>KPI tháng phải là <strong>Vàng</strong> hoặc <strong>Xanh</strong>.</li>
                  </ul>
                </li>
                <li>
                  <strong>Độ chính xác & Quy tắc phá hòa Chapter:</strong>
                  <ul className="list-circle pl-4 mt-0.5 space-y-0.5">
                    <li>Điểm xếp hạng được tính toán và so sánh ở <strong>độ chính xác cao (chưa làm tròn)</strong>. Giao diện hiển thị 3 chữ số thập phân.</li>
                    <li><strong>Phá hòa theo tháng:</strong> Nếu bằng điểm thực, ưu tiên Chapter có thời điểm nhận Star hợp lệ cuối cùng sớm hơn trong tháng (chính xác đến giây); nếu bằng thì đồng hạng.</li>
                    <li><strong>Phá hòa theo nhiệm kỳ:</strong> Nếu bằng điểm thực, ưu tiên Chapter có <strong>nhiều tháng đủ điều kiện</strong> trên BXH hơn; nếu bằng cả hai thì đồng hạng.</li>
                  </ul>
                </li>
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

      {/* Modal Profile Học viên */}
      <Modal
        isOpen={Boolean(selectedUserId)}
        onClose={() => { setSelectedUserId(null); setSelectedUserData(null); }}
        maxWidth="max-w-5xl"
      >
        {loadingProfile && !selectedUserData ? (
          <div className="py-12 flex flex-col items-center justify-center">
            <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="mt-2 text-xs text-slate-500 font-medium">Đang tải hồ sơ thành viên...</p>
          </div>
        ) : selectedUserData ? (
          <div className="p-4 max-h-[80vh] overflow-y-auto">
            <LearnerProfileView
              user={{
                userId: selectedUserData.user?.userId || selectedUserId || '',
                displayName: selectedUserData.user?.displayName,
                email: selectedUserData.user?.email,
                status: selectedUserData.user?.status,
                accountState: selectedUserData.user?.accountState,
                role: selectedUserData.user?.role,
                chapterName: selectedUserData.user?.chapterName || selectedUserData.user?.chapter?.name,
                departmentName: selectedUserData.user?.departmentName || selectedUserData.user?.department?.name,
                createdAt: selectedUserData.user?.joinedAt || selectedUserData.user?.createdAt,
                deactivatedByRole: selectedUserData.user?.deactivatedByRole,
              }}
              progressData={{
                summary: selectedUserData.summary,
                courses: selectedUserData.courses,
                learningDetail: selectedUserData.learningDetail,
              }}
              loading={loadingProfile}
              onRefresh={() => selectedUserId && handleOpenProfile(selectedUserId)}
            />
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
