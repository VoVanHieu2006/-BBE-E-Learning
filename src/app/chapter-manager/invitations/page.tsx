'use client';
import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import { apiFetch, clearApiCache, getCachedApiData } from '@/lib/api/client';
import BulkInvitePanel from '@/components/invitations/BulkInvitePanel';
import EmailQuotaNotice, { useEmailQuota } from '@/components/invitations/EmailQuotaNotice';
import InviteLinkButton from '@/components/invitations/InviteLinkButton';
import DeliveryNote from '@/components/invitations/DeliveryNote';
import InvitePositionFields, { postInviteWithPresidentConfirm, usePresidentStatus } from '@/components/invitations/InvitePositionFields';
import { INVITE_POSITION_LABELS, PRESIDENT_TARGET, invitationTargetLabel, invitePayload, inviteSelection, inviteTargetReady } from '@/lib/member-invite-position';

export default function ChapterManagerInvitationsPage() {
  const [user, setUser] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  // Ô Ban: id ban, PRESIDENT_TARGET (Chủ tịch Chapter) hoặc rỗng; ô tick LT chỉ áp ở tab Một email.
  const [inviteTarget, setInviteTarget] = useState('');
  const [makeLead, setMakeLead] = useState(false);
  const presidentStatus = usePresidentStatus(true, inviteTarget);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [departmentsError, setDepartmentsError] = useState('');
  const [inviteMode, setInviteMode] = useState<'single' | 'bulk'>('single');
  const { position: invitePosition, departmentUnitId } = inviteSelection(
    presidentStatus.canInviteLeadership || inviteTarget !== PRESIDENT_TARGET ? inviteTarget : '',
    inviteMode === 'single' && makeLead && presidentStatus.canInviteLeadership,
  );
  const [sending, setSending] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [quotaTick, setQuotaTick] = useState(0);
  const quota = useEmailQuota(quotaTick);

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
          apiFetch('/api/v1/organization/managed-units', { noCache: true }).then((res) => {
            if (res.ok) setDepartments((res.data?.items || []).filter((unit: any) => unit.type === 'DEPARTMENT' && unit.chapterId === parsed.chapterId && unit.canManageMembers));
            else setDepartmentsError(res.error?.message || 'Không tải được danh sách ban. Vui lòng tải lại trang.');
          }).catch(() => setDepartmentsError('Không tải được danh sách ban. Vui lòng tải lại trang.'));
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
    if (!inviteTargetReady(invitePosition, departmentUnitId)) { showToast('error', 'Vui lòng chọn ban cho thành viên.'); return; }

    setSending(true);
    clearApiCache('/api/v1/invitations');

    const res = await postInviteWithPresidentConfirm('/api/v1/invitations/member', { email: inviteEmail.trim(), ...invitePayload(invitePosition, departmentUnitId) });
    if (!res) { setSending(false); showToast('info', `Chưa gửi lời mời ${INVITE_POSITION_LABELS[invitePosition]} vì bạn chưa xác nhận thay thế.`); return; }

    if (res.ok) {
      presidentStatus.refresh();
      if (res.data?.emailSent === false) {
        showToast('info', `Đã tạo lời mời cho ${inviteEmail} nhưng chưa gửi được mail (${res.data.emailError || 'không rõ lý do'}). Bấm "Link mời ${inviteEmail}" ở bảng để lấy link gửi cho họ.`);
      } else {
        showToast('success', `Đã gửi lời mời ${INVITE_POSITION_LABELS[invitePosition]} thành công đến ${inviteEmail}!`);
      }
      setShowInviteModal(false);
      setInviteEmail('');
      setQuotaTick((n) => n + 1);
      loadInvitations();
    } else {
      showToast('error', res.error?.message || 'Lỗi khi gửi lời mời');
    }
    setSending(false);
  }

  function openInviteModal() {
    setInviteMode('single');
    // Mỗi lần mở lại modal về mặc định Thành viên ban (bỏ tick LT, bỏ Chủ tịch), tránh vô tình thay Chủ tịch/Trưởng ban.
    setMakeLead(false);
    if (inviteTarget === PRESIDENT_TARGET) setInviteTarget('');
    presidentStatus.refresh();
    setShowInviteModal(true);
  }

  async function handleResend(invitationId: string) {
    setBusyAction(`${invitationId}:resend`);
    clearApiCache('/api/v1/invitations');
    try {
      const res = await postInviteWithPresidentConfirm(`/api/v1/invitations/${invitationId}/resend`, {});
      if (!res) { showToast('info', 'Chưa gửi lại lời mời vì bạn chưa xác nhận thay thế.'); return; }
      if (res.ok) {
        presidentStatus.refresh();
        if (res.data?.emailSent === false) {
          showToast('info', `Lời mời đã được làm mới nhưng chưa gửi được mail (${res.data.emailError || 'không rõ lý do'}). Dùng nút "Link mời" của dòng này để lấy link.`);
        } else {
          showToast('success', 'Đã gửi lại lời mời thành công!');
        }
        setQuotaTick((n) => n + 1);
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
            <p className="text-[#6c6f7f] mt-1 text-sm">
              Chapter: <span suppressHydrationWarning className="font-semibold text-[#172554]">{mounted && user?.chapterName ? user.chapterName : 'Chapter của bạn'}</span> • Mời thành viên mới và theo dõi trạng thái kích hoạt
            </p>
          </div>
          <Button onClick={openInviteModal}>
            ＋ Mời thành viên mới
          </Button>
        </div>
        <EmailQuotaNotice quota={quota} className="-mt-3 mb-4" />

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
            <div className="text-center py-16 text-[#6c6f7f]">
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
                      <td className="px-6 py-4 font-semibold text-[#172554]">
                        {inv.email}
                        <InvitationTarget inv={inv} />
                      </td>
                      <td className="px-6 py-4 text-center">{getStatusBadge(inv.status)}<DeliveryNote status={inv.status} deliveryMethod={inv.deliveryMethod} /></td>
                      <td className="px-6 py-4 text-xs text-[#6c6f7f]" suppressHydrationWarning>
                        {inv.createdAt ? new Date(inv.createdAt).toLocaleString('vi-VN') : '—'}
                      </td>
                      <td className="px-6 py-4 text-xs text-[#6c6f7f]" suppressHydrationWarning>
                        {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString('vi-VN') : '—'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {inv.status === 'PENDING' && inv.invitedBy === user?.id && (
                          <div className="flex items-center justify-end gap-2">
                            {inv.deliveryMethod === 'LINK' ? (
                              <InviteLinkButton
                                invitationId={inv.id}
                                email={inv.email}
                                disabled={busyAction !== null}
                                onMessage={(type, text) => { showToast(type, text); loadInvitations(undefined, true); }}
                              />
                            ) : (
                              <button
                                onClick={() => handleResend(inv.id)}
                                disabled={busyAction !== null}
                                className="text-xs font-semibold text-[#2563EB] hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {busyAction === `${inv.id}:resend` ? 'Đang gửi...' : 'Gửi lại'}
                              </button>
                            )}
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
                        {inv.status === 'PENDING' && inv.invitedBy !== user?.id && <span className="text-xs text-[#6c6f7f]">Chỉ người gửi mới sửa được</span>}
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
            <p className="text-xs text-[#6c6f7f]">
              Gửi email lời mời tham gia Chapter <span suppressHydrationWarning>{mounted && user?.chapterName ? user.chapterName : ''}</span>. Lời mời có hiệu lực trong 24 giờ.
            </p>
            {inviteMode === 'single' && <EmailQuotaNotice quota={quota} />}
            <InvitePositionFields
              idPrefix="invite"
              target={inviteTarget}
              onTargetChange={setInviteTarget}
              departments={departments}
              departmentsError={departmentsError}
              canInviteLeadership={presidentStatus.canInviteLeadership}
              showLeadToggle={inviteMode === 'single'}
              makeLead={makeLead}
              onMakeLeadChange={setMakeLead}
              presidentWarning={presidentStatus.warning}
              departmentLeadWarning={presidentStatus.departmentUnitId === inviteTarget ? presidentStatus.departmentLeadWarning : null}
              disabled={sending}
            />
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
            <BulkInvitePanel
              organizationUnitId={departmentUnitId}
              position={invitePosition}
              missingScopeMessage="Chọn ban của thành viên ở trên trước khi mời."
              onSent={() => { setQuotaTick((n) => n + 1); loadInvitations(undefined, true); presidentStatus.refresh(); }}
              onClose={() => setShowInviteModal(false)}
              disabled={sending}
            />
            ) : (
            <form onSubmit={handleSendInvite} className="space-y-4">
              <div>
                <label htmlFor="invite-email" className="block text-sm font-semibold text-[#172554] mb-1">Email học viên *</label>
                <input id="invite-email"
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
                <Button type="submit" loading={sending} loadingText="Đang gửi..." disabled={!inviteTargetReady(invitePosition, departmentUnitId)}>
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

/** Chức vụ đích của lời mời (Chủ tịch / Trưởng ban · ban / Thành viên ban · ban). */
function InvitationTarget({ inv }: { inv: any }) {
  const label = invitationTargetLabel({ role: inv.role, positionCode: inv.positionCode, unitType: inv.organizationUnitType, unitName: inv.organizationUnitName });
  if (!label) return null;
  const president = inv.positionCode === 'PRESIDENT';
  return (
    <span data-testid="invitation-target" className={`mt-0.5 block text-xs font-medium ${president ? 'text-amber-800' : 'text-[#6c6f7f]'}`}>
      {president ? '⭐ ' : ''}{label}
    </span>
  );
}
