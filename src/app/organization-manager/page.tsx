'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { apiFetch, clearApiCache } from '@/lib/api/client';

type Unit = { id: string; name: string; type: string; chapterId: string | null; canManageMembers: boolean };
type Pagination = { page: number; limit: number; total: number; totalPages: number };

export default function OrganizationManagerPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<any>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState('');
  const [members, setMembers] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [addEmail, setAddEmail] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [rosterUrl, setRosterUrl] = useState('');
  const [effectiveAt, setEffectiveAt] = useState('');
  const [rosterPreview, setRosterPreview] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      const [profileResult, unitResult] = await Promise.all([
        apiFetch('/api/v1/auth/me'),
        apiFetch('/api/v1/organization/managed-units'),
      ]);
      if (cancelled) return;
      const currentUser = profileResult.data?.user;
      if (!profileResult.ok || !currentUser?.isOrganizationManager || !unitResult.ok) {
        router.replace(profileResult.ok ? '/student/dashboard' : '/login');
        return;
      }
      setProfile(currentUser);
      const available = (unitResult.data?.items || []) as Unit[];
      setUnits(available);
      const storedUnitId = JSON.parse(localStorage.getItem('user') || '{}')?.organizationUnitId;
      setUnitId(available.find((unit) => unit.id === storedUnitId)?.id || available[0]?.id || '');
      setLoading(false);
    };
    void initialize().catch(() => {
      if (!cancelled) router.replace('/login');
    });
    return () => { cancelled = true; };
  }, [router]);

  useEffect(() => {
    if (!unitId) return;
    const selected = units.find((unit) => unit.id === unitId);
    if (!selected) return;
    const load = async () => {
      setLoading(true);
      const params = new URLSearchParams({ page: String(page), limit: '20', search, includeInactive: '1' });
      const invitationParams = new URLSearchParams({ page: '1', limit: '50' });
      if (profile?.role === 'CHAPTER_LEADER' && selected.type === 'CHAPTER' && selected.chapterId) invitationParams.set('chapterId', selected.chapterId);
      else invitationParams.set('organizationUnitId', selected.id);
      const [roster, inviteList] = await Promise.all([
        apiFetch(`/api/v1/organization/units/${selected.id}/members?${params.toString()}`),
        selected.canManageMembers ? apiFetch(`/api/v1/invitations?${invitationParams.toString()}`) : Promise.resolve(null),
      ]);
      if (roster.ok && roster.data) {
        setMembers(roster.data.items || []);
        setPagination(roster.data.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 });
      } else {
        setMembers([]);
        setMessage(roster.error?.message || 'Không tải được danh sách thành viên trong phạm vi này.');
      }
      if (inviteList?.ok) setInvitations(inviteList.data?.items || []);
      else setInvitations([]);
      setLoading(false);
    };
    void load().catch(() => setLoading(false));
  }, [unitId, units, page, search, profile?.role]);

  const selectedUnit = units.find((unit) => unit.id === unitId) || null;
  const canManage = Boolean(selectedUnit?.canManageMembers);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchDraft.trim());
  };

  const addExistingMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedUnit || !addEmail.trim()) return;
    setBusy(true);
    clearApiCache(`/api/v1/organization/units/${selectedUnit.id}/members`);
    setMessage('');
    const result = await apiFetch(`/api/v1/organization/units/${selectedUnit.id}/members`, {
      method: 'POST',
      body: JSON.stringify({ action: 'ADD_MEMBER', email: addEmail.trim() }),
      noCache: true,
    });
    setBusy(false);
    if (!result.ok) { setMessage(result.error?.message || 'Không thể thêm thành viên.'); return; }
    setAddEmail('');
    setMessage('Đã thêm thành viên; lộ trình học đã được đồng bộ.');
    setPage(1);
    setSearch('');
    setSearchDraft('');
  };

  const inviteMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedUnit || !inviteEmail.trim()) return;
    setBusy(true);
    clearApiCache('/api/v1/invitations');
    setMessage('');
    const body = profile?.role === 'CHAPTER_LEADER' && selectedUnit.type === 'CHAPTER' && selectedUnit.chapterId
      ? { email: inviteEmail.trim(), chapterId: selectedUnit.chapterId }
      : { email: inviteEmail.trim(), organizationUnitId: selectedUnit.id };
    const result = await apiFetch('/api/v1/invitations/member', { method: 'POST', body: JSON.stringify(body), noCache: true });
    setBusy(false);
    if (!result.ok) { setMessage(result.error?.message || 'Không thể gửi lời mời.'); return; }
    setInviteEmail('');
    setMessage(result.data?.emailSent ? 'Đã gửi lời mời thành viên.' : 'Đã tạo lời mời, nhưng email chưa gửi được.');
    const params = new URLSearchParams({ page: '1', limit: '50' });
    if (profile?.role === 'CHAPTER_LEADER' && selectedUnit.type === 'CHAPTER' && selectedUnit.chapterId) params.set('chapterId', selectedUnit.chapterId);
    else params.set('organizationUnitId', selectedUnit.id);
    const updated = await apiFetch(`/api/v1/invitations?${params.toString()}`, { noCache: true });
    if (updated.ok) setInvitations(updated.data?.items || []);
  };

  const removeMember = async (member: any) => {
    if (!selectedUnit || !window.confirm(`Kết thúc membership của ${member.email} trong phạm vi ${selectedUnit.name}?`)) return;
    setBusy(true);
    clearApiCache(`/api/v1/organization/units/${selectedUnit.id}/members`);
    const result = await apiFetch(`/api/v1/organization/units/${selectedUnit.id}/members`, {
      method: 'POST', body: JSON.stringify({ action: 'REMOVE_MEMBER', userId: member.userId }), noCache: true,
    });
    setBusy(false);
    if (!result.ok) { setMessage(result.error?.message || 'Không thể kết thúc membership.'); return; }
    setMessage('Đã kết thúc membership và đồng bộ lại lộ trình học.');
    setMembers((current) => current.filter((item) => item.userId !== member.userId));
  };

  const invitationAction = async (invitation: any, action: 'cancel' | 'resend') => {
    setBusy(true);
    const result = await apiFetch(`/api/v1/invitations/${invitation.id}${action === 'resend' ? '/resend' : ''}`, {
      method: action === 'resend' ? 'POST' : 'DELETE', body: action === 'resend' ? JSON.stringify({}) : undefined, noCache: true,
    });
    setBusy(false);
    if (!result.ok) { setMessage(result.error?.message || 'Không cập nhật được lời mời.'); return; }
    setMessage(action === 'resend' ? 'Đã gửi lại lời mời.' : 'Đã hủy lời mời.');
    setInvitations((current) => current.map((item) => item.id === invitation.id ? { ...item, status: action === 'cancel' ? 'CANCELLED' : 'PENDING' } : item));
  };

  const previewRoster = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedUnit?.chapterId || !rosterUrl.trim()) return;
    setBusy(true); setMessage('');
    const result = await apiFetch(`/api/v1/chapters/${selectedUnit.chapterId}/reorganizations/parse-sheet`, { method: 'POST', noCache: true, body: JSON.stringify({ url: rosterUrl.trim() }) });
    setBusy(false);
    if (!result.ok) { setRosterPreview(null); setMessage(result.error?.message || 'Không đọc được danh sách phân ban.'); return; }
    setRosterPreview(result.data);
  };

  const scheduleRoster = async () => {
    if (!selectedUnit?.chapterId || !rosterPreview?.valid || !effectiveAt) return;
    setBusy(true);
    const result = await apiFetch(`/api/v1/chapters/${selectedUnit.chapterId}/reorganizations`, {
      method: 'POST', noCache: true, body: JSON.stringify({
        sourceUrl: rosterUrl, effectiveAt: new Date(effectiveAt).toISOString(),
        items: rosterPreview.items.map((item: any) => ({ userId: item.userId, displayName: item.displayName, departmentUnitId: item.departmentUnitId, positionId: item.positionId, isPrimary: item.isLead })),
      }),
    });
    setBusy(false);
    if (!result.ok) { setMessage(result.error?.message || 'Không thể lên lịch phân ban.'); return; }
    setMessage('Đã lên lịch đổi Ban, LT và tên hiển thị. Hệ thống sẽ áp dụng đúng ngày hiệu lực.');
    setRosterPreview(null); setRosterUrl(''); setEffectiveAt('');
  };

  if (loading && !units.length) return <div className="text-sm text-[#737686]">Đang tải phạm vi quản lý…</div>;
  if (!units.length) return <Card className="p-8"><h1 className="text-2xl font-bold text-[#172554]">Chưa có phạm vi quản lý</h1><p className="mt-2 text-sm text-[#737686]">Admin cần bổ nhiệm bạn vào DNA, Chapter hoặc Ban và gán quyền xem tiến trình.</p></Card>;

  return <div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">Organization workspace</p>
        <h1 className="mt-1 text-3xl font-bold text-[#172554]">Quản lý học tập theo tổ chức</h1>
        <p className="mt-1 text-sm text-[#737686]">Phạm vi được quyết định bởi nhiệm kỳ và permission đang hiệu lực, không dựa vào role hiển thị.</p>
      </div>
      <select value={unitId} onChange={(event) => { setUnitId(event.target.value); setPage(1); }} className="min-w-64 rounded-xl border border-[#cbdbf5] bg-white px-3 py-2.5 text-sm font-semibold text-[#172554]">
        {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.type} · {unit.name}</option>)}
      </select>
    </header>

    {message && <div role="status" className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">{message}</div>}

    {canManage && selectedUnit?.type === 'CHAPTER' && selectedUnit.chapterId && <Card id="term-transition" className="space-y-4 border border-[#eff4ff] scroll-mt-8">
      <div><h2 className="font-bold text-[#172554]">Phân Ban cuối nhiệm kỳ từ Google Sheet</h2><p className="mt-1 text-xs text-[#737686]">Tên cột phải trùng tên Ban. Mỗi ô dùng “Họ tên (email)”; người đầu tiên trong cột được gán LT. Hệ thống đối chiếu bằng email trước khi cho xác nhận.</p></div>
      <form onSubmit={previewRoster} className="grid gap-3 md:grid-cols-[1fr_auto]"><input required value={rosterUrl} onChange={(event) => setRosterUrl(event.target.value)} placeholder="Dán link Google Sheet danh sách cuối nhiệm kỳ" className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"/><Button type="submit" loading={busy}>Đọc và kiểm tra</Button></form>
      {rosterPreview && <div className="space-y-3">
        <div className={`rounded-xl px-4 py-3 text-sm ${rosterPreview.valid ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>{rosterPreview.valid ? `Hợp lệ: ${rosterPreview.summary.members} thành viên, ${rosterPreview.summary.leads} LT.` : `Cần sửa ${rosterPreview.errors.length} lỗi trước khi xác nhận.`}</div>
        {rosterPreview.errors?.length > 0 && <details className="rounded-xl border border-red-100 p-3"><summary className="cursor-pointer text-sm font-semibold text-red-700">Xem lỗi đối chiếu</summary><ul className="mt-2 space-y-1 text-xs text-red-700">{rosterPreview.errors.map((error: any, index: number) => <li key={index}>Dòng {error.row}, {error.column}: {error.message} ({error.value})</li>)}</ul></details>}
        <details className="rounded-xl border border-[#eff4ff] p-3" open><summary className="cursor-pointer text-sm font-semibold text-[#172554]">Xem trước theo Ban</summary><div className="mt-3 max-h-72 overflow-auto divide-y">{rosterPreview.items.map((item: any, index: number) => <div key={index} className="flex justify-between gap-3 py-2 text-xs"><span><b>{item.displayName}</b> · {item.email}</span><span>{item.departmentName}{item.isLead ? ' · LT' : ''}</span></div>)}</div></details>
        <div className="flex flex-wrap items-end gap-3"><label className="text-xs font-semibold text-[#172554]">Ngày hiệu lực<input required type="datetime-local" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} className="mt-1 block rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"/></label><Button type="button" disabled={!rosterPreview.valid || !effectiveAt || busy} onClick={() => void scheduleRoster()}>Xác nhận và lên lịch</Button></div>
      </div>}
    </Card>}

    {canManage && profile?.role !== 'ADMIN' && <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 border border-[#eff4ff]">
        <div><h2 className="font-bold text-[#172554]">Thêm tài khoản đã có</h2><p className="text-xs text-[#737686]">Chỉ thêm tài khoản đang hoạt động; tài khoản bị khóa phải do Admin mở lại.</p></div>
        <form className="flex gap-2" onSubmit={addExistingMember}><input required type="email" value={addEmail} onChange={(event) => setAddEmail(event.target.value)} placeholder="email@domain.com" className="min-w-0 flex-1 rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm" /><Button type="submit" loading={busy}>Thêm</Button></form>
      </Card>
      <Card className="space-y-3 border border-[#eff4ff]">
        <div><h2 className="font-bold text-[#172554]">Mời thành viên mới</h2><p className="text-xs text-[#737686]">Lời mời được gắn vào đúng DNA/Chapter/Ban; khi chấp nhận sẽ tạo membership và đồng bộ learning rules.</p></div>
        <form className="flex gap-2" onSubmit={inviteMember}><input required type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="email@domain.com" className="min-w-0 flex-1 rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm" /><Button type="submit" loading={busy}>Gửi lời mời</Button></form>
      </Card>
    </div>}

    <Card className="border border-[#eff4ff] p-0">
      <div className="flex flex-col gap-3 border-b border-[#eff4ff] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-bold text-[#172554]">{selectedUnit?.name} · Thành viên</h2><p className="text-xs text-[#737686]">{pagination.total} thành viên trong phạm vi được cấp quyền</p></div>
        <form onSubmit={submitSearch} className="flex gap-2"><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Tìm theo email" className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm" /><Button type="submit" variant="outline">Tìm</Button></form>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-[#f8f9ff] text-xs text-[#737686]"><tr><th className="px-5 py-3">Thành viên</th><th className="px-5 py-3">Tiến độ học</th><th className="px-5 py-3">Star</th><th className="px-5 py-3">Tham gia</th><th className="px-5 py-3">Thao tác</th></tr></thead>
          <tbody className="divide-y divide-[#eff4ff]">
            {loading ? <tr><td colSpan={5} className="px-5 py-8 text-center text-[#737686]">Đang tải…</td></tr>
              : members.length ? members.map((member) => <tr key={member.userId}>
                <td className="px-5 py-3"><p className="font-semibold text-[#172554]">{member.displayName || member.email}</p><p className="text-xs text-[#737686]">{member.email}</p><div className="mt-1 flex flex-wrap gap-1 text-[11px]"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{member.status}</span>{member.department && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">Ban: {member.department.name}</span>}{member.positions?.map((position: any) => <span key={`${position.code}-${position.unitName}`} className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">{position.name}</span>)}{member.dna?.active && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">DNA{member.dna.group ? ` · ${member.dna.group}` : ''}</span>}</div></td>
                <td className="px-5 py-3"><p className="font-semibold text-[#172554]">{member.progressPercent}%</p><p className="text-xs text-[#737686]">{member.completedCourses}/{member.totalCourses} khóa · {member.completedLessons}/{member.totalLessons} bài</p></td>
                <td className="px-5 py-3 font-bold text-amber-600">⭐ {member.stars}</td>
                <td className="px-5 py-3 text-xs text-[#596174]">{new Date(member.joinedAt).toLocaleDateString('vi-VN')}</td>
                <td className="px-5 py-3"><div className="flex gap-2"><Link className="rounded-lg border border-[#cbdbf5] px-3 py-1.5 text-xs font-semibold text-blue-700" href={`/organization-manager/units/${unitId}/members/${member.userId}`}>Chi tiết</Link>{canManage && <button type="button" disabled={busy} onClick={() => void removeMember(member)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50">Kết thúc</button>}</div></td>
              </tr>)
              : <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-[#737686]">Chưa có thành viên phù hợp.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-[#eff4ff] px-5 py-3 text-xs text-[#737686]"><span>Trang {pagination.page}/{Math.max(1, pagination.totalPages)}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Trước</Button><Button size="sm" variant="outline" disabled={!pagination.totalPages || page >= pagination.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Sau</Button></div></div>
    </Card>

    {canManage && <Card className="border border-[#eff4ff] p-0">
      <div className="border-b border-[#eff4ff] px-5 py-4"><h2 className="font-bold text-[#172554]">Lời mời trong phạm vi</h2><p className="text-xs text-[#737686]">Lời mời Chapter cũ vẫn hiển thị theo Chapter; lời mời DNA/Ban được lọc đúng Organization Unit.</p></div>
      <div className="divide-y divide-[#eff4ff]">{invitations.length ? invitations.map((invitation) => <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"><div><p className="font-semibold text-[#172554]">{invitation.email}</p><p className="text-xs text-[#737686]">{invitation.status} · hết hạn {new Date(invitation.expiresAt).toLocaleDateString('vi-VN')}</p></div>{invitation.status !== 'ACCEPTED' && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void invitationAction(invitation, 'resend')}>Gửi lại</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void invitationAction(invitation, 'cancel')}>Hủy</Button></div>}</div>) : <p className="px-5 py-5 text-sm text-[#737686]">Không có lời mời trong phạm vi này.</p>}</div>
    </Card>}
  </div>;
}
