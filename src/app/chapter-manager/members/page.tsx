'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import { apiFetch, getCachedApiData, clearApiCache } from '@/lib/api/client';

export default function ChapterManagerMembersPage() {
  const [user, setUser] = useState<any>(() => {
    if (typeof window !== 'undefined') {
      try {
        const u = localStorage.getItem('user');
        return u ? JSON.parse(u) : null;
      } catch {
        return null;
      }
    }
    return null;
  });

  const [members, setMembers] = useState<any[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const u = localStorage.getItem('user');
        const parsed = u ? JSON.parse(u) : null;
        const targetChapter = parsed?.chapterId || 'me';
        const url = `/api/v1/chapters/${targetChapter}/dashboard/members?search=&includeInactive=1`;
        const cached = getCachedApiData<any>(url);
        return cached?.items || [];
      } catch {
        return [];
      }
    }
    return [];
  });

  const [loading, setLoading] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const u = localStorage.getItem('user');
        const parsed = u ? JSON.parse(u) : null;
        const targetChapter = parsed?.chapterId || 'me';
        const url = `/api/v1/chapters/${targetChapter}/dashboard/members?search=&includeInactive=1`;
        const cached = getCachedApiData<any>(url);
        return !cached?.items;
      } catch {
        return true;
      }
    }
    return true;
  });

  const [search, setSearch] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [actionUserId, setActionUserId] = useState<string | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<{ userId: string; email: string; currentStatus: string } | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = (type: 'success' | 'error' | 'info', message: string, title?: string) => {
    setToast({ type, message, title });
  };

  useEffect(() => {
    let currentChapter = user?.chapterId;
    if (!currentChapter && typeof window !== 'undefined') {
      const u = localStorage.getItem('user');
      if (u) {
        try {
          const parsed = JSON.parse(u);
          setUser(parsed);
          currentChapter = parsed?.chapterId;
        } catch {}
      }
    }
    loadMembers(currentChapter, search);
  }, []);

  async function loadMembers(chapterId?: string, query?: string, noCache = false) {
    const targetChapter = chapterId || user?.chapterId || 'me';
    const searchQuery = query !== undefined ? query : search;

    const url = `/api/v1/chapters/${targetChapter}/dashboard/members?search=${encodeURIComponent(searchQuery)}&includeInactive=1`;

    // Cache-first: hiện dữ liệu cache ngay trong khi revalidate nền
    const cached = noCache ? null : getCachedApiData<any>(url);
    if (cached?.items) {
      setMembers(cached.items);
      setLoading(false);
    }

    const res = await apiFetch(url, { noCache });
    if (res.ok && res.data) {
      setMembers(res.data.items || []);
    }
    setLoading(false);
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    loadMembers(user?.chapterId, search);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setSendingInvite(true);
    clearApiCache('/api/v1/chapters');
    clearApiCache('/api/v1/invitations');

    const res = await apiFetch('/api/v1/invitations/member', {
      method: 'POST',
      body: JSON.stringify({ email: inviteEmail.trim() }),
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
    const nextStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

    setActionUserId(userId);
    setMembers((prev) =>
      prev.map((m) => ((m.userId || m.id) === userId ? { ...m, status: nextStatus } : m))
    );

    clearApiCache('/api/v1/chapters');
    clearApiCache('/api/v1/users');
    const res = await apiFetch(`/api/v1/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus }),
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
          'Thành viên đã được kích hoạt lại thành công.',
          '✅ Đã kích hoạt thành viên'
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

  const handleRemoveMember = async (userId: string, email: string) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa thành viên "${email}" khỏi chapter?`)) return;

    setMembers((prev) => prev.filter((m) => (m.userId || m.id) !== userId));
    clearApiCache('/api/v1/chapters');

    const targetChapter = user?.chapterId || 'me';
    const res = await apiFetch(`/api/v1/chapters/${targetChapter}/members/${userId}`, {
      method: 'DELETE',
    });

    if (res.ok) {
      showToast('success', `Đã xóa "${email}" khỏi chapter.`);
    } else {
      showToast('error', res.error?.message || 'Lỗi xóa thành viên');
      loadMembers();
    }
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
              Chapter: <span className="font-semibold text-[#172554]">{user?.chapterName || 'Chapter của bạn'}</span> • Quản lý học viên và theo dõi kết quả học tập
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/chapter-manager/invitations">
              <Button variant="secondary">✉️ Danh sách lời mời</Button>
            </Link>
            <Button onClick={() => setShowInviteModal(true)}>
              ＋ Mời thành viên mới
            </Button>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card shadow="md" className="p-4 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-[#737686]">Tổng thành viên</div>
            <div className="text-2xl font-bold text-[#172554] mt-1">{memberRows.length}</div>
            <div className="text-[11px] text-[#737686] mt-0.5">Trong Chapter</div>
          </Card>
          <Card shadow="md" className="p-4 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-green-700">Đang hoạt động (Active)</div>
            <div className="text-2xl font-bold text-green-700 mt-1">{activeCount}</div>
            <div className="text-[11px] text-[#737686] mt-0.5">Có quyền đăng nhập học</div>
          </Card>
          <Card shadow="md" className="p-4 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-blue-700">Tiến độ TB Chapter</div>
            <div className="text-2xl font-bold text-[#2563EB] mt-1">{avgChapterProgress}%</div>
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
              <p className="text-sm">Hãy gửi lời mời thành viên đầu tiên tham gia Chapter của bạn.</p>
              <Button size="sm" onClick={() => setShowInviteModal(true)} className="mt-4">
                ＋ Mời thành viên ngay
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
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
                            {m.email}
                          </Link>
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

                            <button
                              disabled={isBusy}
                              onClick={() =>
                                setConfirmToggle({ userId: mId, email: m.email, currentStatus: m.status })
                              }
                              className={`whitespace-nowrap px-2.5 py-1 text-xs font-semibold rounded-lg transition ${
                                isActive
                                  ? 'text-red-600 hover:bg-red-50'
                                  : 'text-green-700 hover:bg-green-50'
                              }`}
                            >
                              {isActive ? 'Vô hiệu hóa' : 'Kích hoạt lại'}
                            </button>
                            <button
                              onClick={() => handleRemoveMember(mId, m.email)}
                              className="text-slate-400 hover:text-red-600 p-1 rounded-lg"
                              title="Xóa khỏi chapter"
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Modal: Invite Member */}
        <Modal
          isOpen={showInviteModal}
          onClose={() => setShowInviteModal(false)}
          maxWidth="max-w-md"
        >
          <div className="p-6 space-y-4">
            <h3 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              Mời thành viên tham gia Chapter
            </h3>
            <p className="text-xs text-[#737686]">
              Gửi lời mời tham gia Chapter {user?.chapterName || ''} qua email.
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

        {/* Modal: Xác nhận vô hiệu hóa / kích hoạt tài khoản */}
        <Modal
          isOpen={!!confirmToggle}
          onClose={() => setConfirmToggle(null)}
          maxWidth="max-w-md"
        >
          <div className="p-6 space-y-4">
            <h3 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              {confirmToggle?.currentStatus === 'ACTIVE' ? 'Vô hiệu hóa tài khoản?' : 'Kích hoạt lại tài khoản?'}
            </h3>
            <p className="text-sm text-[#737686]">
              {confirmToggle?.currentStatus === 'ACTIVE'
                ? `Thành viên ${confirmToggle?.email} sẽ không thể đăng nhập và ngừng toàn bộ quyền truy cập học tập.`
                : `Thành viên ${confirmToggle?.email} sẽ được cấp lại quyền đăng nhập và học tập bình thường.`}
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
