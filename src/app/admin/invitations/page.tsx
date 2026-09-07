'use client';
import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import { apiFetch, clearApiCache, getCachedApiData } from '@/lib/api/client';
import { useAdmin } from '../AdminContext';

export default function AdminInvitationsPage() {
  const { mounted } = useAdmin();

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
  };

  // Modal Send Leader Invite
  const [showLeaderModal, setShowLeaderModal] = useState(false);
  const [leaderSending, setLeaderSending] = useState(false);
  const [leaderForm, setLeaderForm] = useState({
    email: '',
    chapterName: '',
    chapterDescription: '',
  });

  useEffect(() => {
    const cached = getCachedApiData<any>('/api/v1/invitations');
    if (cached?.items) {
      setItems(cached.items);
      setLoading(false);
    }
    loadInvitations();
  }, []);

  async function loadInvitations() {
    const res = await apiFetch('/api/v1/invitations');
    if (res.ok && res.data) {
      setItems(res.data.items || []);
    }
    setLoading(false);
  }

  async function handleSendLeaderInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!leaderForm.email.trim() || !leaderForm.chapterName.trim()) {
      showToast('error', 'Vui lòng điền đầy đủ email và tên Chapter.');
      return;
    }

    setLeaderSending(true);
    clearApiCache('/api/v1/invitations');
    clearApiCache('/api/v1/chapters');

    const res = await apiFetch('/api/v1/invitations/chapter-leader', {
      method: 'POST',
      body: JSON.stringify({
        email: leaderForm.email.trim().toLowerCase(),
        chapterName: leaderForm.chapterName.trim(),
        chapterDescription: leaderForm.chapterDescription.trim(),
      }),
    });

    if (res.ok) {
      if (res.data?.emailSent === false) {
        showToast('info', `Đã tạo lời mời cho ${leaderForm.email}, nhưng GỬI EMAIL THẤT BẠI: ${res.data.emailError || 'không rõ lý do'}`);
      } else {
        showToast('success', `Đã gửi lời mời Trưởng Chapter đến ${leaderForm.email}!`);
      }
      setShowLeaderModal(false);
      setLeaderForm({ email: '', chapterName: '', chapterDescription: '' });
      loadInvitations();
    } else {
      showToast('error', res.error?.message || 'Lỗi gửi lời mời Trưởng Chapter');
    }
    setLeaderSending(false);
  }

  async function handleResend(invitationId: string) {
    setBusyAction(`${invitationId}:resend`);
    clearApiCache('/api/v1/invitations');
    try {
      const res = await apiFetch(`/api/v1/invitations/${invitationId}/resend`, { method: 'POST' });
      if (res.ok) {
        if (res.data?.emailSent === false) {
          showToast('info', `Lời mời đã được làm mới nhưng GỬI EMAIL THẤT BẠI: ${res.data.emailError || 'không rõ lý do'}`);
        } else {
          showToast('success', 'Đã gửi lại lời mời thành công!');
        }
        loadInvitations();
      } else {
        showToast('error', res.error?.message || 'Lỗi gửi lại lời mời');
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCancel(invitationId: string) {
    if (!window.confirm('Bạn có chắc chắn muốn hủy lời mời này?')) return;
    setBusyAction(`${invitationId}:cancel`);
    clearApiCache('/api/v1/invitations');
    try {
      const res = await apiFetch(`/api/v1/invitations/${invitationId}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('success', 'Đã hủy lời mời thành công.');
        loadInvitations();
      } else {
        showToast('error', res.error?.message || 'Lỗi hủy lời mời');
      }
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              Quản lý lời mời (BĐHU)
            </h1>
            <p className="text-[#737686] mt-1 text-sm">
              Mời Ban Định Hướng (Trưởng Chapter) và khởi tạo Chapter hoạt động mới
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => setShowLeaderModal(true)}>
              ＋ Mời Trưởng Chapter (BĐHU)
            </Button>
          </div>
        </div>

        {/* Invitations Table */}
        <Card className="p-0 overflow-hidden border border-[#eff4ff] shadow-sm">
          {!mounted || (loading && items.length === 0) ? (
            <div className="p-8 space-y-4 animate-pulse">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-12 bg-slate-100 rounded-xl"></div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-[#737686]">
              <p className="text-lg font-semibold text-[#172554] mb-1">Chưa có lời mời nào được gửi</p>
              <p className="text-sm text-[#737686]">Bấm nút &quot;Mời Trưởng Chapter (BĐHU)&quot; ở trên để bắt đầu.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#f8f9ff] text-[#434655] font-semibold border-b border-[#eff4ff]">
                  <tr>
                    <th className="px-6 py-4">Email nhận lời mời</th>
                    <th className="px-6 py-4">Vai trò</th>
                    <th className="px-6 py-4">Chapter</th>
                    <th className="px-6 py-4">Trạng thái</th>
                    <th className="px-6 py-4">Hạn chót</th>
                    <th className="px-6 py-4 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eff4ff]">
                  {items.map((inv) => {
                    const isPending = inv.status === 'PENDING';
                    const isAccepted = inv.status === 'ACCEPTED';
                    const isExpired = inv.status === 'EXPIRED';

                    return (
                      <tr key={inv.id} className="hover:bg-[#f8f9ff] transition">
                        <td className="px-6 py-4 font-semibold text-[#172554]">{inv.email}</td>
                        <td className="px-6 py-4">
                          <span className="whitespace-nowrap inline-flex items-center text-xs font-bold px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
                            Trưởng Chapter (BĐHU)
                          </span>
                        </td>
                        <td className="px-6 py-4 text-[#434655]">{inv.chapterName || '—'}</td>
                        <td className="px-6 py-4">
                          <span
                            className={`whitespace-nowrap inline-flex items-center text-xs font-bold px-2.5 py-0.5 rounded-full ${
                              isPending
                                ? 'bg-amber-100 text-amber-700'
                                : isAccepted
                                ? 'bg-green-100 text-green-700'
                                : isExpired
                                ? 'bg-red-100 text-red-700'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {isPending
                              ? '⏳ Đang chờ'
                              : isAccepted
                              ? '✓ Đã chấp nhận'
                              : isExpired
                              ? 'Đã hết hạn'
                              : 'Đã hủy'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs text-[#737686]" suppressHydrationWarning>
                          {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString('vi-VN') : '—'}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {isPending && (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleResend(inv.id)}
                                disabled={busyAction !== null}
                                className="text-xs font-semibold text-[#2563EB] hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {busyAction === `${inv.id}:resend` ? 'Đang gửi...' : 'Gửi lại'}
                              </button>
                              <span className="text-slate-300">|</span>
                              <button
                                onClick={() => handleCancel(inv.id)}
                                disabled={busyAction !== null}
                                className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {busyAction === `${inv.id}:cancel` ? 'Đang hủy...' : 'Hủy'}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Modal: Invite Chapter Leader */}
        <Modal
          isOpen={showLeaderModal}
          onClose={() => setShowLeaderModal(false)}
          maxWidth="max-w-md"
        >
          <div className="p-6 space-y-4">
            <h3 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              Mời Trưởng Chapter (BĐHU)
            </h3>
            <p className="text-xs text-[#737686]">
              Nhập email của Trưởng Chapter và tên Chapter mới cần khởi tạo.
            </p>
            <form onSubmit={handleSendLeaderInvite} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-[#172554] mb-1">Email *</label>
                <input
                  type="email"
                  required
                  value={leaderForm.email}
                  onChange={(e) => setLeaderForm({ ...leaderForm, email: e.target.value })}
                  placeholder="leader@bbe.vn"
                  className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#172554] mb-1">Tên Chapter *</label>
                <input
                  type="text"
                  required
                  value={leaderForm.chapterName}
                  onChange={(e) => setLeaderForm({ ...leaderForm, chapterName: e.target.value })}
                  placeholder="Ví dụ: Chapter Hà Nội"
                  className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#172554] mb-1">Mô tả Chapter</label>
                <textarea
                  rows={2}
                  value={leaderForm.chapterDescription}
                  onChange={(e) => setLeaderForm({ ...leaderForm, chapterDescription: e.target.value })}
                  placeholder="Mô tả khu vực hoặc nhóm hoạt động"
                  className="w-full px-4 py-2 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="outline"
                  type="button"
                  disabled={leaderSending}
                  onClick={() => setShowLeaderModal(false)}
                >
                  Hủy
                </Button>
                <Button type="submit" loading={leaderSending} loadingText="Đang gửi...">
                  Gửi lời mời
                </Button>
              </div>
            </form>
          </div>
        </Modal>
    </>
  );
}
