'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import { apiFetch, getCachedApiData, clearApiCache } from '@/lib/api/client';
import LearnerProfileView from '@/components/learner/LearnerProfileView';

export default function MemberDetailPage({ params }: { params: { userId: string } }) {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [deactivateInputText, setDeactivateInputText] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const isAdmin = currentUser?.role === 'ADMIN';
  const canManageMembers = currentUser?.role === 'CHAPTER_LEADER' || isAdmin || currentUser?.canManageMembers === true;

  const handleToggleUserStatus = async () => {
    if (!data?.user?.userId) return;
    const nextStatus = data.user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    if (nextStatus === 'INACTIVE' && deactivateInputText.trim().toLowerCase() !== 'vô hiệu hóa') {
      return;
    }
    setActionLoading(true);
    const res = await apiFetch(`/api/v1/users/${data.user.userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus, chapterId: currentUser?.chapterId }),
    });
    setActionLoading(false);
    setShowConfirmModal(false);
    setDeactivateInputText('');
    if (res.ok) {
      setData((prev: any) => ({
        ...prev,
        user: { ...prev.user, status: nextStatus },
      }));
      clearApiCache('/api/v1/chapters');
      clearApiCache('/api/v1/users');
      setToast({
        type: nextStatus === 'ACTIVE' ? 'success' : 'info',
        message: nextStatus === 'ACTIVE' ? 'Đã kích hoạt tài khoản thành công.' : 'Đã vô hiệu hóa tài khoản.',
      });
    } else {
      setToast({
        type: 'error',
        message: res.error?.message || 'Không thể thay đổi trạng thái tài khoản.',
        title: 'Thao tác không thành công',
      });
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      let parsed: any = null;
      const u = localStorage.getItem('user');
      if (u) {
        try {
          parsed = JSON.parse(u);
          setCurrentUser(parsed);
        } catch {}
      }
      loadMemberDetail(parsed?.role === 'ADMIN' ? 'all' : parsed?.chapterId);
    }
  }, [params.userId]);

  async function loadMemberDetail(chapterId?: string) {
    setLoading(true);
    setError(null);
    const targetChapter = chapterId || 'me';
    const url = `/api/v1/chapters/${targetChapter}/members/${params.userId}/course-progress`;

    const cached = getCachedApiData<any>(url);
    if (cached) {
      setData(cached);
      setLoading(false);
    }

    const res = await apiFetch(url);
    if (res.ok && res.data) {
      setData(res.data);
      setError(null);
    } else if (!cached) {
      setError(res.error?.message || 'Không tải được tiến độ của thành viên này');
    }
    setLoading(false);
  }

  const memberStatus = data?.user?.status;

  return (
    <div className="min-h-screen bg-[#f8f9ff]">
      <Toast toast={toast} onClose={() => setToast(null)} />
      <main className="px-6 sm:px-8 py-8 w-full min-w-0 max-w-6xl mx-auto">
        {/* Navigation Breadcrumb */}
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/chapter-manager/members"
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white border border-[#cbdbf5] text-xs font-bold text-[#172554] hover:bg-[#eff4ff] hover:text-[#2563EB] hover:border-[#2563EB] shadow-2xs transition-all"
          >
            ← Quay lại danh sách thành viên
          </Link>
        </div>

        {/* Unified Learner Profile View */}
        <LearnerProfileView
          user={{
            userId: data?.user?.userId,
            displayName: data?.user?.displayName,
            email: data?.user?.email,
            status: data?.user?.status,
            accountState: data?.user?.accountState,
            role: data?.user?.role,
            chapterName: data?.user?.chapterName || data?.user?.chapter?.name,
            departmentName: data?.user?.departmentName || data?.user?.department?.name,
            createdAt: data?.user?.joinedAt || data?.user?.createdAt,
            deactivatedByRole: data?.user?.deactivatedByRole,
          }}
          progressData={{
            summary: data?.summary,
            courses: data?.courses,
            learningDetail: data?.learningDetail,
          }}
          loading={loading && !data}
          error={error}
          onRefresh={() => loadMemberDetail(currentUser?.role === 'ADMIN' ? 'all' : currentUser?.chapterId)}
          headerActions={
            canManageMembers && (
              <div className="flex items-center gap-2">
                {memberStatus === 'ACTIVE' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-red-50 text-red-700 border-red-300 hover:bg-red-100 font-bold text-xs shadow-2xs"
                    onClick={() => {
                      setDeactivateInputText('');
                      setShowConfirmModal(true);
                    }}
                    loading={actionLoading}
                  >
                    ⛔ Vô hiệu hóa tài khoản
                  </Button>
                ) : isAdmin ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100 font-bold text-xs shadow-2xs"
                    onClick={() => {
                      setDeactivateInputText('');
                      setShowConfirmModal(true);
                    }}
                    loading={actionLoading}
                  >
                    ✓ Kích hoạt lại
                  </Button>
                ) : (
                  <span
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-500 shadow-2xs"
                    title="Theo quy tắc an toàn P1.3, chỉ Admin mới có quyền kích hoạt lại tài khoản đã vô hiệu hóa."
                  >
                    🔒 Chỉ Admin mới có quyền mở lại
                  </span>
                )}
              </div>
            )
          }
        >
          {/* Modal xác nhận vô hiệu hóa / kích hoạt */}
          {showConfirmModal && (
            <Modal
              isOpen={showConfirmModal}
              onClose={() => setShowConfirmModal(false)}
              maxWidth="max-w-md"
            >
              <div className="space-y-4 p-2">
                <div className="flex items-center justify-between pb-2 border-b border-[#eff4ff]">
                  <h3
                    className={`text-base font-bold ${
                      memberStatus === 'ACTIVE' ? 'text-red-700' : 'text-emerald-700'
                    }`}
                  >
                    {memberStatus === 'ACTIVE'
                      ? 'Xác nhận vô hiệu hóa tài khoản'
                      : 'Xác nhận kích hoạt tài khoản'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(false)}
                    className="text-[#737686] hover:text-[#172554] text-base font-bold px-2 py-1"
                  >
                    ✕
                  </button>
                </div>
                <p className="text-xs text-[#596174] leading-relaxed">
                  {memberStatus === 'ACTIVE'
                    ? `Bạn có chắc muốn vô hiệu hóa tài khoản ${data?.user?.email}? Tài khoản này sẽ không thể đăng nhập học tập và không tính vào các báo cáo nhiệm kỳ mới.`
                    : `Bạn có chắc muốn kích hoạt lại tài khoản ${data?.user?.email}?`}
                </p>

                {memberStatus === 'ACTIVE' && (
                  <div className="p-3 bg-red-50/80 border border-red-200 rounded-xl space-y-1.5">
                    <label className="block text-xs font-semibold text-red-950">
                      Để xác nhận, vui lòng nhập chính xác chữ{' '}
                      <strong className="text-red-600 underline font-extrabold">&ldquo;vô hiệu hóa&rdquo;</strong>{' '}
                      vào ô bên dưới:
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

                <div className="flex justify-end gap-2 pt-2 border-t border-[#eff4ff]">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowConfirmModal(false);
                      setDeactivateInputText('');
                    }}
                  >
                    Hủy
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    className={
                      memberStatus === 'ACTIVE'
                        ? 'bg-red-600 hover:bg-red-700 text-white font-bold'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white font-bold'
                    }
                    loading={actionLoading}
                    disabled={
                      actionLoading ||
                      (memberStatus === 'ACTIVE' &&
                        deactivateInputText.trim().toLowerCase() !== 'vô hiệu hóa')
                    }
                    onClick={handleToggleUserStatus}
                  >
                    {memberStatus === 'ACTIVE' ? 'Xác nhận vô hiệu hóa' : 'Kích hoạt lại'}
                  </Button>
                </div>
              </div>
            </Modal>
          )}
        </LearnerProfileView>
      </main>
    </div>
  );
}
