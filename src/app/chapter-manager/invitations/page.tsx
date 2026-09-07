'use client';
import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import { apiFetch, clearApiCache, getCachedApiData } from '@/lib/api/client';

export default function ChapterManagerInvitationsPage() {
  const [user, setUser] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const u = localStorage.getItem('user');
      if (u) {
        try {
          const parsed = JSON.parse(u);
          setUser(parsed);
          loadInvitations(parsed.chapterId);
        } catch {}
      }
    }
  }, []);

  async function loadInvitations(chapterId?: string, noCache = false) {
    const targetChapter = chapterId || user?.chapterId;
    const url = targetChapter
      ? `/api/v1/invitations?chapterId=${targetChapter}`
      : '/api/v1/invitations';

    // Cache-first: hiện dữ liệu cache ngay trong khi revalidate nền
    if (!noCache) {
      const cached = getCachedApiData<any>(url);
      if (cached?.items) {
        setItems(cached.items);
        setLoading(false);
      }
    }

    const res = await apiFetch(url, { noCache });
    if (res.ok && res.data) {
      setItems(res.data.items || []);
    }
    setLoading(false);
  }

  async function handleSendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setSending(true);
    clearApiCache('/api/v1/invitations');

    const res = await apiFetch('/api/v1/invitations/member', {
      method: 'POST',
      body: JSON.stringify({ email: inviteEmail.trim() }),
    });

    if (res.ok) {
      if (res.data?.emailSent === false) {
        showToast('info', `Đã lưu lời mời cho ${inviteEmail}, nhưng GỬI EMAIL THẤT BẠI: ${res.data.emailError || 'không rõ lý do'}`);
      } else {
        showToast('success', `Đã gửi lời mời tham gia thành công đến ${inviteEmail}!`);
      }
      setShowInviteModal(false);
      setInviteEmail('');
      loadInvitations();
    } else {
      showToast('error', res.error?.message || 'Lỗi khi gửi lời mời');
    }
    setSending(false);
  }

  async function handleResend(invitationId: string) {
    clearApiCache('/api/v1/invitations');
    const res = await apiFetch(`/api/v1/invitations/${invitationId}/resend`, { method: 'POST' });
    if (res.ok) {
      if (res.data?.emailSent === false) {
        showToast('info', `Lời mời đã được làm mới nhưng GỬI EMAIL THẤT BẠI: ${res.data.emailError || 'không rõ lý do'}`);
      } else {
        showToast('success', 'Đã gửi lại lời mời thành công!');
      }
      loadInvitations();
    } else {
      showToast('error', res.error?.message || 'Lỗi khi gửi lại lời mời');
    }
  }

  async function handleCancel(invitationId: string) {
    if (!window.confirm('Bạn có chắc muốn hủy lời mời này? Người nhận sẽ không thể kích hoạt nữa.')) return;
    clearApiCache('/api/v1/invitations');

    const res = await apiFetch(`/api/v1/invitations/${invitationId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('success', 'Đã hủy lời mời.');
      loadInvitations();
    } else {
      showToast('error', res.error?.message || 'Lỗi khi hủy lời mời');
    }
  }

  const filteredItems = items.filter((inv) => {
    if (statusFilter === 'ALL') return true;
    return inv.status === statusFilter;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return (
          <span className="whitespace-nowrap inline-flex items-center bg-amber-100 text-amber-800 text-xs font-bold px-2.5 py-1 rounded-full">
            ⏳ Đang chờ
          </span>
        );
      case 'ACCEPTED':
        return (
          <span className="whitespace-nowrap inline-flex items-center bg-green-100 text-green-800 text-xs font-bold px-2.5 py-1 rounded-full">
            ✓ Đã kích hoạt
          </span>
        );
      case 'EXPIRED':
        return (
          <span className="whitespace-nowrap inline-flex items-center bg-slate-100 text-slate-700 text-xs font-bold px-2.5 py-1 rounded-full">
            ⏰ Hết hạn
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="whitespace-nowrap inline-flex items-center bg-red-100 text-red-800 text-xs font-bold px-2.5 py-1 rounded-full">
            ✕ Đã hủy
          </span>
        );
      default:
        return (
          <span className="whitespace-nowrap inline-flex items-center bg-slate-100 text-slate-700 text-xs font-bold px-2.5 py-1 rounded-full">
            {status}
          </span>
        );
    }
  };

  return (
    <div>
        <Toast toast={toast} onClose={() => setToast(null)} />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              Quản lý lời mời thành viên
            </h1>
            <p className="text-[#737686] mt-1 text-sm">
              Chapter: <span className="font-semibold text-[#172554]">{user?.chapterName || 'Chapter của bạn'}</span> • Mời thành viên mới và theo dõi trạng thái kích hoạt
            </p>
          </div>
          <Button onClick={() => setShowInviteModal(true)}>
            ＋ Mời thành viên mới
          </Button>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {[
            { key: 'ALL', label: 'Tất cả lời mời' },
            { key: 'PENDING', label: 'Đang chờ' },
            { key: 'ACCEPTED', label: 'Đã kích hoạt' },
            { key: 'EXPIRED', label: 'Hết hạn' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
                statusFilter === tab.key
                  ? 'bg-[#2563EB] text-white shadow-sm'
                  : 'bg-white text-[#434655] hover:bg-[#eff4ff] border border-[#cbdbf5]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Table */}
        <Card className="p-0 overflow-hidden border border-[#eff4ff] shadow-sm">
          {loading && items.length === 0 ? (
            <div className="p-8 space-y-4 animate-pulse">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-12 bg-slate-100 rounded-xl"></div>
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-16 text-[#737686]">
              <p className="text-lg font-semibold text-[#172554] mb-1">Chưa có lời mời nào</p>
              <p className="text-sm">Bấm &quot;Mời thành viên mới&quot; để gửi lời mời qua email.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#f8f9ff] text-[#434655] font-semibold border-b border-[#eff4ff]">
                  <tr>
                    <th className="px-6 py-4">Email</th>
                    <th className="px-6 py-4 text-center">Trạng thái</th>
                    <th className="px-6 py-4">Thời gian gửi</th>
                    <th className="px-6 py-4">Hạn chót</th>
                    <th className="px-6 py-4 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eff4ff]">
                  {filteredItems.map((inv) => (
                    <tr key={inv.id} className="hover:bg-[#f8f9ff] transition">
                      <td className="px-6 py-4 font-semibold text-[#172554]">{inv.email}</td>
                      <td className="px-6 py-4 text-center">{getStatusBadge(inv.status)}</td>
                      <td className="px-6 py-4 text-xs text-[#737686]" suppressHydrationWarning>
                        {inv.createdAt ? new Date(inv.createdAt).toLocaleString('vi-VN') : '—'}
                      </td>
                      <td className="px-6 py-4 text-xs text-[#737686]" suppressHydrationWarning>
                        {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString('vi-VN') : '—'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {inv.status === 'PENDING' && (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleResend(inv.id)}
                              className="text-xs font-semibold text-[#2563EB] hover:underline"
                            >
                              Gửi lại
                            </button>
                            <span className="text-slate-300">|</span>
                            <button
                              onClick={() => handleCancel(inv.id)}
                              className="text-xs font-semibold text-red-600 hover:underline"
                            >
                              Hủy
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
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
              Mời thành viên mới
            </h3>
            <p className="text-xs text-[#737686]">
              Gửi email lời mời tham gia Chapter {user?.chapterName || ''}. Lời mời có hiệu lực trong 24 giờ.
            </p>
            <form onSubmit={handleSendInvite} className="space-y-4">
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
                  disabled={sending}
                  onClick={() => setShowInviteModal(false)}
                >
                  Hủy
                </Button>
                <Button type="submit" loading={sending} loadingText="Đang gửi...">
                  Gửi lời mời
                </Button>
              </div>
            </form>
          </div>
        </Modal>
    </div>
  );
}
