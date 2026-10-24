'use client';
import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import MonthPicker from '@/components/ui/MonthPicker';
import LearnerProfileView from '@/components/learner/LearnerProfileView';
import { apiFetch, getCachedApiData } from '@/lib/api/client';
import { useAdmin } from '../AdminContext';

export default function AdminChaptersProgressPage() {
  const { mounted } = useAdmin();

  const [chapters, setChapters] = useState<any[]>([]);
  const [excludedChapters, setExcludedChapters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaderboardMonth, setLeaderboardMonth] = useState('');
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [selectedChapter, setSelectedChapter] = useState<any | null>(null);

  // Drill-down Modal state: Level 1 = Chapter detail, Level 2 = Member profile
  const [modalLevel, setModalLevel] = useState<1 | 2>(1);
  const [chapterMembers, setChapterMembers] = useState<any[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberPage, setMemberPage] = useState(1);
  const [memberLimit, setMemberLimit] = useState(20);
  const [memberTotal, setMemberTotal] = useState(0);
  const [memberTotalPages, setMemberTotalPages] = useState(1);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberRoleFilter, setMemberRoleFilter] = useState('');

  // Level 2 member profile state
  const [selectedMemberSummary, setSelectedMemberSummary] = useState<any | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberProfileData, setMemberProfileData] = useState<any | null>(null);
  const [memberProfileLoading, setMemberProfileLoading] = useState(false);
  const [memberProfileError, setMemberProfileError] = useState<string | null>(null);
  const profileRequestIdRef = useRef(0);
  const modalScrollRef = useRef<HTMLDivElement>(null);
  const savedScrollTopRef = useRef<number>(0);

  const [kpiHistory, setKpiHistory] = useState<any[]>([]);
  const [kpiForm, setKpiForm] = useState({ month: new Date().toISOString().slice(0, 7), status: 'YELLOW', note: '' });
  const [kpiSaving, setKpiSaving] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
  };

  useEffect(() => {
    const cached = getCachedApiData<any>('/api/v1/leaderboard/chapters');
    if (cached?.items) {
      setChapters(cached.items);
      setExcludedChapters(cached.excluded || []);
      setLeaderboardMonth(cached.monthKey || String(cached.month || '').slice(0, 7));
      setAvailableMonths(cached.availableMonths || []);
      setLoading(false);
    } else {
      void loadChapters();
    }
  }, []);

  async function loadChapters(month?: string) {
    if (loading && month !== undefined) return; // Không cho chuyển tháng liên tục
    setLoading(true);
    try {
      const res = await apiFetch(`/api/v1/leaderboard/chapters${month ? `?month=${month}` : ''}`, { noCache: true });
      if (res.ok && res.data) {
        setChapters(res.data.items || []);
        setExcludedChapters(res.data.excluded || []);
        setLeaderboardMonth(res.data.monthKey || String(res.data.month || '').slice(0, 7));
        setAvailableMonths(res.data.availableMonths || []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadChapterMembers(
    chapterId: string,
    targetPage = 1,
    targetLimit = memberLimit,
    query = memberSearch,
    roleType = memberRoleFilter
  ) {
    setMembersLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        limit: String(targetLimit),
        includeInactive: '1',
      });
      if (query.trim()) params.set('search', query.trim());
      if (roleType) params.set('roleType', roleType);

      const res = await apiFetch(`/api/v1/chapters/${chapterId}/dashboard/members?${params.toString()}`, { noCache: true });
      if (res.ok && res.data) {
        setChapterMembers(res.data.items || []);
        setMemberTotal(res.data.totalItems ?? (res.data.items || []).length);
        setMemberTotalPages(res.data.totalPages || Math.ceil((res.data.totalItems || 0) / targetLimit) || 1);
        setMemberPage(targetPage);
      } else {
        setChapterMembers([]);
        setMemberTotal(0);
        setMemberTotalPages(1);
        showToast('error', res.error?.message || 'Không thể tải danh sách thành viên chapter.');
      }
    } catch {
      setChapterMembers([]);
      setMemberTotal(0);
      setMemberTotalPages(1);
      showToast('error', 'Lỗi khi tải thành viên chapter.');
    } finally {
      setMembersLoading(false);
    }
  }

  async function handleOpenChapterDrillDown(chapter: any) {
    setSelectedChapter(chapter);
    setModalLevel(1);
    setMemberPage(1);
    setMemberSearch('');
    setMemberRoleFilter('');
    setChapterMembers([]);
    setMemberTotal(0);
    setMemberTotalPages(1);
    setKpiHistory([]);
    setSelectedMemberSummary(null);
    setSelectedMemberId(null);
    setMemberProfileData(null);
    setMemberProfileError(null);

    const chapterId = chapter.chapterId || chapter.id;
    void loadChapterMembers(chapterId, 1, memberLimit, '', '');
    apiFetch(`/api/v1/chapters/${chapterId}/kpi`, { noCache: true }).then((kpiRes) => {
      if (kpiRes.ok) setKpiHistory(kpiRes.data?.items || []);
    }).catch(() => {});
  }

  async function handleOpenMemberProfile(member: any) {
    if (modalScrollRef.current) {
      savedScrollTopRef.current = modalScrollRef.current.scrollTop;
    }
    const memberId = member.userId || member.id;
    const chapterId = selectedChapter?.chapterId || selectedChapter?.id || 'all';

    setSelectedMemberSummary(member);
    setSelectedMemberId(memberId);
    setMemberProfileData(null);
    setMemberProfileError(null);
    setModalLevel(2);
    setMemberProfileLoading(true);

    const reqId = ++profileRequestIdRef.current;
    try {
      const res = await apiFetch(`/api/v1/chapters/${chapterId}/members/${memberId}/course-progress`, { noCache: true });
      if (reqId !== profileRequestIdRef.current) return;
      if (res.ok && res.data) {
        setMemberProfileData(res.data);
      } else {
        setMemberProfileError(res.error?.message || 'Không thể tải hồ sơ chi tiết học viên.');
      }
    } catch {
      if (reqId !== profileRequestIdRef.current) return;
      setMemberProfileError('Lỗi kết nối khi tải hồ sơ học viên.');
    } finally {
      if (reqId === profileRequestIdRef.current) {
        setMemberProfileLoading(false);
      }
    }
  }

  function handleBackToChapter() {
    profileRequestIdRef.current += 1;
    setModalLevel(1);
    setSelectedMemberSummary(null);
    setSelectedMemberId(null);
    setMemberProfileData(null);
    setMemberProfileError(null);
    setMemberProfileLoading(false);

    requestAnimationFrame(() => {
      if (modalScrollRef.current) {
        modalScrollRef.current.scrollTop = savedScrollTopRef.current;
      }
    });
  }

  function handleCloseModal() {
    profileRequestIdRef.current += 1;
    setSelectedChapter(null);
    setModalLevel(1);
    setSelectedMemberSummary(null);
    setSelectedMemberId(null);
    setMemberProfileData(null);
    setMemberProfileError(null);
    setMemberProfileLoading(false);
  }

  async function saveKpi() {
    if (!selectedChapter) return;
    setKpiSaving(true);
    const chapterId = selectedChapter.chapterId || selectedChapter.id;
    const res = await apiFetch(`/api/v1/chapters/${chapterId}/kpi`, { method: 'PUT', body: JSON.stringify({ month: kpiForm.month, status: kpiForm.status, note: kpiForm.note.trim() }) });
    if (res.ok) {
      showToast('success', 'Đã cập nhật KPI tháng.');
      const history = await apiFetch(`/api/v1/chapters/${chapterId}/kpi`, { noCache: true });
      if (history.ok) setKpiHistory(history.data?.items || []);
      loadChapters(leaderboardMonth);
    } else showToast('error', res.error?.message || 'Không cập nhật được KPI.');
    setKpiSaving(false);
  }

  const getMedal = (rank: number) => {
    if (rank === 0) return '🥇';
    if (rank === 1) return '🥈';
    if (rank === 2) return '🥉';
    return `#${rank + 1}`;
  };

  const totalMembersAll = chapters.reduce((sum, ch) => sum + (ch.memberCount || 0), 0);
  const averageChapterCompletion = chapters.length
    ? Math.round(chapters.reduce((sum, chapter) => sum + (chapter.completion?.atLeast70Percent || 0), 0) / chapters.length)
    : 0;
  const averageStarsPerMember = totalMembersAll
    ? Math.round(chapters.reduce((sum, chapter) => sum + (chapter.stars?.averagePerMember || 0) * (chapter.memberCount || 0), 0) / totalMembersAll * 10) / 10
    : 0;

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Bảng xếp hạng Chapter
          </h1>
          <p className="text-[#737686] mt-1 text-sm">
            Xếp hạng theo độ đồng đều học tập, ⭐ bình quân/thành viên, KPI và quy mô Chapter
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/admin/users">
            <Button variant="secondary">👥 Quản lý tài khoản</Button>
          </Link>
          <Link href="/admin/invitations">
            <Button>✉️ Mời Lead</Button>
          </Link>
        </div>
      </div>

      <Card className="mb-6 border border-blue-200 bg-blue-50/60 p-5">
        <h2 className="font-bold text-[#172554]">Công thức xếp hạng & Đánh giá KPI Chapter (Quy chế v4)</h2>
        <p className="mt-2 text-sm text-[#434655]">
          Bấm <strong>“KPI & lịch sử”</strong> tại bất kỳ Chapter nào để nhập trạng thái KPI (Xanh, Vàng, Đỏ, Đen) cho tháng hiện tại hoặc các tháng trước.
        </p>
        <div className="mt-4 grid gap-3 rounded-2xl border border-blue-200 bg-white p-4 text-sm md:grid-cols-2">
          <div>
            <div className="font-bold text-[#2563EB]">⭐ Điểm xếp hạng = Tổng Star / quân số active</div>
            <p className="text-xs text-[#737686] mt-1">
              Công thức chính thức: <strong>S_m = A_m / N_m</strong> (tổng Star trong kỳ chia quân số active bình quân).
              Tháng có chuyển giao dùng snapshot theo chặng, quân số được trọng số theo thời lượng chặng; không dùng công thức cộng dồn hay trọng số cũ.
            </p>
          </div>
          <div>
            <div className="font-bold text-emerald-700">🟢 Điều kiện tham gia xếp hạng</div>
            <ul className="text-xs text-[#737686] mt-1 list-disc list-inside space-y-0.5">
              <li>Số thành viên bình quân <strong>&gt; 20 người</strong></li>
              <li>Tối thiểu <strong>50%</strong> thành viên đạt <strong>&ge; 70%</strong> bài học bắt buộc</li>
              <li>KPI tháng đạt <strong>Xanh</strong> hoặc <strong>Vàng</strong> (KPI Đỏ hoặc Đen bị loại)</li>
            </ul>
          </div>
        </div>
      </Card>

      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-[#eff4ff] bg-white p-4 shadow-sm">
        <strong className="text-sm text-[#172554]">Kỳ bảng xếp hạng:</strong>
        <MonthPicker
          value={leaderboardMonth}
          onChange={(m) => void loadChapters(m)}
          availableMonths={availableMonths}
          disabled={loading}
        />
      </div>

      {/* Stat Cards */}
      <div className="relative mb-6">
        {loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-white/70 backdrop-blur-[2px] pointer-events-none select-none transition-all">
            <div className="flex items-center gap-2.5 rounded-xl bg-white px-4 py-2 shadow-md border border-[#eff4ff]">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
              <span className="text-xs font-semibold text-[#172554]">Đang cập nhật chỉ số...</span>
            </div>
          </div>
        )}
        <div className={`grid grid-cols-2 lg:grid-cols-5 gap-4 transition-opacity duration-200 ${loading ? 'pointer-events-none select-none opacity-40' : ''}`}>
          <Card shadow="md" className="p-4 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-[#737686]">Chapter đủ điều kiện BXH</div>
            <div className="text-2xl font-bold text-[#172554] mt-1">{chapters.length}</div>
            <div className="text-[11px] text-[#737686] mt-0.5">Chapter đỏ/thiếu điều kiện bị loại</div>
          </Card>
          <Card shadow="md" className="p-4 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-blue-700">Tổng thành viên</div>
            <div className="text-2xl font-bold text-[#2563EB] mt-1">{totalMembersAll}</div>
            <div className="text-[11px] text-[#737686] mt-0.5">Học viên tham gia</div>
          </Card>
          <Card shadow="md" className="p-4 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-green-700">% thành viên đạt ≥70%</div>
            <div className="text-2xl font-bold text-green-700 mt-1">{averageChapterCompletion}%</div>
            <div className="text-[11px] text-[#737686] mt-0.5">Trung bình các Chapter đủ điều kiện</div>
          </Card>
          <Card shadow="md" className="p-4 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-amber-700">⭐ Bình quân / thành viên</div>
            <div className="text-2xl font-bold text-amber-600 mt-1">{averageStarsPerMember} ⭐</div>
            <div className="text-[11px] text-[#737686] mt-0.5">Không dùng tổng Star để so quy mô</div>
          </Card>
          <Card shadow="md" className="p-4 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-amber-700">Chapter dẫn đầu</div>
            <div
              className="text-sm lg:text-base font-bold text-amber-600 mt-1 break-words leading-snug"
              title={chapters[0]?.name || 'Chưa có'}
            >
              {chapters[0]?.name || '—'}
            </div>
            <div className="text-[11px] text-[#737686] mt-0.5">Điểm BXH: {chapters[0]?.score || 0}</div>
          </Card>
        </div>
      </div>

      <div className="relative">
        {loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-2xl bg-white/70 backdrop-blur-[2px] pointer-events-none select-none transition-all">
            <div className="flex items-center gap-3 rounded-2xl bg-white px-6 py-4 shadow-xl border border-[#eff4ff]">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
              <span className="text-sm font-semibold text-[#172554]">
                Đang tải bảng xếp hạng Chapter...
              </span>
            </div>
          </div>
        )}

        <div className={`grid items-start gap-6 xl:grid-cols-[300px_minmax(0,1fr)] transition-opacity duration-200 ${loading ? 'pointer-events-none select-none opacity-40' : ''}`}>
          <Card className="p-4 xl:sticky xl:top-24">
            <h2 className="font-bold text-[#172554]">Tất cả Chapter</h2>
            <p className="mb-3 mt-1 text-xs text-[#737686]">Chọn Chapter để nhập KPI và xem lịch sử.</p>
            <div className="max-h-[620px] space-y-2 overflow-auto">
              {[...chapters, ...excludedChapters].sort((a, b) => a.name.localeCompare(b.name, 'vi')).map((chapter) => <button key={chapter.chapterId} onClick={() => !loading && handleOpenChapterDrillDown(chapter)} className="flex w-full items-center justify-between gap-2 rounded-xl border border-[#eff4ff] p-3 text-left text-xs hover:border-blue-300 hover:bg-blue-50">
                <span className="font-semibold text-[#172554]">{chapter.name}</span>
                <span className={`shrink-0 rounded-full px-2 py-1 font-bold ${chapter.reasons?.length ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-700'}`}>{chapter.reasons?.length ? `${chapter.reasons.length} lý do` : `#${chapter.rank}`}</span>
              </button>)}
            </div>
          </Card>
          <div className="min-w-0">
        {/* Chapter Rankings Table */}
        <Card className="p-0 overflow-hidden border border-[#eff4ff] shadow-sm">
          {!mounted || (loading && chapters.length === 0) ? (
            <div className="p-8 space-y-4 animate-pulse">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-16 bg-slate-100 rounded-xl"></div>
              ))}
            </div>
          ) : chapters.length === 0 ? (
            <div className="text-center py-16 text-[#737686]">
              <p className="text-lg font-semibold text-[#172554] mb-1">Chưa có dữ liệu Chapter</p>
              <p className="text-sm text-[#737686]">Vui lòng tạo chapter hoặc mời Trưởng Chapter.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#f8f9ff] text-[#434655] font-semibold border-b border-[#eff4ff]">
                  <tr>
                    <th className="px-6 py-4 w-16 text-center">Hạng</th>
                    <th className="px-6 py-4">Tên Chapter</th>
                    <th className="px-6 py-4 text-center">Thành viên</th>
                    <th className="px-4 py-4 text-center">% đạt ≥70%</th>
                    <th className="px-6 py-4 text-center">⭐ / thành viên</th>
                    <th className="px-3 py-4 text-center whitespace-nowrap">KPI tháng</th>
                    <th className="px-6 py-4 text-center">Điểm BXH</th>
                    <th className="px-6 py-4 text-right">Chi tiết</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eff4ff]">
                  {chapters.map((ch, idx) => (
                    <tr
                      key={ch.chapterId || ch.id || idx}
                      onClick={() => !loading && handleOpenChapterDrillDown(ch)}
                      className="hover:bg-[#f8f9ff] transition cursor-pointer group"
                    >
                      <td className="px-6 py-4 text-center font-bold text-base">
                        {getMedal(idx)}
                      </td>
                      <td className="px-6 py-4 font-bold text-[#172554]">
                        <div className="group-hover:text-[#2563EB] transition-colors">{ch.name}</div>
                        {ch.description && (
                          <p className="text-xs text-[#737686] font-normal mt-0.5 line-clamp-1">{ch.description}</p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center font-medium text-[#434655]">
                        <span className="whitespace-nowrap inline-flex items-center px-2.5 py-0.5 rounded-full bg-blue-50 text-[#2563EB] text-xs font-bold">
                          {ch.memberCount} học viên
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center text-[#172554] font-semibold">
                        <div className="text-base text-green-700">{ch.completion?.atLeast70Percent || 0}%</div>
                      </td>
                      <td className="px-6 py-4 text-center font-extrabold text-[#2563EB] text-base">
                        {ch.stars?.averagePerMember || 0} ⭐
                      </td>
                      <td className="px-3 py-4 text-center whitespace-nowrap">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${ch.kpi?.status === 'GREEN' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>
                          {ch.kpi?.status === 'GREEN' ? '🟢 Xanh (Đạt)' : '🟡 Vàng (Đạt)'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center font-extrabold text-[#172554] text-base">
                        {ch.score}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!loading) handleOpenChapterDrillDown(ch);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#eff4ff] hover:bg-[#2563EB] text-[#2563EB] hover:text-white text-xs font-bold transition-all shadow-xs"
                        >
                          KPI & lịch sử →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {excludedChapters.length > 0 && (
          <Card className="mt-6 border border-amber-200 bg-amber-50/50 shadow-sm">
            <h2 className="font-bold text-[#172554]">Chưa đủ điều kiện tham gia BXH</h2>
            <p className="mt-1 text-xs text-[#737686]">Admin có thể dùng danh sách này để theo dõi Chapter cần hỗ trợ.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {excludedChapters.map((chapter) => <button key={chapter.chapterId} onClick={() => !loading && handleOpenChapterDrillDown(chapter)} className="min-w-[260px] rounded-xl border border-amber-200 bg-white px-4 py-3 text-left text-xs text-[#434655] hover:border-blue-300 hover:shadow-sm">
                <strong>{chapter.name}</strong>
                <span className="mt-2 flex flex-col gap-1">{(chapter.reasons || []).map((reason: string) => <span key={reason} className={`rounded-lg px-2 py-1 font-semibold ${reason === 'WAITING_KPI' || reason === 'KPI_MISSING' ? 'bg-slate-100 text-slate-700' : reason === 'KPI_NOT_ELIGIBLE' || reason.startsWith('KPI_') ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>{reason === 'WAITING_KPI' || reason === 'KPI_MISSING' ? `📅 Chưa nhập KPI tháng ${leaderboardMonth.split('-')[1]}/${leaderboardMonth.split('-')[0]}` : reason === 'MEMBER_COUNT_NOT_ABOVE_20' || reason === 'MINIMUM_MEMBERS' ? `👥 Chưa có trên 20 thành viên (${chapter.memberCount || 0} học viên)` : reason === 'CORE_COMPLETION_BELOW_50_PERCENT' || reason === 'COMPLETION_THRESHOLD' ? `📘 Chưa đạt 50% thành viên ≥70% (${chapter.atLeast70Percent || 0}% đã đạt)` : reason === 'KPI_NOT_ELIGIBLE' || reason === 'KPI_RED' ? '🔴 KPI Đỏ hoặc Đen' : reason === 'ROSTER_ZERO' ? '👥 Không có thành viên' : reason === 'CORE_LESSONS_ZERO' ? '📚 Chưa có bài học cốt lõi' : reason}</span>)}</span>
                <span className="mt-1 block font-semibold text-blue-700">KPI & lịch sử →</span>
              </button>)}
            </div>
          </Card>
        )}
          </div>
        </div>
      </div>

      {/* Modal / Drill-down: Chapter Members & Individual Progress (2 Levels) */}
      <Modal
        isOpen={Boolean(selectedChapter)}
        onClose={handleCloseModal}
        maxWidth="max-w-5xl"
      >
        {selectedChapter && (
          <div ref={modalScrollRef} className="p-6 space-y-5 max-h-[85vh] sm:max-h-[90vh] overflow-y-auto">
            {modalLevel === 1 ? (
              <>
                {/* Level 1 Header: Chapter Info & Actions */}
                <div className="flex justify-between items-start border-b border-[#eff4ff] pb-4 gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="whitespace-nowrap inline-flex items-center text-xs font-bold px-2.5 py-0.5 bg-blue-100 text-[#2563EB] rounded-full">
                        🏛️ Chapter
                      </span>
                      <h3 className="text-2xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                        {selectedChapter.name}
                      </h3>
                    </div>
                    <p className="text-xs text-[#737686] mt-1">
                      Theo dõi tiến độ học tập và bài học hoàn thành của từng học viên trong Chapter
                    </p>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/leaderboard?group=MEMBER&chapterId=${selectedChapter.chapterId || selectedChapter.id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 hover:bg-blue-100 text-[#2563EB] text-xs font-bold rounded-xl transition border border-blue-200"
                      >
                        🏆 Xem Bảng Xếp Hạng Chapter này →
                      </Link>
                    </div>
                  </div>
                  <button
                    onClick={handleCloseModal}
                    className="text-[#737686] hover:text-[#172554] text-xl font-bold p-1 rounded-lg hover:bg-slate-100 transition shrink-0"
                    title="Đóng modal"
                  >
                    ✕
                  </button>
                </div>

                {/* KPI Input Section */}
                <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 space-y-3">
                  <h4 className="font-bold text-[#172554]">Nhập KPI Chapter theo tháng</h4>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input type="month" value={kpiForm.month} onChange={(e) => setKpiForm({ ...kpiForm, month: e.target.value })} className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm bg-white" />
                    <select value={kpiForm.status} onChange={(e) => setKpiForm({ ...kpiForm, status: e.target.value })} className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm bg-white">
                      <option value="BLACK">Đen</option>
                      <option value="RED">Đỏ</option>
                      <option value="YELLOW">Vàng</option>
                      <option value="GREEN">Xanh</option>
                    </select>
                    <Button loading={kpiSaving} onClick={saveKpi}>Lưu KPI</Button>
                  </div>
                  <input value={kpiForm.note} onChange={(e) => setKpiForm({ ...kpiForm, note: e.target.value })} placeholder="Ghi chú KPI" className="w-full rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm bg-white" />
                  <h5 className="text-xs font-bold uppercase tracking-wide text-[#737686]">Lịch sử các tháng</h5>
                  <div className="max-h-36 overflow-auto divide-y divide-blue-100 text-xs">{kpiHistory.map((item, index) => <div key={`${item.month}-${index}`} className="grid grid-cols-3 gap-2 py-2"><span>{new Date(item.month).toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric' })}</span><strong>{item.status}</strong><span>{item.note || 'Không ghi chú'}</span></div>)}{!kpiHistory.length && <p className="py-2 text-[#737686]">Chưa có KPI tháng nào.</p>}</div>
                </div>

                {/* Search & Filter Toolbar */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                  <div className="flex items-center gap-2 flex-1">
                    <div className="relative flex-1 max-w-sm">
                      <input
                        type="text"
                        value={memberSearch}
                        placeholder="Tìm tên hoặc email..."
                        onChange={(e) => setMemberSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const chapId = selectedChapter.chapterId || selectedChapter.id;
                            void loadChapterMembers(chapId, 1, memberLimit, memberSearch, memberRoleFilter);
                          }
                        }}
                        className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-[#cbdbf5] bg-white text-xs text-[#172554] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                      />
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
                    </div>
                    <select
                      value={memberRoleFilter}
                      onChange={(e) => {
                        const nextRole = e.target.value;
                        setMemberRoleFilter(nextRole);
                        const chapId = selectedChapter.chapterId || selectedChapter.id;
                        void loadChapterMembers(chapId, 1, memberLimit, memberSearch, nextRole);
                      }}
                      className="px-2.5 py-1.5 rounded-xl border border-[#cbdbf5] bg-white text-xs font-semibold text-[#172554] focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                    >
                      <option value="">Tất cả thành viên</option>
                      <option value="MEMBER">Học viên thường</option>
                      <option value="LT">Ban Lãnh Đạo (LT)</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        const chapId = selectedChapter.chapterId || selectedChapter.id;
                        void loadChapterMembers(chapId, 1, memberLimit, memberSearch, memberRoleFilter);
                      }}
                      className="px-3 py-1.5 bg-[#2563EB] hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition shadow-xs"
                    >
                      Tìm
                    </button>
                    {(memberSearch || memberRoleFilter) && (
                      <button
                        type="button"
                        onClick={() => {
                          setMemberSearch('');
                          setMemberRoleFilter('');
                          const chapId = selectedChapter.chapterId || selectedChapter.id;
                          void loadChapterMembers(chapId, 1, memberLimit, '', '');
                        }}
                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition"
                      >
                        Đặt lại
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto text-xs text-[#737686]">
                    <span>Số lượng/trang:</span>
                    <select
                      value={memberLimit}
                      onChange={(e) => {
                        const newLimit = Number(e.target.value);
                        setMemberLimit(newLimit);
                        const chapId = selectedChapter.chapterId || selectedChapter.id;
                        void loadChapterMembers(chapId, 1, newLimit, memberSearch, memberRoleFilter);
                      }}
                      className="px-2 py-1 rounded-lg border border-[#cbdbf5] bg-white text-xs font-semibold text-[#172554]"
                    >
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </div>
                </div>

                {/* Total Count Summary & Loading Indicator */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[#737686]">
                  <div>
                    Đang hiển thị <span className="font-bold text-[#2563EB]">{chapterMembers.length}</span> trên tổng số{' '}
                    <span className="font-bold text-[#172554]">{memberTotal}</span> thành viên hợp lệ trong Chapter
                    {memberSearch && ` • Lọc theo: "${memberSearch}"`}
                    {memberRoleFilter && ` • Vai trò: ${memberRoleFilter === 'LT' ? 'Ban Lãnh Đạo (LT)' : 'Học viên thường'}`}
                  </div>
                  {membersLoading && (
                    <span className="inline-flex items-center gap-1.5 text-[#2563EB] font-semibold animate-pulse">
                      <span className="w-2 h-2 rounded-full bg-[#2563EB]" /> Đang tải dữ liệu...
                    </span>
                  )}
                </div>

                {/* Member List */}
                {membersLoading && chapterMembers.length === 0 ? (
                  <div className="py-16 text-center text-[#737686]">
                    <div className="w-8 h-8 border-3 border-[#2563EB] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-xs font-medium">Đang tải danh sách thành viên Chapter...</p>
                  </div>
                ) : chapterMembers.length === 0 ? (
                  <div className="py-12 text-center text-[#737686] bg-slate-50 rounded-2xl border border-slate-100">
                    <p className="font-semibold text-[#172554] mb-1">Không tìm thấy thành viên</p>
                    <p className="text-xs">
                      {memberSearch || memberRoleFilter
                        ? 'Không có thành viên nào khớp với bộ lọc tìm kiếm.'
                        : 'Chapter này chưa có học viên nào tham gia.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="divide-y divide-[#eff4ff] border border-[#eff4ff] rounded-2xl overflow-hidden bg-white">
                      {chapterMembers.map((m) => {
                        const mId = m.userId || m.id;
                        const isActive = m.status === 'ACTIVE';

                        return (
                          <div key={mId} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-[#f8f9ff] transition">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => handleOpenMemberProfile(m)}
                                  className="text-left font-bold text-[#172554] text-sm hover:underline hover:text-[#2563EB] transition-colors cursor-pointer group"
                                  title="Bấm để xem hồ sơ chi tiết và lộ trình học tập"
                                >
                                  <span>{m.displayName || m.email}</span>
                                </button>
                                {m.displayName && m.email && (
                                  <span className="text-xs text-[#737686] font-normal">({m.email})</span>
                                )}
                                {m.isLead && (
                                  <span className="whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                                    LT
                                  </span>
                                )}
                                <span
                                  className={`whitespace-nowrap inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                    isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                  }`}
                                >
                                  {isActive ? 'Active' : 'Inactive'}
                                </span>
                              </div>
                              <div className="text-xs text-[#737686] flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span>Khóa học: <strong className="text-[#172554]">{m.completedCourses || 0} / {m.totalCourses || 0}</strong></span>
                                <span>•</span>
                                <span>⭐ <strong className="text-amber-600">{m.stars || 0}</strong></span>
                                <span>•</span>
                                <span>Bài học: <strong className="text-[#2563EB]">{m.completedLessons || 0} / {m.totalLessons || 0}</strong> bài</span>
                                <span>•</span>
                                <span suppressHydrationWarning>Tham gia: {m.joinedAt ? new Date(m.joinedAt).toLocaleDateString('vi-VN') : 'Mới'}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-4 self-end md:self-auto shrink-0">
                              {/* Progress bar */}
                              <div className="text-right shrink-0">
                                <div className="text-xs font-bold text-[#2563EB]">{m.avgProgress || 0}%</div>
                                <div className="w-24 bg-slate-100 h-1.5 rounded-full mt-1 overflow-hidden">
                                  <div
                                    className="bg-[#2563EB] h-full rounded-full"
                                    style={{ width: `${m.avgProgress || 0}%` }}
                                  />
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleOpenMemberProfile(m)}
                                className="px-3 py-1.5 rounded-xl border border-blue-200 text-[#2563EB] hover:bg-blue-50 text-xs font-semibold transition"
                              >
                                Xem hồ sơ →
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Pagination Controls */}
                    {memberTotalPages > 1 && (
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-[#eff4ff] text-xs">
                        <span className="text-[#737686]">
                          Trang <strong className="text-[#172554]">{memberPage}</strong> / {memberTotalPages} (Tổng số: {memberTotal} thành viên)
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={memberPage <= 1 || membersLoading}
                            onClick={() => {
                              const prev = memberPage - 1;
                              const chapId = selectedChapter.chapterId || selectedChapter.id;
                              void loadChapterMembers(chapId, prev, memberLimit, memberSearch, memberRoleFilter);
                            }}
                            className="px-3 py-1.5 rounded-xl border border-[#cbdbf5] bg-white font-semibold text-[#172554] hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                          >
                            ← Trước
                          </button>
                          {Array.from({ length: memberTotalPages }, (_, i) => i + 1)
                            .filter((p) => p === 1 || p === memberTotalPages || Math.abs(p - memberPage) <= 1)
                            .map((p, idx, arr) => (
                              <span key={p} className="flex items-center">
                                {idx > 0 && p - arr[idx - 1] > 1 && <span className="px-1 text-slate-400">...</span>}
                                <button
                                  type="button"
                                  disabled={membersLoading}
                                  onClick={() => {
                                    if (p !== memberPage) {
                                      const chapId = selectedChapter.chapterId || selectedChapter.id;
                                      void loadChapterMembers(chapId, p, memberLimit, memberSearch, memberRoleFilter);
                                    }
                                  }}
                                  className={`w-8 h-8 rounded-xl font-bold text-xs transition ${
                                    p === memberPage
                                      ? 'bg-[#2563EB] text-white shadow-xs'
                                      : 'bg-white border border-[#cbdbf5] text-[#172554] hover:bg-slate-50'
                                  }`}
                                >
                                  {p}
                                </button>
                              </span>
                            ))}
                          <button
                            type="button"
                            disabled={memberPage >= memberTotalPages || membersLoading}
                            onClick={() => {
                              const next = memberPage + 1;
                              const chapId = selectedChapter.chapterId || selectedChapter.id;
                              void loadChapterMembers(chapId, next, memberLimit, memberSearch, memberRoleFilter);
                            }}
                            className="px-3 py-1.5 rounded-xl border border-[#cbdbf5] bg-white font-semibold text-[#172554] hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                          >
                            Sau →
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-3 border-t border-[#eff4ff]">
                  <Button variant="secondary" onClick={handleCloseModal}>
                    Đóng
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* Level 2: Member Profile Drill-Down */}
                <div className="flex items-center justify-between pb-4 border-b border-slate-100 gap-4">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleBackToChapter}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white border border-[#cbdbf5] hover:border-[#2563EB] text-[#172554] hover:text-[#2563EB] text-xs font-bold transition shadow-2xs cursor-pointer"
                    >
                      ← Quay lại Chapter
                    </button>
                    <div>
                      <h3 className="text-lg font-bold text-[#172554]">
                        Hồ sơ học tập: {selectedMemberSummary?.displayName || selectedMemberSummary?.email}
                      </h3>
                      <p className="text-xs text-[#737686]">
                        Chapter {selectedChapter.name}
                        {selectedMemberSummary?.isLead && ' • Ban Lãnh Đạo (LT)'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleCloseModal}
                    className="text-[#737686] hover:text-[#172554] text-xl font-bold p-1 rounded-lg hover:bg-slate-100 transition"
                    title="Đóng modal"
                  >
                    ✕
                  </button>
                </div>

                {memberProfileLoading && !memberProfileData ? (
                  <div className="py-16 text-center space-y-3">
                    <div className="w-8 h-8 border-3 border-[#2563EB] border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-xs text-[#737686] font-medium">Đang tải hồ sơ học tập chi tiết...</p>
                  </div>
                ) : memberProfileError ? (
                  <div className="py-12 text-center space-y-3 bg-red-50 rounded-2xl p-6 border border-red-200">
                    <p className="text-sm font-bold text-red-800">{memberProfileError}</p>
                    <button
                      type="button"
                      onClick={() => selectedMemberSummary && handleOpenMemberProfile(selectedMemberSummary)}
                      className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl transition"
                    >
                      Thử lại
                    </button>
                  </div>
                ) : memberProfileData ? (
                  <LearnerProfileView
                    user={{
                      userId: memberProfileData.user?.userId || selectedMemberId || '',
                      displayName: memberProfileData.user?.displayName || selectedMemberSummary?.displayName,
                      email: memberProfileData.user?.email || selectedMemberSummary?.email,
                      status: memberProfileData.user?.status || selectedMemberSummary?.status,
                      accountState: memberProfileData.user?.accountState,
                      role: memberProfileData.user?.role || selectedMemberSummary?.role,
                      chapterName: memberProfileData.user?.chapterName || selectedChapter?.name,
                      departmentName: memberProfileData.user?.departmentName || selectedMemberSummary?.department?.name,
                      createdAt: memberProfileData.user?.joinedAt || memberProfileData.user?.createdAt || selectedMemberSummary?.joinedAt,
                      deactivatedByRole: memberProfileData.user?.deactivatedByRole,
                      isLead: selectedMemberSummary?.isLead,
                    }}
                    progressData={{
                      summary: memberProfileData.summary,
                      courses: memberProfileData.courses,
                      learningDetail: memberProfileData.learningDetail,
                    }}
                    loading={memberProfileLoading}
                    error={memberProfileError}
                    onRefresh={() => selectedMemberSummary && handleOpenMemberProfile(selectedMemberSummary)}
                  />
                ) : null}

                <div className="flex justify-between items-center gap-3 pt-3 border-t border-[#eff4ff]">
                  <button
                    type="button"
                    onClick={handleBackToChapter}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition"
                  >
                    ← Quay lại Chapter
                  </button>
                  <Button variant="secondary" onClick={handleCloseModal}>
                    Đóng
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
