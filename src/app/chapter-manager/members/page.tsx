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
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ totalItems: 0, totalPages: 1 });
  const [summary, setSummary] = useState({ totalMembers: 0, activeMembers: 0, avgChapterProgress: 0 });
  const [isPageChanging, setIsPageChanging] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [actionUserId, setActionUserId] = useState<string | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<{ userId: string; email: string; currentStatus: string } | null>(null);
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

  async function loadMembers(chapterId?: string, query?: string, noCache = false, targetPage = page) {
    const targetChapter = chapterId || user?.chapterId || 'me';
    const searchQuery = query !== undefined ? query : search;

    const url = `/api/v1/chapters/${targetChapter}/dashboard/members?search=${encodeURIComponent(searchQuery)}&includeInactive=1&page=${targetPage}&limit=10`;

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
    loadMembers(user?.chapterId, search, true, 1);
  };

  const handlePageChange = async (newPage: number) => {
    if (newPage < 1 || newPage > pagination.totalPages || newPage === page || isPageChanging) return;
    setIsPageChanging(true);
    setPage(newPage);
    await loadMembers(user?.chapterId, search, true, newPage);
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

  const handleToggleStatus = async (userId: string, currentStatus: string) => {
    if (!canManageMembers || currentStatus !== 'ACTIVE') {
      showToast('info', 'Chỉ Admin mới được mở khóa hoặc kích hoạt lại tài khoản.');
      setConfirmToggle(null);
      return;
    }
    const nextStatus = 'INACTIVE';

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
      }
      clearApiCache('/api/v1/chapters');
      await loadMembers(user?.chapterId, search, true);
    } else {
      showToast('error', res.error?.message || 'Lỗi cập nhật trạng thái', 'Thao tác thất bại');
      await loadMembers(user?.chapterId, search, true);
    }
    setActionUserId(null);
    setConfirmToggle(null);
  };

  // Chỉ hiển thị thành viên (MEMBER) — không hiện tài khoản BĐHU/Admin trong danh sách
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

        {/* Search Bar */}
        <Card className="p-4 mb-6 border border-[#eff4ff] shadow-sm">
          <form onSubmit={handleSearch} className="flex gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Tìm kiếm thành viên theo email..."
              className="flex-1 px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
            <Button type="submit">Tìm kiếm</Button>
          </form>
        </Card>

        {/* Members Table */}
        <Card className="p-0 overflow-hidden border border-[#eff4ff] shadow-sm">
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
            <div className={`overflow-x-auto transition-opacity duration-200 ${isPageChanging ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
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
                          <p className={`mt-1 text-xs font-semibold ${m.department ? 'text-blue-700' : 'text-amber-700'}`}>{m.department?.name || 'Không có Ban'}</p>
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
                          <span
                            className={`whitespace-nowrap inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full ${
                              isActive
                                ? 'bg-green-100 text-green-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {isActive ? '✓ Hoạt động' : 'Đã vô hiệu hóa'}
                          </span>
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

                            {canManageMembers && isActive && (
                              <button
                                disabled={isBusy}
                                onClick={() => setConfirmToggle({ userId: mId, email: m.email, currentStatus: m.status })}
                                className="whitespace-nowrap px-2.5 py-1 text-xs font-semibold rounded-lg text-red-600 hover:bg-red-50 transition"
                              >
                                Vô hiệu hóa
                              </button>
                            )}
                            {canManageMembers && !isActive && (
                              <span className="text-[11px] text-slate-500">Chỉ Admin mở khóa</span>
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
              Vô hiệu hóa tài khoản?
            </h3>
            <p className="text-sm text-[#737686]">
              {`Thành viên ${confirmToggle?.email} sẽ không thể đăng nhập và ngừng toàn bộ quyền truy cập học tập. Chỉ Admin mới có thể mở khóa.`}
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" type="button" onClick={() => setConfirmToggle(null)}>
                Hủy
              </Button>
              <Button
                type="button"
                loading={!!actionUserId}
                loadingText="Đang xử lý..."
                onClick={() => confirmToggle && handleToggleStatus(confirmToggle.userId, confirmToggle.currentStatus)}
              >
                Xác nhận
              </Button>
            </div>
          </div>
        </Modal>
    </div>
  );
}
