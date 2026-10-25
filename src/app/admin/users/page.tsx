'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import { apiFetch, clearApiCache, getCachedApiData } from '@/lib/api/client';
import LearnerProfileView from '@/components/learner/LearnerProfileView';
import { useAdmin } from '../AdminContext';

export default function AdminUsersPage() {
  const { mounted } = useAdmin();

  const [users, setUsers] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [chapters, setChapters] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
  const [isFiltering, setIsFiltering] = useState(false);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [totalFilteredCount, setTotalFilteredCount] = useState<number>(0);

  // Filter Form Inputs
  const [searchInput, setSearchInput] = useState('');
  const [roleInput, setRoleInput] = useState('');
  const [statusInput, setStatusInput] = useState('');
  const [chapterInput, setChapterInput] = useState('');

  // Applied Filters State
  const [appliedFilters, setAppliedFilters] = useState({
    search: '',
    role: '',
    status: '',
    chapterId: '',
  });

  const [actionUserId, setActionUserId] = useState<string | null>(null);
  const [selectedUserDetail, setSelectedUserDetail] = useState<any | null>(null);
  const isSelectedLeadDna = selectedUserDetail
    ? selectedUserDetail.effectivePositions?.some((position: any) => position.code === 'DNA_LEAD') || selectedUserDetail.dna?.role === 'Lead DNA'
    : false;
  const [learningDetail, setLearningDetail] = useState<any | null>(null);
  const [learningDetailLoading, setLearningDetailLoading] = useState(false);
  const [learningDetailError, setLearningDetailError] = useState('');
  const learningDetailRequestId = useRef(0);
  const [confirmStatusModal, setConfirmStatusModal] = useState<{
    user: any;
    nextStatus: 'ACTIVE' | 'INACTIVE';
  } | null>(null);
  const [deactivateInputText, setDeactivateInputText] = useState('');
  const [unlockExtensionModal, setUnlockExtensionModal] = useState<{
    user: any;
    extensionDays: number;
  } | null>(null);

  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = (type: 'success' | 'error' | 'info', message: string, title?: string) => {
    setToast({ type, message, title });
  };
  const formatChapterName = (name?: string) => {
    if (!name) return 'Chưa gán Chapter';
    const core = name.replace(/^BBE\s+/i, '').replace(/^Chapter\s+/i, '').replace(/\s+Chapter$/i, '').trim();
    return `BBE ${core} Chapter`;
  };
  const formatDepartmentName = (name?: string) => {
    if (!name) return '';
    return name.replace(/^Ban\s+Chủ tịch$/i, 'Chủ tịch');
  };

  useEffect(() => {
    const cachedUsers = getCachedApiData<any>('/api/v1/users?page=1&limit=20');
    const cachedChapters = getCachedApiData<any>('/api/v1/chapters');
    if (cachedUsers?.items) {
      setUsers(cachedUsers.items);
      if (cachedUsers.stats) setStats(cachedUsers.stats);
      setLoading(false);
    }
    if (cachedChapters?.items) {
      setChapters(cachedChapters.items);
    }
    loadUsers(appliedFilters, 1, limit);
    loadChapters();
  }, []);

  async function loadChapters() {
    const res = await apiFetch('/api/v1/chapters');
    if (res.ok && res.data) {
      setChapters(res.data.items || []);
    }
  }

  async function loadUsers(filters: typeof appliedFilters, pageNum = page, limitNum = limit, noCache = false) {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.role) params.set('role', filters.role);
    if (filters.status) params.set('status', filters.status);
    if (filters.chapterId) params.set('chapterId', filters.chapterId);
    params.set('page', String(pageNum));
    params.set('limit', String(limitNum));

    const res = await apiFetch(`/api/v1/users?${params.toString()}`, { noCache });
    if (res.ok && res.data) {
      setUsers(res.data.items || []);
      setTotalFilteredCount(res.data.totalItems ?? res.data.items?.length ?? 0);
      setTotalPages(res.data.totalPages || 1);
      setPage(res.data.page || pageNum);
      if (res.data.stats) {
        setStats(res.data.stats);
      }
    } else {
      showToast('error', res.error?.message || 'Không thể tải danh sách tài khoản.');
    }
    setLoading(false);
    setIsFiltering(false);
  }

  const handleApplyFilter = (e: React.FormEvent) => {
    e.preventDefault();
    setIsFiltering(true);
    const newFilters = {
      search: searchInput.trim(),
      role: roleInput,
      status: statusInput,
      chapterId: chapterInput,
    };
    setAppliedFilters(newFilters);
    loadUsers(newFilters, 1, limit);
  };

  const handleResetFilter = () => {
    setSearchInput('');
    setRoleInput('');
    setStatusInput('');
    setChapterInput('');
    const emptyFilters = { search: '', role: '', status: '', chapterId: '' };
    setAppliedFilters(emptyFilters);
    setIsFiltering(true);
    loadUsers(emptyFilters, 1, limit);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages || loading) return;
    setLoading(true);
    loadUsers(appliedFilters, newPage, limit);
  };

  const handleLimitChange = (newLimit: number) => {
    if (loading) return;
    setLimit(newLimit);
    setLoading(true);
    loadUsers(appliedFilters, 1, newLimit);
  };

  const handleOpenConfirmModal = (targetUser: any, desiredNextStatus?: 'ACTIVE' | 'INACTIVE') => {
    const nextStatus = desiredNextStatus || (targetUser.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE');
    setDeactivateInputText('');
    setConfirmStatusModal({ user: targetUser, nextStatus });
  };

  const handleExecuteUnlockExtension = async () => {
    if (!unlockExtensionModal) return;
    const { user: targetUser, extensionDays } = unlockExtensionModal;
    const userId = targetUser.userId || targetUser.id;

    setActionUserId(userId);
    setUnlockExtensionModal(null);
    clearApiCache('/api/v1/users');
    clearApiCache('/api/v1/admin/overview');

    const res = await apiFetch(`/api/v1/admin/users/${userId}/extend-deadline`, {
      method: 'POST',
      body: JSON.stringify({
        extensionDays: Number(extensionDays) || 7,
        reason: 'Admin mở khóa gia hạn',
      }),
    });

    if (res.ok) {
      showToast(
        'success',
        `Tài khoản ${targetUser.email} đã được mở khóa và gia hạn thêm ${extensionDays} ngày hoàn thành bài học.`,
        '✅ Đã mở khóa & gia hạn thành công'
      );
      clearApiCache('/api/v1/users');
      clearApiCache('/api/v1/admin/overview');
      await loadUsers(appliedFilters, page, limit, true);
    } else {
      showToast('error', res.error?.message || 'Lỗi khi mở khóa tài khoản.', 'Thao tác thất bại');
      await loadUsers(appliedFilters, page, limit, true);
    }
    setActionUserId(null);
  };

  const handleOpenUserDetail = async (user: any) => {
    const requestId = ++learningDetailRequestId.current;
    setSelectedUserDetail(user);
    setLearningDetail(null);
    setLearningDetailError('');
    setLearningDetailLoading(false);
    const userId = user.userId || user.id;
    const chapterId = user.chapter?.chapterId || user.chapter?.id || 'all';
    const isUserLeadDna = user.effectivePositions?.some((position: any) => position.code === 'DNA_LEAD') || user.dna?.role === 'Lead DNA';
    if (user.role !== 'MEMBER' || isUserLeadDna) return;

    setLearningDetailLoading(true);
    const result = await apiFetch(`/api/v1/chapters/${chapterId}/members/${userId}/course-progress`, { noCache: true });
    if (requestId !== learningDetailRequestId.current) return;
    if (result.ok && result.data) {
      setLearningDetail(result.data);
    } else {
      setLearningDetailError(result.error?.message || 'Không thể tải tiến độ học tập chi tiết.');
    }
    setLearningDetailLoading(false);
  };

  const handleCloseUserDetail = () => {
    learningDetailRequestId.current += 1;
    setSelectedUserDetail(null);
    setLearningDetail(null);
    setLearningDetailLoading(false);
  };

  const handleExecuteStatusToggle = async () => {
    if (!confirmStatusModal) return;
    const { user: targetUser, nextStatus } = confirmStatusModal;
    const userId = targetUser.userId || targetUser.id;

    if (nextStatus === 'INACTIVE' && deactivateInputText.trim().toLowerCase() !== 'vô hiệu hóa') {
      showToast('error', 'Vui lòng điền đúng chữ "vô hiệu hóa" để xác nhận', 'Chưa xác nhận');
      return;
    }

    if (targetUser.role === 'ADMIN' && nextStatus === 'INACTIVE') {
      showToast('error', 'Không thể vô hiệu hóa tài khoản Quản trị viên', 'Lỗi phân quyền');
      setConfirmStatusModal(null);
      setDeactivateInputText('');
      return;
    }

    setActionUserId(userId);
    setConfirmStatusModal(null);
    setDeactivateInputText('');
    clearApiCache('/api/v1/users');
    clearApiCache('/api/v1/admin/overview');

    // Optimistic UI updates
    setUsers((prev) =>
      prev.map((u) => ((u.userId || u.id) === userId ? { ...u, status: nextStatus } : u))
    );

    setStats((prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        active: nextStatus === 'ACTIVE' ? prev.active + 1 : Math.max(0, prev.active - 1),
        inactive: nextStatus === 'INACTIVE' ? prev.inactive + 1 : Math.max(0, prev.inactive - 1),
      };
    });

    setSelectedUserDetail((prev: any) =>
      prev && (prev.userId || prev.id) === userId ? { ...prev, status: nextStatus } : prev
    );

    const res = await apiFetch(`/api/v1/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus }),
    });

    if (res.ok) {
      const finalStatus = res.data?.status || nextStatus;
      setUsers((prev) =>
        prev.map((u) => ((u.userId || u.id) === userId ? { ...u, status: finalStatus } : u))
      );
      setSelectedUserDetail((prev: any) =>
        prev && (prev.userId || prev.id) === userId ? { ...prev, status: finalStatus } : prev
      );

      if (finalStatus === 'INACTIVE') {
        showToast(
          'error',
          `Tài khoản ${targetUser.email} đã bị vô hiệu hóa. Người dùng sẽ bị chặn đăng nhập và ngừng toàn bộ quyền truy cập hệ thống.`,
          '⚠️ Đã vô hiệu hóa tài khoản'
        );
      } else {
        showToast(
          'success',
          `Tài khoản ${targetUser.email} đã được kích hoạt thành công. Người dùng có thể đăng nhập bình thường.`,
          '✅ Đã kích hoạt tài khoản'
        );
      }
      clearApiCache('/api/v1/users');
      clearApiCache('/api/v1/admin/overview');
      await loadUsers(appliedFilters, page, limit, true);
    } else {
      // Revert on failure
      setUsers((prev) =>
        prev.map((u) => ((u.userId || u.id) === userId ? { ...u, status: targetUser.status } : u))
      );
      setSelectedUserDetail((prev: any) =>
        prev && (prev.userId || prev.id) === userId ? { ...prev, status: targetUser.status } : prev
      );
      showToast('error', res.error?.message || 'Lỗi khi thay đổi trạng thái tài khoản.', 'Thao tác thất bại');
      await loadUsers(appliedFilters, page, limit, true);
    }
    setActionUserId(null);
  };

  const handleSendPasswordReset = async (user: any) => {
    const userId = user.userId || user.id;
    setActionUserId(userId);
    const res = await apiFetch(`/api/v1/users/${userId}/password-reset`, { method: 'POST' });
    showToast(res.ok ? 'success' : 'error', res.ok ? (res.data?.message || 'Đã gửi email đặt lại mật khẩu.') : (res.error?.message || 'Không gửi được email đặt lại mật khẩu.'));
    setActionUserId(null);
  };

  const getRoleBadge = (role: string) => {
    if (role === 'CHAPTER_LEADER') {
      return (
        <span className="whitespace-nowrap inline-flex items-center text-xs font-bold px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
          Lead Chapter
        </span>
      );
    }
    return (
      <span className="whitespace-nowrap inline-flex items-center text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
        Thành viên
      </span>
    );
  };

  const hasActiveFilters = Boolean(
    appliedFilters.search || appliedFilters.role || appliedFilters.status || appliedFilters.chapterId
  );

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              Quản lý tài khoản
            </h1>
            <p className="text-[#737686] mt-1 text-sm">
              Quản lý toàn bộ tài khoản Lead Chapter và học viên theo từng Chapter, phân quyền và kiểm soát hoạt động
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/admin/invitations">
              <Button variant="secondary">✉️ Mời & quản lý Lead</Button>
            </Link>
            <Link href="/admin/chapters">
              <Button>📊 Xếp hạng Chapter</Button>
            </Link>
          </div>
        </div>

        {/* Global Stat Cards (Non-Admin Users Total) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card shadow="md" className="p-4 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-[#737686]">Tổng thành viên & Lead Chapter</div>
            <div className="text-2xl font-bold text-[#172554] mt-1">{stats?.total ?? (loading ? '...' : users.length)}</div>
            <div className="text-[11px] text-[#737686] mt-0.5">Toàn hệ thống (trừ Admin)</div>
          </Card>
          <Card shadow="md" className="p-4 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-green-700">Đang hoạt động (Active)</div>
            <div className="text-2xl font-bold text-green-700 mt-1">
              {stats?.active ?? (loading ? '...' : users.filter((u) => u.status === 'ACTIVE').length)}
            </div>
            <div className="text-[11px] text-[#737686] mt-0.5">Có quyền đăng nhập</div>
          </Card>
          <Card shadow="md" className="p-4 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-red-600">Đã vô hiệu hóa (Inactive)</div>
            <div className="text-2xl font-bold text-red-600 mt-1">
              {stats?.inactive ?? (loading ? '...' : users.filter((u) => u.status === 'INACTIVE').length)}
            </div>
            <div className="text-[11px] text-[#737686] mt-0.5">Đã khóa truy cập</div>
          </Card>
          <Card shadow="md" className="p-4 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-purple-700">Lead Chapter</div>
            <div className="text-2xl font-bold text-purple-700 mt-1">
              {stats?.leaders ?? (loading ? '...' : users.filter((u) => u.role === 'CHAPTER_LEADER').length)}
            </div>
            <div className="text-[11px] text-[#737686] mt-0.5">Trưởng các chapter</div>
          </Card>
        </div>

        {/* Filter Controls */}
        <Card className="p-4 mb-6 border border-[#eff4ff] shadow-sm">
          <form onSubmit={handleApplyFilter} className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
            <div className="flex-1">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="🔍 Tìm theo tên hoặc email..."
                className="w-full px-3.5 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>
            <div className="w-full lg:w-48">
              <select
                value={roleInput}
                onChange={(e) => setRoleInput(e.target.value)}
                className="w-full px-3 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] bg-white text-[#172554]"
              >
                <option value="">👔 Tất cả chức vụ</option>
                <option value="MEMBER">👤 Thành viên chapter</option>
                <option value="DNA">🧬 Thành viên DNA</option>
                <option value="DNA_LEAD">⭐ Lead DNA</option>
                <option value="CHAPTER_LEADER">🏅 Lead Chapter</option>
                <option value="LT">👑 LT Ban</option>
              </select>
            </div>
            <div className="w-full lg:w-48">
              <select
                value={statusInput}
                onChange={(e) => setStatusInput(e.target.value)}
                className="w-full px-3 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] bg-white text-[#172554]"
              >
                <option value="">-- Tất cả trạng thái --</option>
                <option value="ACTIVE">Đang hoạt động (Active)</option>
                <option value="INACTIVE">Đã vô hiệu hóa (Inactive)</option>
                <option value="LOCKED">Tạm khóa (Locked)</option>
              </select>
            </div>
            <div className="w-full lg:w-48">
              <select
                value={chapterInput}
                onChange={(e) => setChapterInput(e.target.value)}
                className="w-full px-3 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] bg-white text-[#172554]"
              >
                <option value="">-- Tất cả Chapter --</option>
                {chapters.map((ch) => (
                  <option key={ch.chapterId || ch.id} value={ch.chapterId || ch.id}>
                    {ch.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" loading={isFiltering} loadingText="Đang lọc..." className="px-5">
                🔍 Lọc
              </Button>
              {hasActiveFilters && (
                <Button type="button" variant="outline" onClick={handleResetFilter} className="px-3">
                  ↺ Đặt lại
                </Button>
              )}
            </div>
          </form>
        </Card>

        {/* Filter Result Summary & Page Size Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1 mb-3 text-xs text-[#737686]">
          <div className="font-medium flex items-center gap-2">
            <span>
              Đang hiển thị <span className="text-[#2563EB] font-bold">{users.length}</span> trên tổng số{' '}
              <span className="text-[#172554] font-bold">{stats?.total ?? totalFilteredCount}</span> tài khoản học viên & Lead Chapter
              {hasActiveFilters && ` (kết quả lọc: ${totalFilteredCount} tài khoản)`}
            </span>
            {loading && (
              <span className="inline-flex items-center gap-1 text-[#2563EB] font-semibold animate-pulse">
                <span className="w-2 h-2 rounded-full bg-[#2563EB]"></span> Đang tải trang...
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span>Hiển thị mỗi trang:</span>
            <select
              value={limit}
              disabled={loading}
              onChange={(e) => handleLimitChange(Number(e.target.value))}
              className="px-2 py-1 border border-[#cbdbf5] rounded-lg bg-white font-semibold text-[#172554] text-xs disabled:opacity-60"
            >
              <option value={10}>10 dòng</option>
              <option value={20}>20 dòng</option>
              <option value={50}>50 dòng</option>
              <option value={100}>100 dòng</option>
            </select>
          </div>
        </div>

        {/* Users Table Card with Loading Overlay */}
        <Card className="p-0 overflow-hidden border border-[#eff4ff] shadow-sm relative">
          {/* Subtle loading transition indicator */}
          {loading && users.length > 0 && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] flex items-center justify-center z-20 transition-all">
              <div className="bg-white/90 px-4 py-2 rounded-xl shadow-lg border border-[#cbdbf5] flex items-center gap-2 text-xs font-bold text-[#2563EB]">
                <div className="w-4 h-4 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
                <span>Đang nạp dữ liệu trang...</span>
              </div>
            </div>
          )}

          {!mounted || (loading && users.length === 0) ? (
            <div className="p-8 space-y-4 animate-pulse">
              {[1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="h-14 bg-slate-100 rounded-xl"></div>
              ))}
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-16 text-[#737686]">
              <p className="text-lg font-semibold text-[#172554] mb-1">Không tìm thấy tài khoản nào phù hợp</p>
              <p className="text-sm text-[#737686]">Hãy thử thay đổi điều kiện tìm kiếm hoặc bấm &quot;Đặt lại&quot; bộ lọc.</p>
              {hasActiveFilters && (
                <Button variant="outline" size="sm" onClick={handleResetFilter} className="mt-4">
                  ↺ Bỏ tất cả bộ lọc
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#f8f9ff] text-[#434655] font-semibold border-b border-[#eff4ff]">
                  <tr>
                    <th className="px-6 py-4 min-w-[220px]">Tài khoản / Email</th>
                    <th className="px-6 py-4 min-w-[260px]">Chức vụ</th>
                    <th className="px-6 py-4 min-w-[160px]">Chapter</th>
                    <th className="px-6 py-4 text-center min-w-[190px]">Tiến độ khóa học</th>
                    <th className="px-6 py-4 text-center min-w-[140px]">Trạng thái</th>
                    <th className="px-6 py-4 text-right min-w-[180px]">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eff4ff]">
                  {users.map((u) => {
                    const uId = u.userId || u.id;
                    const isActive = u.status === 'ACTIVE';
                    const isBusy = actionUserId === uId;
                    const isLeader = u.role === 'CHAPTER_LEADER';
                    const isLeadDna = u.effectivePositions?.some((position: any) => position.code === 'DNA_LEAD') || u.dna?.role === 'Lead DNA';

                    return (
                      <tr key={uId} className="hover:bg-[#f8f9ff] transition">
                        <td className="px-6 py-4">
                          <button
                            type="button"
                            onClick={() => void handleOpenUserDetail(u)}
                            className="text-left group cursor-pointer block"
                          >
                            <span className="font-semibold text-[#172554] group-hover:text-[#2563EB] transition-colors block">
                              {u.displayName || u.email}
                            </span>
                            {u.displayName && (
                              <span className="text-xs text-[#737686] group-hover:text-[#2563EB] transition-colors block">
                                {u.email}
                              </span>
                            )}
                          </button>
                          <div className="text-[11px] text-[#737686] mt-1" suppressHydrationWarning>
                            Tham gia: {u.createdAt ? new Date(u.createdAt).toLocaleDateString('vi-VN') : '—'}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {/* Lead Chapter */}
                            {u.role === 'CHAPTER_LEADER' && (
                              <span className="inline-flex whitespace-nowrap rounded-full bg-purple-50 border border-purple-200 px-2.5 py-0.5 text-[11px] font-bold text-purple-700">
                                🏅 Lead Chapter · {formatChapterName(u.chapter?.name)}
                              </span>
                            )}

                            {/* Member Department or "Chưa có ban" (Không hiển thị "Chưa có ban" đối với Lead DNA vì Lead không dùng Ban) */}
                            {u.role === 'MEMBER' && !isLeadDna && (
                              u.department ? (
                                <span className="inline-flex whitespace-nowrap rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700">
                                  {formatDepartmentName(u.department.name) === 'Chủ tịch'
                                    ? '⭐ Chủ tịch'
                                    : u.effectivePositions?.some((position: any) => ['DEPARTMENT_LEAD', 'LT'].includes(position.code))
                                    ? `👑 LT ${formatDepartmentName(u.department.name)}`
                                    : `👤 Thành viên · ${formatDepartmentName(u.department.name)}`}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 shadow-2xs">
                                  <span>⚠️</span> Chưa có ban
                                </span>
                              )
                            )}

                            {/* Lead DNA */}
                            {isLeadDna && (
                              <span className="inline-flex whitespace-nowrap rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                                ⭐ Lead DNA{u.dna?.group ? ` · ${u.dna.group}` : ''}
                              </span>
                            )}

                            {/* DNA Member */}
                            {u.dna?.active && !isLeadDna && (
                              <span className="inline-flex whitespace-nowrap rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                                🧬 Thành viên DNA{u.dna.group ? ` · ${u.dna.group}` : ''}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {u.chapter ? (
                            <Link
                              href="/admin/chapters"
                              className="text-xs font-semibold text-[#2563EB] hover:underline inline-flex items-center gap-1"
                            >
                              <span>🏛️</span> {formatChapterName(u.chapter.name)}
                            </Link>
                          ) : (
                            <span className="text-xs text-[#737686]">Chưa gán</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {isLeader ? (
                            <div className="flex justify-center">
                              <span className="whitespace-nowrap inline-flex items-center justify-center text-xs font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-full border border-purple-200 shadow-xs">
                                100% (Lead Chapter / Miễn học)
                              </span>
                            </div>
                          ) : isLeadDna ? (
                            <div className="flex justify-center">
                              <span className="whitespace-nowrap inline-flex items-center justify-center text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 shadow-xs">
                                Lead DNA (Miễn học)
                              </span>
                            </div>
                          ) : (
                            <div>
                              <div className="flex items-center justify-center gap-2">
                                <span className="font-bold text-[#172554]">{u.avgProgress || 0}%</span>
                                <span className="text-xs text-[#737686]">
                                  ({u.completedCourses || 0}/{u.totalCourses || 0} khóa)
                                </span>
                              </div>
                              <div className="text-[11px] text-[#737686] mt-0.5">
                                Đã học {u.completedLessons || 0} / {u.totalLessons || 0} bài
                              </div>
                              <div className="w-24 bg-slate-100 h-1.5 rounded-full mx-auto mt-1 overflow-hidden">
                                <div
                                  className="bg-[#2563EB] h-full rounded-full transition-all duration-300"
                                  style={{ width: `${u.avgProgress || 0}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {u.accountState === 'OVERDUE_LOCK' ? (
                            <div>
                              <span className="whitespace-nowrap inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 border border-rose-300 shadow-2xs">
                                <span>⏰</span> Khóa: Quá hạn bài học
                              </span>
                              <div className="text-[10px] text-rose-600 mt-0.5">Quá hạn bài học bắt buộc</div>
                            </div>
                          ) : u.accountState === 'PASSWORD_LOCK' ? (
                            <div>
                              <span className="whitespace-nowrap inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 shadow-2xs">
                                <span>🔒</span> Khóa: Quên/Sai MK
                              </span>
                              <div className="text-[10px] text-amber-700 mt-0.5">Quên hoặc sai MK quá 10 lần</div>
                            </div>
                          ) : isActive ? (
                            <span className="whitespace-nowrap inline-flex items-center text-xs font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-700">
                              ✓ Hoạt động
                            </span>
                          ) : (
                            <div>
                              <span className="whitespace-nowrap inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-700">
                                <span>⛔</span> Vô hiệu hóa
                              </span>
                              {u.cascadeLeadId ? (
                                <div className="text-[10px] text-red-500 mt-0.5">Theo Lead Chapter</div>
                              ) : u.deactivatedByRole === 'LEAD' ? (
                                <div className="text-[10px] text-red-500 mt-0.5">Bởi Lead Chapter</div>
                              ) : u.deactivatedByRole === 'ADMIN' ? (
                                <div className="text-[10px] text-red-500 mt-0.5">Bởi Admin</div>
                              ) : null}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            <Link href={`/admin/users/${uId}/organization-history`} className="whitespace-nowrap px-2.5 py-1 text-xs font-bold text-blue-700 border border-blue-200 rounded-lg">Lịch sử tổ chức</Link>
                            {/* Password reset button */}
                            {u.accountState === 'PASSWORD_LOCK' ? (
                              <button
                                disabled={isBusy}
                                onClick={() => void handleSendPasswordReset(u)}
                                className="whitespace-nowrap px-2.5 py-1 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition disabled:opacity-50"
                              >
                                ✉️ Gửi link đặt lại MK
                              </button>
                            ) : (
                              <button
                                disabled={isBusy}
                                onClick={() => void handleSendPasswordReset(u)}
                                className="whitespace-nowrap px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 rounded-lg transition disabled:opacity-50"
                              >
                                Gửi link đặt lại MK
                              </button>
                            )}

                            {/* Status and unlock actions */}
                            {u.accountState === 'OVERDUE_LOCK' ? (
                              <>
                                <button
                                  disabled={isBusy || loading}
                                  onClick={() => setUnlockExtensionModal({ user: u, extensionDays: 7 })}
                                  className="whitespace-nowrap px-2.5 py-1 text-xs font-bold text-white bg-[#2563EB] hover:bg-blue-700 rounded-lg shadow-2xs transition disabled:opacity-50"
                                >
                                  Mở khóa & Gia hạn
                                </button>
                                <button
                                  disabled={isBusy || loading}
                                  onClick={() => handleOpenConfirmModal(u, 'INACTIVE')}
                                  className="whitespace-nowrap px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
                                >
                                  Vô hiệu hóa
                                </button>
                              </>
                            ) : u.accountState === 'PASSWORD_LOCK' ? (
                              <>
                                <button
                                  disabled={isBusy || loading}
                                  onClick={() => handleOpenConfirmModal(u, 'ACTIVE')}
                                  className="whitespace-nowrap px-2.5 py-1 text-xs font-semibold text-green-700 hover:bg-green-50 rounded-lg transition disabled:opacity-50"
                                >
                                  Mở khóa
                                </button>
                                <button
                                  disabled={isBusy || loading}
                                  onClick={() => handleOpenConfirmModal(u, 'INACTIVE')}
                                  className="whitespace-nowrap px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
                                >
                                  Vô hiệu hóa
                                </button>
                              </>
                            ) : isActive ? (
                              <button
                                disabled={isBusy || loading}
                                onClick={() => handleOpenConfirmModal(u, 'INACTIVE')}
                                className="whitespace-nowrap px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
                              >
                                {isBusy ? 'Đang xử lý...' : 'Vô hiệu hóa'}
                              </button>
                            ) : (
                              <button
                                disabled={isBusy || loading}
                                onClick={() => handleOpenConfirmModal(u, 'ACTIVE')}
                                className="whitespace-nowrap px-2.5 py-1 text-xs font-semibold text-green-700 hover:bg-green-50 rounded-lg transition disabled:opacity-50"
                              >
                                {isBusy ? 'Đang xử lý...' : 'Kích hoạt'}
                              </button>
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
          {totalPages > 1 && (
            <div className="p-4 border-t border-[#eff4ff] bg-[#f8f9ff] flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs text-[#737686]">
                Trang <span className="font-bold text-[#172554]">{page}</span> / {totalPages} (Tổng {totalFilteredCount} tài khoản)
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1 || loading}
                  onClick={() => handlePageChange(page - 1)}
                  className="px-3 py-1 text-xs"
                >
                  ← Trước
                </Button>

                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                  .map((p, idx, arr) => {
                    const prevP = arr[idx - 1];
                    return (
                      <span key={p} className="flex items-center">
                        {prevP && p - prevP > 1 && <span className="px-1 text-[#737686]">...</span>}
                        <button
                          disabled={loading}
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
                  disabled={page >= totalPages || loading}
                  onClick={() => handlePageChange(page + 1)}
                  className="px-3 py-1 text-xs"
                >
                  Sau →
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Modal: Confirmation for Status Change */}
        <Modal
          isOpen={Boolean(confirmStatusModal)}
          onClose={() => setConfirmStatusModal(null)}
          maxWidth="max-w-md"
        >
          {confirmStatusModal && (
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0 ${
                    confirmStatusModal.nextStatus === 'INACTIVE'
                      ? 'bg-red-100 text-red-600'
                      : 'bg-emerald-100 text-emerald-600'
                  }`}
                >
                  {confirmStatusModal.nextStatus === 'INACTIVE' ? '⚠️' : '✅'}
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-[#172554]">
                    {confirmStatusModal.nextStatus === 'INACTIVE'
                      ? 'Xác nhận vô hiệu hóa tài khoản?'
                      : 'Xác nhận kích hoạt / mở khóa tài khoản?'}
                  </h3>
                  <p className="text-xs font-semibold text-[#2563EB] truncate">
                    {confirmStatusModal.user.email}
                  </p>
                </div>
              </div>

              {confirmStatusModal.nextStatus === 'INACTIVE' ? (
                <div className="space-y-2">
                  <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 space-y-1.5">
                    <div className="font-bold flex items-center gap-1.5 text-amber-800">
                      <span>⚠️ Cảnh báo quan trọng:</span>
                    </div>
                    <p className="leading-relaxed text-[#78350f]">
                      Khi vô hiệu hóa, tài khoản này sẽ bị <strong>chặn đăng nhập ngay lập tức</strong> và ngừng toàn bộ quyền truy cập bài học cũng như bài kiểm tra trên hệ thống BBE.
                    </p>
                  </div>
                  {confirmStatusModal.user.role === 'CHAPTER_LEADER' && (
                    <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-900 space-y-1.5">
                      <div className="font-bold flex items-center gap-1.5 text-red-800">
                        <span>🚨 Lưu ý đặc biệt: Lead Chapter</span>
                      </div>
                      <p className="leading-relaxed text-red-700">
                        Khi vô hiệu hóa Lead Chapter, <strong>toàn bộ tài khoản thành viên đang hoạt động trong Chapter sẽ tự động bị vô hiệu hóa</strong> theo. Khi Admin kích hoạt lại Lead Chapter, các tài khoản thành viên bị vô hiệu hóa theo sẽ được tự động mở lại.
                      </p>
                    </div>
                  )}

                  <div className="p-3 bg-red-50/80 border border-red-200 rounded-xl space-y-1.5 mt-2">
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
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-2xl text-xs text-blue-900 space-y-1">
                    <div className="font-bold text-blue-800">Thông tin kích hoạt:</div>
                    <p className="leading-relaxed">
                      Tài khoản sẽ được mở khóa lại và học viên/Lead Chapter có thể đăng nhập bình thường.
                    </p>
                  </div>
                  {confirmStatusModal.user.role === 'CHAPTER_LEADER' && (
                    <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900 space-y-1">
                      <div className="font-bold text-emerald-800">Tự động kích hoạt thành viên Chapter:</div>
                      <p className="leading-relaxed">
                        Hệ thống sẽ tự động kích hoạt lại các tài khoản thành viên trong Chapter đã bị vô hiệu hóa theo đợt của Lead này (những tài khoản bị vô hiệu hóa riêng trước đó vẫn giữ nguyên).
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={Boolean(actionUserId)}
                  onClick={() => {
                    setConfirmStatusModal(null);
                    setDeactivateInputText('');
                  }}
                >
                  Hủy bỏ
                </Button>
                <Button
                  variant={confirmStatusModal.nextStatus === 'INACTIVE' ? 'danger' : 'primary'}
                  size="sm"
                  loading={Boolean(actionUserId)}
                  loadingText="Đang xử lý..."
                  disabled={
                    Boolean(actionUserId) ||
                    (confirmStatusModal.nextStatus === 'INACTIVE' &&
                      deactivateInputText.trim().toLowerCase() !== 'vô hiệu hóa')
                  }
                  onClick={handleExecuteStatusToggle}
                >
                  {confirmStatusModal.nextStatus === 'INACTIVE' ? 'Xác nhận vô hiệu hóa' : 'Xác nhận kích hoạt'}
                </Button>
              </div>
            </div>
          )}
        </Modal>

        {/* Modal: Unlock & Extension Days */}
        <Modal
          isOpen={Boolean(unlockExtensionModal)}
          onClose={() => setUnlockExtensionModal(null)}
          maxWidth="max-w-md"
        >
          {unlockExtensionModal && (
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center text-2xl shrink-0">
                  ⏰
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-[#172554]">
                    Mở khóa & Gia hạn bài học
                  </h3>
                  <p className="text-xs font-semibold text-[#2563EB] truncate">
                    {unlockExtensionModal.user.email}
                  </p>
                </div>
              </div>

              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-900 space-y-1">
                <div className="font-bold text-rose-800">Lý do khóa: Quá hạn bài học bắt buộc</div>
                <p className="leading-relaxed">
                  Tài khoản bị khóa tự động do chưa hoàn thành các khóa học bắt buộc trong thời hạn quy định. Chỉ Quản trị viên (Admin) mới có quyền mở khóa.
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-[#172554]">
                  Gia hạn thêm số ngày trước khi hệ thống đánh giá khóa lại:
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[3, 7, 14, 30].map((days) => (
                    <button
                      key={days}
                      type="button"
                      onClick={() => setUnlockExtensionModal({ ...unlockExtensionModal, extensionDays: days })}
                      className={`py-2 text-xs font-bold rounded-xl border transition ${
                        unlockExtensionModal.extensionDays === days
                          ? 'bg-[#2563EB] text-white border-[#2563EB] shadow-xs'
                          : 'bg-white text-[#172554] border-[#cbdbf5] hover:bg-[#eff4ff]'
                      }`}
                    >
                      +{days} ngày
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-[#737686]">Hoặc số ngày khác:</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={unlockExtensionModal.extensionDays}
                    onChange={(e) =>
                      setUnlockExtensionModal({
                        ...unlockExtensionModal,
                        extensionDays: Math.max(1, Math.min(365, Number(e.target.value) || 1)),
                      })
                    }
                    className="w-20 px-2 py-1 text-xs border border-[#cbdbf5] rounded-lg text-center font-bold text-[#172554]"
                  />
                  <span className="text-xs text-[#737686]">ngày kể từ hôm nay</span>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={Boolean(actionUserId)}
                  onClick={() => setUnlockExtensionModal(null)}
                >
                  Hủy bỏ
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={Boolean(actionUserId)}
                  loadingText="Đang mở khóa..."
                  onClick={handleExecuteUnlockExtension}
                >
                  Xác nhận Mở khóa (+{unlockExtensionModal.extensionDays} ngày)
                </Button>
              </div>
            </div>
          )}
        </Modal>

        {/* Modal: User Detail View */}
        <Modal
          isOpen={Boolean(selectedUserDetail)}
          onClose={handleCloseUserDetail}
          maxWidth="max-w-5xl"
        >
          {selectedUserDetail && (
            <div className="p-6 space-y-6 max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                <div>
                  <h3 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                    Hồ sơ học viên & Quản trị tài khoản
                  </h3>
                  <p className="text-xs text-[#737686]">Chi tiết tiến độ học tập, video, bài kiểm tra và các thao tác nghiệp vụ.</p>
                </div>
                <button
                  onClick={handleCloseUserDetail}
                  className="text-[#737686] hover:text-[#172554] text-xl font-bold p-1 rounded-lg hover:bg-slate-100 transition"
                >
                  ✕
                </button>
              </div>

              <LearnerProfileView
                user={{
                  userId: selectedUserDetail.userId || selectedUserDetail.id,
                  displayName: selectedUserDetail.displayName || selectedUserDetail.name,
                  email: selectedUserDetail.email,
                  status: selectedUserDetail.status,
                  accountState: selectedUserDetail.accountState,
                  role: selectedUserDetail.role,
                  chapterName: selectedUserDetail.chapter?.name ? formatChapterName(selectedUserDetail.chapter.name) : isSelectedLeadDna ? 'DNA' : 'Chưa gán Chapter',
                  departmentName: isSelectedLeadDna ? 'Lead DNA (Không dùng Ban)' : selectedUserDetail.department ? formatDepartmentName(selectedUserDetail.department.name) : undefined,
                  createdAt: selectedUserDetail.createdAt,
                  effectivePositions: selectedUserDetail.effectivePositions,
                  dna: selectedUserDetail.dna,
                  deactivatedByRole: selectedUserDetail.deactivatedByRole,
                }}
                progressData={{
                  summary: learningDetail?.summary || {
                    completedCourses: selectedUserDetail.completedCourses,
                    totalCourses: selectedUserDetail.totalCourses,
                    completedLessons: selectedUserDetail.completedLessons,
                    totalLessons: selectedUserDetail.totalLessons,
                    avgProgress: selectedUserDetail.avgProgress,
                    avgQuizScore: selectedUserDetail.avgQuizScore,
                    stars: learningDetail?.summary?.stars,
                  },
                  courses: learningDetail?.courses || [],
                  learningDetail: learningDetail?.learningDetail || [],
                }}
                loading={learningDetailLoading}
                error={learningDetailError}
                onRefresh={() => handleOpenUserDetail(selectedUserDetail)}
              />

              <div className="flex flex-wrap items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  disabled={Boolean(actionUserId)}
                  onClick={() => void handleSendPasswordReset(selectedUserDetail)}
                  className="px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 border border-indigo-200 rounded-xl transition shadow-2xs"
                >
                  ✉️ Gửi link đặt lại mật khẩu
                </button>

                {selectedUserDetail.accountState === 'OVERDUE_LOCK' ? (
                  <>
                    <Button
                      variant="primary"
                      onClick={() => {
                        const target = selectedUserDetail;
                        handleCloseUserDetail();
                        setUnlockExtensionModal({ user: target, extensionDays: 7 });
                      }}
                    >
                      Mở khóa & Gia hạn
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => {
                        handleOpenConfirmModal(selectedUserDetail, 'INACTIVE');
                        handleCloseUserDetail();
                      }}
                    >
                      Vô hiệu hóa tài khoản
                    </Button>
                  </>
                ) : selectedUserDetail.accountState === 'PASSWORD_LOCK' ? (
                  <>
                    <Button
                      variant="primary"
                      onClick={() => {
                        handleOpenConfirmModal(selectedUserDetail, 'ACTIVE');
                        handleCloseUserDetail();
                      }}
                    >
                      Mở khóa tài khoản
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => {
                        handleOpenConfirmModal(selectedUserDetail, 'INACTIVE');
                        handleCloseUserDetail();
                      }}
                    >
                      Vô hiệu hóa tài khoản
                    </Button>
                  </>
                ) : (
                  <Button
                    variant={selectedUserDetail.status === 'ACTIVE' ? 'danger' : 'primary'}
                    onClick={() => {
                      handleOpenConfirmModal(selectedUserDetail);
                      handleCloseUserDetail();
                    }}
                  >
                    {selectedUserDetail.status === 'ACTIVE' ? 'Vô hiệu hóa tài khoản' : 'Kích hoạt tài khoản'}
                  </Button>
                )}
                <Button variant="secondary" onClick={handleCloseUserDetail}>
                  Đóng
                </Button>
              </div>
            </div>
          )}
        </Modal>
    </>
  );
}
