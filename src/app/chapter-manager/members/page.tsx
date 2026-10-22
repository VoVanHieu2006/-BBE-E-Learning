'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import { apiFetch, getCachedApiData, clearApiCache } from '@/lib/api/client';

export default function ChapterManagerMembersPage() {
  const [user, setUser] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [pagination, setPagination] = useState({ totalItems: 0, totalPages: 1 });
  const [summary, setSummary] = useState({ totalMembers: 0, activeMembers: 0, avgChapterProgress: 0 });
  const [isPageChanging, setIsPageChanging] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [actionUserId, setActionUserId] = useState<string | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<{
    userId: string;
    email: string;
    currentStatus: string;
    nextStatus: 'ACTIVE' | 'INACTIVE';
  } | null>(null);
  const [deactivateInputText, setDeactivateInputText] = useState('');
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const canManageMembers = user?.role === 'CHAPTER_LEADER' || user?.canManageMembers === true;

  const showToast = (type: 'success' | 'error' | 'info', message: string, title?: string) => {
    setToast({ type, message, title });
  };

  useEffect(() => {
    setMounted(true);
    let currentChapter = 'me';
    if (typeof window !== 'undefined') {
      const u = localStorage.getItem('user');
      if (u) {
        try {
          const parsed = JSON.parse(u);
          setUser(parsed);
          currentChapter = parsed?.chapterId || 'me';
        } catch {}
      }

      // Read cache immediately on client mount
      const url = `/api/v1/chapters/${currentChapter}/dashboard/members?search=${encodeURIComponent(search)}&includeInactive=1&page=1&limit=10`;
      const cached = getCachedApiData<any>(url);
      if (cached?.items) {
        setMembers(cached.items);
        if (cached.summary) setSummary(cached.summary);
        if (cached.totalItems !== undefined) {
          setPagination({ totalItems: cached.totalItems, totalPages: cached.totalPages || 1 });
        }
        setLoading(false);
      }
    }
    loadMembers(currentChapter, search);
  }, []);

  async function loadMembers(
    chapterId?: string,
    query?: string,
    noCache = false,
    targetPage = page,
    dept = departmentFilter,
    role = roleFilter,
    pageSize = limit
  ) {
    const targetChapter = chapterId || user?.chapterId || 'me';
    const searchQuery = query !== undefined ? query : search;

    const params = new URLSearchParams({
      search: searchQuery,
      includeInactive: '1',
      page: String(targetPage),
      limit: String(pageSize),
    });
    if (dept) params.set('department', dept);
    if (role) params.set('roleType', role);

    const url = `/api/v1/chapters/${targetChapter}/dashboard/members?${params.toString()}`;

    // Cache-first: hiện dữ liệu cache ngay trong khi revalidate nền
    const cached = noCache ? null : getCachedApiData<any>(url);
    if (cached?.items) {
      setMembers(cached.items);
      if (cached.summary) setSummary(cached.summary);
      if (cached.totalItems !== undefined) {
        setPagination({ totalItems: cached.totalItems, totalPages: cached.totalPages || 1 });
      }
      setLoading(false);
    }

    const res = await apiFetch(url, { noCache });
    if (res.ok && res.data) {
      setMembers(res.data.items || []);
      if (res.data.summary) {
        setSummary(res.data.summary);
      }
      setPagination({ totalItems: res.data.totalItems || 0, totalPages: res.data.totalPages || 1 });
    }
    setLoading(false);
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setPage(1);
    loadMembers(user?.chapterId, search, true, 1, departmentFilter, roleFilter, limit);
  };

  const handleResetFilters = () => {
    setSearch('');
    setDepartmentFilter('');
    setRoleFilter('');
    setPage(1);
    setLoading(true);
    loadMembers(user?.chapterId, '', true, 1, '', '', limit);
  };

  const handlePageChange = async (newPage: number) => {
    if (newPage < 1 || newPage > pagination.totalPages || newPage === page || isPageChanging) return;
    setIsPageChanging(true);
    setPage(newPage);
    await loadMembers(user?.chapterId, search, true, newPage, departmentFilter, roleFilter, limit);
    setIsPageChanging(false);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setSendingInvite(true);
    clearApiCache('/api/v1/chapters');
    clearApiCache('/api/v1/invitations');

    const res = await apiFetch('/api/v1/invitations/member', {
      method: 'POST',
      body: JSON.stringify({ email: inviteEmail.trim(), chapterId: user?.chapterId }),
    });

    if (res.ok) {
      showToast('success', `Đã gửi lời mời tham gia đến ${inviteEmail}!`);
      setShowInviteModal(false);
      setInviteEmail('');
      loadMembers();
    } else {
      showToast('error', res.error?.message || 'Lỗi gửi lời mời');
    }
    setSendingInvite(false);
  };

  const handleToggleStatus = async (userId: string, nextStatus: 'ACTIVE' | 'INACTIVE') => {
    if (!canManageMembers) {
      showToast('error', 'Bạn không có quyền quản lý thành viên Chapter.');
      setConfirmToggle(null);
      setDeactivateInputText('');
      return;
    }

    if (nextStatus === 'INACTIVE' && deactivateInputText.trim().toLowerCase() !== 'vô hiệu hóa') {
      showToast('error', 'Vui lòng điền đúng chữ "vô hiệu hóa" để xác nhận');
      return;
    }

    setActionUserId(userId);
    setMembers((prev) =>
      prev.map((m) => ((m.userId || m.id) === userId ? { ...m, status: nextStatus } : m))
    );

    clearApiCache('/api/v1/chapters');
    clearApiCache('/api/v1/users');
    const res = await apiFetch(`/api/v1/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus, chapterId: user?.chapterId }),
    });

    if (res.ok) {
      const finalStatus = res.data?.status || nextStatus;
      setMembers((prev) =>
        prev.map((m) => ((m.userId || m.id) === userId ? { ...m, status: finalStatus } : m))
      );

      if (finalStatus === 'INACTIVE') {
        showToast(
          'error',
          'Thành viên đã bị vô hiệu hóa. Người dùng sẽ bị chặn đăng nhập và ngừng toàn bộ quyền truy cập học tập.',
          '⚠️ Đã vô hiệu hóa thành viên'
        );
      } else {
        showToast(
          'success',
          'Thành viên đã được kích hoạt lại thành công. Người dùng có thể tiếp tục học tập.',
          '✅ Đã kích hoạt tài khoản'
        );
      }
      clearApiCache('/api/v1/chapters');
      await loadMembers(user?.chapterId, search, true);
    } else {
      showToast('error', res.error?.message || 'Lỗi cập nhật trạng thái', 'Thao tác thất bại');
      await loadMembers(user?.chapterId, search, true);
    }
    setActionUserId(null);
    setConfirmToggle(null);
    setDeactivateInputText('');
  };

  // Chỉ hiển thị thành viên (MEMBER) — không hiện tài khoản Lead Chapter/Admin trong danh sách
  const memberRows = members.filter((m) => m.role === 'MEMBER');
  const activeCount = memberRows.filter((m) => m.status === 'ACTIVE').length;
  const avgChapterProgress =
    memberRows.length > 0
      ? Math.round(
          memberRows.reduce((sum, m) => sum + (m.avgProgress || 0), 0) / memberRows.length
        )
      : 0;

  return (
    <div>
        <Toast toast={toast} onClose={() => setToast(null)} />

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              Thành viên & Tiến trình Chapter
            </h1>
            <p className="text-[#737686] mt-1 text-sm">
              Chapter: <span suppressHydrationWarning className="font-semibold text-[#172554]">{mounted && user?.chapterName ? user.chapterName : 'Chapter của bạn'}</span> • Quản lý học viên và theo dõi kết quả học tập
            </p>
          </div>
          <div className="flex items-center gap-3">
            {canManageMembers && (
              <>
                <Link href="/chapter-manager/invitations">
                  <Button variant="secondary">✉️ Danh sách lời mời</Button>
                </Link>
                <Button onClick={() => setShowInviteModal(true)}>
                  ＋ Mời thành viên mới
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card shadow="md" className="p-4 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-[#737686]">Tổng thành viên</div>
            <div className="text-2xl font-bold text-[#172554] mt-1">{summary.totalMembers}</div>
            <div className="text-[11px] text-[#737686] mt-0.5">Toàn bộ Chapter</div>
          </Card>
          <Card shadow="md" className="p-4 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-green-700">Đang hoạt động (Active)</div>
            <div className="text-2xl font-bold text-green-700 mt-1">{summary.activeMembers}</div>
            <div className="text-[11px] text-[#737686] mt-0.5">Có quyền đăng nhập học</div>
          </Card>
          <Card shadow="md" className="p-4 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-blue-700">Tiến độ TB Chapter</div>
            <div className="text-2xl font-bold text-[#2563EB] mt-1">{summary.avgChapterProgress}%</div>
            <div className="text-[11px] text-[#737686] mt-0.5">Tất cả khóa học</div>
          </Card>
        </div>

        {/* Search & Filter Bar */}
        <Card className="p-4 mb-4 border border-[#eff4ff] shadow-sm">
          <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Tìm kiếm thành viên theo tên hoặc email..."
              className="flex-1 px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />

            {/* Bộ lọc theo Ban (Chỉ chọn, bấm nút Tìm kiếm mới lọc) */}
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="px-3.5 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] bg-white text-[#172554] font-medium"
            >
              <option value="">🏢 Tất cả các Ban</option>
              <option value="Chủ Tịch">Chủ Tịch</option>
              <option value="Ban Thành Viên">Ban Thành Viên</option>
              <option value="Ban Thư Ký">Ban Thư Ký</option>
              <option value="Ban Khách Mời">Ban Khách Mời</option>
              <option value="Ban TT&SK">Ban TT&SK</option>
              <option value="Ban Nội Dung">Ban Nội Dung</option>
              <option value="Ban Chất Lượng">Ban Chất Lượng</option>
              <option value="unassigned">⚠️ Chưa phân Ban</option>
            </select>

            {/* Bộ lọc theo Chức vụ (Chỉ chọn, bấm nút Tìm kiếm mới lọc) */}
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-3.5 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] bg-white text-[#172554] font-medium"
            >
              <option value="">👔 Tất cả chức vụ</option>
              <option value="LT">👑 Trưởng ban</option>
              <option value="MEMBER">👤 Thành viên</option>
            </select>

            <Button type="submit">🔍 Tìm kiếm</Button>

            {(search || departmentFilter || roleFilter) && (
              <Button type="button" variant="outline" onClick={handleResetFilters}>
                ✕ Xóa lọc
              </Button>
            )}
          </form>
        </Card>

        {/* Filter Result Summary & Page Size Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1 mb-3 text-xs text-[#737686]">
          <div className="font-medium flex items-center gap-2">
            <span>
              Đang hiển thị <span className="text-[#2563EB] font-bold">{memberRows.length}</span> trên tổng số{' '}
              <span className="text-[#172554] font-bold">{summary.totalMembers}</span> tài khoản
              {(search || departmentFilter || roleFilter) && (
                <span> (kết quả lọc: <strong className="text-[#172554]">{pagination.totalItems}</strong> tài khoản)</span>
              )}
            </span>
            {loading && (
              <span className="inline-flex items-center gap-1 text-[#2563EB] font-semibold animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB]"></span> Đang tải...
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span>Hiển thị mỗi trang:</span>
            <select
              value={limit}
              disabled={loading}
              onChange={(e) => {
                const newLimit = Number(e.target.value);
                setLimit(newLimit);
                setPage(1);
                setLoading(true);
                loadMembers(user?.chapterId, search, true, 1, departmentFilter, roleFilter, newLimit);
              }}
              className="px-2.5 py-1 border border-[#cbdbf5] rounded-lg bg-white font-semibold text-[#172554] text-xs disabled:opacity-60"
            >
              <option value={10}>10 dòng</option>
              <option value={20}>20 dòng</option>
              <option value={50}>50 dòng</option>
            </select>
          </div>
        </div>

        {/* Members Table */}
        <Card className="p-0 overflow-hidden border border-[#eff4ff] shadow-sm relative">
          {/* Subtle loading transition overlay */}
          {loading && members.length > 0 && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] flex items-center justify-center z-20 transition-all">
              <div className="bg-white/95 px-4 py-2 rounded-xl shadow-md border border-[#cbdbf5] flex items-center gap-2 text-xs font-bold text-[#2563EB]">
                <span className="w-2 h-2 rounded-full bg-[#2563EB] animate-ping" />
                Đang cập nhật danh sách...
              </div>
            </div>
          )}

          {loading && members.length === 0 ? (
            <div className="p-8 space-y-4 animate-pulse">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-14 bg-slate-100 rounded-xl"></div>
              ))}
            </div>
          ) : memberRows.length === 0 ? (
            <div className="text-center py-16 text-[#737686]">
              <p className="text-lg font-semibold text-[#172554] mb-1">Chưa có thành viên nào</p>
              <p className="text-sm">{canManageMembers ? 'Hãy gửi lời mời thành viên đầu tiên tham gia Chapter của bạn.' : 'Chapter hiện chưa có thành viên để hiển thị.'}</p>
              {canManageMembers && (
                <Button size="sm" onClick={() => setShowInviteModal(true)} className="mt-4">
                  ＋ Mời thành viên ngay
                </Button>
              )}
            </div>
          ) : (
            <div className={`overflow-x-auto transition-opacity duration-200 ${(isPageChanging || loading) ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
              <table className="w-full text-left text-sm">
                <thead className="bg-[#f8f9ff] text-[#434655] font-semibold border-b border-[#eff4ff]">
                  <tr>
                    <th className="px-6 py-4">Thành viên</th>
                    <th className="px-6 py-4 text-center">Khóa học hoàn thành</th>
                    <th className="px-6 py-4 text-center">Tiến độ TB</th>
                    <th className="px-6 py-4 text-center">Trạng thái</th>
                    <th className="px-6 py-4 text-center">Ngày tham gia</th>
                    <th className="px-6 py-4 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eff4ff]">
                  {memberRows.map((m) => {
                    const mId = m.userId || m.id;
                    const isActive = m.status === 'ACTIVE';
                    const isLocked = m.status === 'LOCKED';
                    const isInactive = m.status === 'INACTIVE';
                    const isBusy = actionUserId === mId;

                    return (
                      <tr key={mId} className="hover:bg-[#f8f9ff] transition">
                        <td className="px-6 py-4">
                          <Link
                            href={`/chapter-manager/members/${mId}`}
                            className="font-semibold text-[#172554] hover:text-[#2563EB] transition"
                          >
                            {m.displayName || 'Chưa cập nhật tên'}
                          </Link>
                          <p className="mt-0.5 text-xs text-[#737686]">{m.email}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            {m.department?.name === 'Chủ Tịch' ? (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-amber-200/80 text-amber-900 shadow-2xs">
                                ⭐ Chủ tịch Chapter
                              </span>
                            ) : m.isLead ? (
                              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-200">
                                👑 Trưởng ban
                              </span>
                            ) : null}
                            <span className={`text-xs font-semibold ${m.department ? 'text-blue-700' : 'text-amber-700'}`}>
                              {m.department?.name || 'Chưa phân Ban'}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center font-medium text-[#172554]">
                          {m.completedCourses || 0} / {m.totalCourses || 0} khóa
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex flex-col items-center justify-center">
                            <span className="font-bold text-[#2563EB]">{m.avgProgress || 0}%</span>
                            <span className="text-[11px] text-[#737686] mt-0.5">
                              Đã học {m.completedLessons || 0} / {m.totalLessons || 0} bài
                            </span>
                          </div>
                          <div className="w-20 bg-slate-100 h-1.5 rounded-full mx-auto mt-1.5 overflow-hidden">
                            <div
                              className="bg-[#2563EB] h-full rounded-full"
                              style={{ width: `${m.avgProgress || 0}%` }}
                            />
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          {isLocked ? (
                            <div>
                              <span className="whitespace-nowrap inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 border border-rose-300">
                                <span>🔒</span> Tạm khóa hệ thống
                              </span>
                              <div className="text-[10px] text-slate-500 mt-0.5">Chỉ Admin mới mở được</div>
                            </div>
                          ) : isActive ? (
                            <span className="whitespace-nowrap inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-700">
                              ✓ Hoạt động
                            </span>
                          ) : (
                            <div>
                              <span className="whitespace-nowrap inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-700">
                                <span>⛔</span> Đã vô hiệu hóa
                              </span>
                              {m.cascadeLeadId ? (
                                <div className="text-[10px] text-red-500 mt-0.5">Theo Lead Chapter</div>
                              ) : (
                                <div className="text-[10px] text-slate-500 mt-0.5">Chỉ Admin mở lại</div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center text-xs text-[#737686]" suppressHydrationWarning>
                          {m.joinedAt ? new Date(m.joinedAt).toLocaleDateString('vi-VN') : '—'}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={`/chapter-manager/members/${mId}`}
                              className="px-2.5 py-1 text-xs font-semibold text-[#2563EB] hover:bg-blue-50 rounded-lg transition"
                            >
                              Chi tiết
                            </Link>

                            {/* Active or Locked accounts can be deactivated */}
                            {canManageMembers && (isActive || isLocked) && (
                              <button
                                disabled={isBusy}
                                onClick={() => {
                                  setDeactivateInputText('');
                                  setConfirmToggle({
                                    userId: mId,
                                    email: m.email,
                                    currentStatus: m.status,
                                    nextStatus: 'INACTIVE',
                                  });
                                }}
                                className="whitespace-nowrap px-2.5 py-1 text-xs font-semibold rounded-lg text-red-600 hover:bg-red-50 transition"
                              >
                                Vô hiệu hóa
                              </button>
                            )}

                            {/* Inactive accounts: only Admin can reactivate */}
                            {canManageMembers && isInactive && (
                              <span className="text-[11px] font-medium text-slate-500 italic">
                                Chỉ Admin mới có quyền mở lại
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Controls */}
          {pagination.totalPages > 1 && (
            <div className="p-4 border-t border-[#eff4ff] bg-[#f8f9ff] flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs text-[#737686]">
                Trang <span className="font-bold text-[#172554]">{page}</span> / {pagination.totalPages} (Tổng {pagination.totalItems} thành viên)
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1 || loading || isPageChanging}
                  onClick={() => handlePageChange(page - 1)}
                  className="px-3 py-1 text-xs"
                >
                  ← Trước
                </Button>

                {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === pagination.totalPages || Math.abs(p - page) <= 1)
                  .map((p, idx, arr) => {
                    const prevP = arr[idx - 1];
                    return (
                      <span key={p} className="flex items-center">
                        {prevP && p - prevP > 1 && <span className="px-1 text-[#737686]">...</span>}
                        <button
                          disabled={loading || isPageChanging}
                          onClick={() => handlePageChange(p)}
                          className={`w-8 h-8 rounded-lg text-xs font-bold transition disabled:opacity-60 ${
                            p === page
                              ? 'bg-[#2563EB] text-white shadow-sm'
                              : 'bg-white text-[#434655] hover:bg-[#eff4ff] border border-[#cbdbf5]'
                          }`}
                        >
                          {p}
                        </button>
                      </span>
                    );
                  })}

                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= pagination.totalPages || loading || isPageChanging}
                  onClick={() => handlePageChange(page + 1)}
                  className="px-3 py-1 text-xs"
                >
                  Sau →
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Modal: Invite Member */}
        <Modal
          isOpen={showInviteModal && canManageMembers}
          onClose={() => setShowInviteModal(false)}
          maxWidth="max-w-md"
        >
          <div className="p-6 space-y-4">
            <h3 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              Mời thành viên tham gia Chapter
            </h3>
            <p className="text-xs text-[#737686]">
              Gửi lời mời tham gia Chapter <span suppressHydrationWarning>{mounted && user?.chapterName ? user.chapterName : ''}</span> qua email.
            </p>
            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-[#172554] mb-1">Email học viên *</label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="member@bbe.vn"
                  className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="outline"
                  type="button"
                  disabled={sendingInvite}
                  onClick={() => setShowInviteModal(false)}
                >
                  Hủy
                </Button>
                <Button type="submit" loading={sendingInvite} loadingText="Đang gửi...">
                  Gửi lời mời
                </Button>
              </div>
            </form>
          </div>
        </Modal>

        {/* Modal: Xác nhận vô hiệu hóa tài khoản */}
        <Modal
          isOpen={!!confirmToggle}
          onClose={() => setConfirmToggle(null)}
          maxWidth="max-w-md"
        >
          <div className="p-6 space-y-4">
            <h3 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              {confirmToggle?.nextStatus === 'INACTIVE' ? 'Vô hiệu hóa tài khoản?' : 'Kích hoạt lại tài khoản?'}
            </h3>
            <p className="text-sm text-[#737686]">
              {confirmToggle?.nextStatus === 'INACTIVE'
                ? `Thành viên ${confirmToggle?.email} sẽ không thể đăng nhập và ngừng toàn bộ quyền truy cập học tập. Bạn hoặc Quản trị viên (Admin) có thể kích hoạt lại sau này.`
                : `Thành viên ${confirmToggle?.email} sẽ được kích hoạt lại và có thể tiếp tục học tập bình thường.`}
            </p>

            {confirmToggle?.nextStatus === 'INACTIVE' && (
              <div className="p-3 bg-red-50/80 border border-red-200 rounded-xl space-y-1.5">
                <label className="block text-xs font-semibold text-red-950">
                  Để xác nhận, vui lòng nhập chính xác chữ <strong className="text-red-600 underline font-extrabold">&ldquo;vô hiệu hóa&rdquo;</strong> vào ô bên dưới:
                </label>
                <input
                  type="text"
                  value={deactivateInputText}
                  onChange={(e) => setDeactivateInputText(e.target.value)}
                  placeholder="vô hiệu hóa"
                  className="w-full px-3 py-2 text-xs border border-red-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                  autoFocus
                />
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                type="button"
                onClick={() => {
                  setConfirmToggle(null);
                  setDeactivateInputText('');
                }}
              >
                Hủy
              </Button>
              <Button
                variant={confirmToggle?.nextStatus === 'INACTIVE' ? 'danger' : 'primary'}
                type="button"
                loading={!!actionUserId}
                loadingText="Đang xử lý..."
                disabled={
                  Boolean(actionUserId) ||
                  (confirmToggle?.nextStatus === 'INACTIVE' &&
                    deactivateInputText.trim().toLowerCase() !== 'vô hiệu hóa')
                }
                onClick={() => confirmToggle && handleToggleStatus(confirmToggle.userId, confirmToggle.nextStatus)}
              >
                {confirmToggle?.nextStatus === 'INACTIVE' ? 'Xác nhận vô hiệu hóa' : 'Xác nhận kích hoạt'}
              </Button>
            </div>
          </div>
        </Modal>
    </div>
  );
}
