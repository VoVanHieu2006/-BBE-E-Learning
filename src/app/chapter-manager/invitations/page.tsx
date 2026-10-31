'use client';
import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import { apiFetch, clearApiCache, getCachedApiData } from '@/lib/api/client';
import {
  BULK_INVITE_MAX_EMAILS,
  BULK_INVITE_STATUS_LABELS,
  BulkInviteResultItem,
  BulkInviteStatus,
  parseBulkInviteEmails,
} from '@/lib/bulk-invite';

const BULK_STATUS_STYLES: Record<BulkInviteStatus, string> = {
  SENT: 'bg-green-100 text-green-800',
  SENT_EMAIL_FAILED: 'bg-amber-100 text-amber-800',
  INVALID: 'bg-red-100 text-red-800',
  DUPLICATE: 'bg-slate-100 text-slate-700',
  ALREADY_MEMBER: 'bg-blue-100 text-blue-800',
  ALREADY_INVITED: 'bg-violet-100 text-violet-800',
  FAILED: 'bg-red-100 text-red-800',
};

export default function ChapterManagerInvitationsPage() {
  const [user, setUser] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMode, setInviteMode] = useState<'single' | 'bulk'>('single');
  const [bulkText, setBulkText] = useState('');
  const [bulkResults, setBulkResults] = useState<BulkInviteResultItem[] | null>(null);
  const [sending, setSending] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
  };

  useEffect(() => {
    setMounted(true);
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
      body: JSON.stringify({ email: inviteEmail.trim(), chapterId: user?.chapterId }),
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

  const bulkPreview = parseBulkInviteEmails(bulkText);
  const bulkTotal = bulkPreview.valid.length + bulkPreview.invalid.length;

  function openInviteModal() {
    setInviteMode('single');
    setBulkResults(null);
    setShowInviteModal(true);
  }

  async function handleBulkInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!bulkPreview.valid.length) {
      showToast('error', 'Danh sách chưa có email hợp lệ nào.');
      return;
    }
    if (bulkTotal > BULK_INVITE_MAX_EMAILS) {
      showToast('error', `Mỗi lần chỉ mời tối đa ${BULK_INVITE_MAX_EMAILS} email.`);
      return;
    }
    setSending(true);
    clearApiCache('/api/v1/invitations');
    try {
      const res = await apiFetch('/api/v1/invitations/member/bulk', {
        method: 'POST',
        body: JSON.stringify({ emails: bulkText, chapterId: user?.chapterId }),
      });
      if (res.ok && res.data?.results) {
        setBulkResults(res.data.results);
        const sent = Number(res.data.summary?.sent || 0);
        showToast(sent > 0 ? 'success' : 'info', `Đã gửi ${sent}/${res.data.results.length} lời mời. Xem chi tiết từng email bên dưới.`);
        if (sent > 0) loadInvitations(undefined, true);
      } else {
        showToast('error', res.error?.message || 'Lỗi khi gửi lời mời hàng loạt');
      }
    } finally {
      setSending(false);
    }
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
        showToast('error', res.error?.message || 'Lỗi khi gửi lại lời mời');
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCancel(invitationId: string) {
    if (!window.confirm('Bạn có chắc muốn hủy lời mời này? Người nhận sẽ không thể kích hoạt nữa.')) return;
    setBusyAction(`${invitationId}:cancel`);
    clearApiCache('/api/v1/invitations');
    try {
      const res = await apiFetch(`/api/v1/invitations/${invitationId}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('success', 'Đã hủy lời mời.');
        loadInvitations();
      } else {
        showToast('error', res.error?.message || 'Lỗi khi hủy lời mời');
      }
    } finally {
      setBusyAction(null);
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
              Chapter: <span suppressHydrationWarning className="font-semibold text-[#172554]">{mounted && user?.chapterName ? user.chapterName : 'Chapter của bạn'}</span> • Mời thành viên mới và theo dõi trạng thái kích hoạt
            </p>
          </div>
          <Button onClick={openInviteModal}>
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
                        {inv.status === 'PENDING' && inv.invitedBy === user?.id && (
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
                        {inv.status === 'PENDING' && inv.invitedBy !== user?.id && <span className="text-xs text-[#737686]">Chỉ người gửi mới sửa được</span>}
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
          maxWidth={inviteMode === 'bulk' ? 'max-w-xl' : 'max-w-md'}
        >
          <div className="p-6 space-y-4">
            <h3 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              Mời thành viên mới
            </h3>
            <p className="text-xs text-[#737686]">
              Gửi email lời mời tham gia Chapter <span suppressHydrationWarning>{mounted && user?.chapterName ? user.chapterName : ''}</span>. Lời mời có hiệu lực trong 24 giờ.
            </p>
            <div className="flex gap-2" role="tablist" aria-label="Cách mời">
              {([
                { key: 'single', label: 'Một email' },
                { key: 'bulk', label: 'Nhiều email' },
              ] as const).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={inviteMode === tab.key}
                  disabled={sending}
                  onClick={() => setInviteMode(tab.key)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                    inviteMode === tab.key ? 'bg-[#2563EB] text-white' : 'bg-white text-[#434655] border border-[#cbdbf5] hover:bg-[#eff4ff]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {inviteMode === 'bulk' ? (
            <form onSubmit={handleBulkInvite} className="space-y-4">
              <div>
                <label htmlFor="bulk-invite-emails" className="block text-sm font-semibold text-[#172554] mb-1">Danh sách email *</label>
                <textarea
                  id="bulk-invite-emails"
                  rows={6}
                  value={bulkText}
                  onChange={(e) => { setBulkText(e.target.value); setBulkResults(null); }}
                  placeholder={'a@bbe.vn\nb@bbe.vn, c@bbe.vn; d@bbe.vn'}
                  className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
                <p className="text-[11px] text-[#737686] mt-1">
                  Phân tách bằng xuống dòng, dấu phẩy, dấu chấm phẩy hoặc khoảng trắng. Tối đa {BULK_INVITE_MAX_EMAILS} email mỗi lần.
                </p>
                {bulkText.trim() && (
                  <p className="text-xs mt-1 text-[#434655]" data-testid="bulk-invite-preview">
                    <strong className="text-green-700">{bulkPreview.valid.length}</strong> hợp lệ
                    {bulkPreview.invalid.length > 0 && <> · <strong className="text-red-700">{bulkPreview.invalid.length}</strong> không hợp lệ</>}
                    {bulkPreview.duplicates.length > 0 && <> · <strong>{bulkPreview.duplicates.length}</strong> trùng lặp (bỏ qua)</>}
                    {bulkTotal > BULK_INVITE_MAX_EMAILS && <span className="text-red-700"> · vượt quá {BULK_INVITE_MAX_EMAILS} email</span>}
                  </p>
                )}
              </div>
              {bulkResults && (
                <div className="max-h-64 overflow-y-auto border border-[#eff4ff] rounded-xl divide-y divide-[#eff4ff]" data-testid="bulk-invite-results">
                  {bulkResults.map((row) => (
                    <div key={`${row.status}:${row.email}`} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
                      <span className="font-semibold text-[#172554] break-all">{row.email}</span>
                      <span className="text-right">
                        <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full font-bold ${BULK_STATUS_STYLES[row.status]}`}>
                          {BULK_INVITE_STATUS_LABELS[row.status]}
                        </span>
                        {row.message && row.status !== 'ALREADY_MEMBER' && <span className="block text-[10px] text-[#737686] mt-0.5">{row.message}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <Button variant="outline" type="button" disabled={sending} onClick={() => setShowInviteModal(false)}>
                  {bulkResults ? 'Đóng' : 'Hủy'}
                </Button>
                <Button type="submit" loading={sending} loadingText="Đang gửi..." disabled={!bulkPreview.valid.length || bulkTotal > BULK_INVITE_MAX_EMAILS}>
                  Gửi {bulkPreview.valid.length || ''} lời mời
                </Button>
              </div>
            </form>
            ) : (
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
            )}
          </div>
        </Modal>
    </div>
  );
}
