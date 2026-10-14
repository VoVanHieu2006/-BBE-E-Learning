'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import { apiFetch } from '@/lib/api/client';
import { orderOrganizationTree, organizationParentTypeMatches, organizationSubtreeIds } from '@/lib/organization-scope';

export default function AdminOrganizationPage() {
  const [data, setData] = useState<any>({ units: [], positions: [], permissions: [] });
  const [unitParentById, setUnitParentById] = useState<Record<string, string>>({});
  const [rules, setRules] = useState<any[]>([]);
  const [memberships, setMemberships] = useState<any[]>([]);
  const [positionAssignments, setPositionAssignments] = useState<any[]>([]);
  const [membershipPage, setMembershipPage] = useState(1);
  const [assignmentPage, setAssignmentPage] = useState(1);
  const [membershipPagination, setMembershipPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [assignmentPagination, setAssignmentPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [membershipFilter, setMembershipFilter] = useState({ search: '', unitId: '', status: 'ALL' });
  const [membershipFilterDraft, setMembershipFilterDraft] = useState({ search: '', unitId: '', status: 'ALL' });
  const [assignmentFilter, setAssignmentFilter] = useState({ search: '', unitId: '', positionId: '', status: 'ALL' });
  const [assignmentFilterDraft, setAssignmentFilterDraft] = useState({ search: '', unitId: '', positionId: '', status: 'ALL' });
  const [rulePage, setRulePage] = useState(1);
  const [rulePagination, setRulePagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [ruleSearch, setRuleSearch] = useState('');
  const [ruleSearchDraft, setRuleSearchDraft] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [userSearchDraft, setUserSearchDraft] = useState('');
  const [courses, setCourses] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);
  const [recentKpis, setRecentKpis] = useState<any[]>([]);
  const [restrictionHistory, setRestrictionHistory] = useState<any[]>([]);
  const [restrictionTotal, setRestrictionTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [unitForm, setUnitForm] = useState({ name: '', type: 'DNA', parentId: '' });
  const [positionForm, setPositionForm] = useState({ code: '', name: '', scope: 'CHAPTER', isManager: true });
  const [ruleForm, setRuleForm] = useState({ courseId: '', organizationUnitId: '', positionId: '', dueDays: '30', canAssess: true, canEarnStars: true });
  const [membershipForm, setMembershipForm] = useState({ userId: '', unitId: '', startsAt: '' });
  const [appointmentForm, setAppointmentForm] = useState({ userId: '', positionId: '', unitId: '', startsAt: '', endsAt: '', isPrimary: false });
  const [grantForm, setGrantForm] = useState({ positionId: '', permissionId: '' });
  const [restrictionForm, setRestrictionForm] = useState({ targetType: 'USER', targetId: '', action: 'LOCK', reason: '' });
  const [kpiForm, setKpiForm] = useState({ chapterId: '', month: new Date().toISOString().slice(0, 7), status: 'YELLOW', note: '' });
  const notify = (type: 'success' | 'error' | 'info', message: string) => setToast({ type, message });

  const load = useCallback(async () => {
    setLoading(true);
    const orgParams = new URLSearchParams({
      membershipPage: String(membershipPage), membershipLimit: '20', membershipSearch: membershipFilter.search,
      membershipUnitId: membershipFilter.unitId, membershipStatus: membershipFilter.status,
      assignmentPage: String(assignmentPage), assignmentLimit: '20', assignmentSearch: assignmentFilter.search,
      assignmentUnitId: assignmentFilter.unitId, assignmentPositionId: assignmentFilter.positionId,
      assignmentStatus: assignmentFilter.status,
    });
    const ruleParams = new URLSearchParams({ page: String(rulePage), limit: '20', search: ruleSearch });
    const [org, learningRules, courseList, userList, chapterList, restrictionList] = await Promise.all([
      apiFetch(`/api/v1/admin/organization?${orgParams.toString()}`, { noCache: true }),
      apiFetch(`/api/v1/admin/learning-rules?${ruleParams.toString()}`, { noCache: true }),
      apiFetch('/api/v1/courses?limit=100', { noCache: true }),
      apiFetch(`/api/v1/users?page=1&limit=100&search=${encodeURIComponent(userSearch)}`, { noCache: true }),
      apiFetch('/api/v1/chapters', { noCache: true }),
      apiFetch('/api/v1/admin/restrictions?limit=50', { noCache: true }),
    ]);
    if (org.ok && org.data) {
      setData(org.data);
      setUnitParentById(Object.fromEntries((org.data.units || []).map((unit: any) => [unit.id, unit.parent_id || ''])));
      setMemberships(org.data.memberships || []);
      setPositionAssignments(org.data.positionAssignments || []);
      setRecentKpis(org.data.recentKpis || []);
      if (org.data.membershipPagination) setMembershipPagination(org.data.membershipPagination);
      if (org.data.assignmentPagination) setAssignmentPagination(org.data.assignmentPagination);
    }
    if (learningRules.ok && learningRules.data) {
      setRules(learningRules.data.items || []);
      if (learningRules.data.pagination) setRulePagination(learningRules.data.pagination);
    }
    if (courseList.ok && courseList.data) setCourses(courseList.data.items || []);
    if (userList.ok && userList.data) setUsers(userList.data.items || []);
    if (chapterList.ok && chapterList.data) setChapters(chapterList.data.items || []);
    if (restrictionList.ok && restrictionList.data) {
      setRestrictionHistory(restrictionList.data.items || []);
      setRestrictionTotal(restrictionList.data.total || 0);
    }
    setLoading(false);
  }, [membershipPage, membershipFilter, assignmentPage, assignmentFilter, rulePage, ruleSearch, userSearch]);
  useEffect(() => { void load(); }, [load]);

  const orgAction = async (body: any) => {
    setSaving(true);
    const result = await apiFetch('/api/v1/admin/organization', { method: 'POST', body: JSON.stringify(body), noCache: true });
    setSaving(false);
    if (!result.ok) { notify('error', result.error?.message || 'Không thể lưu thay đổi.'); return false; }
    await load(); return true;
  };
  const createUnit = async (event: FormEvent) => {
    event.preventDefault();
    if (await orgAction({ action: 'CREATE_UNIT', name: unitForm.name, type: unitForm.type, parentId: unitForm.parentId || null })) { setUnitForm({ name: '', type: 'DNA', parentId: '' }); notify('success', 'Đã tạo đơn vị tổ chức.'); }
  };
  const createPosition = async (event: FormEvent) => {
    event.preventDefault();
    if (await orgAction({ action: 'CREATE_POSITION', ...positionForm })) { setPositionForm({ code: '', name: '', scope: 'CHAPTER', isManager: true }); notify('success', 'Đã tạo chức vụ.'); }
  };
  const moveUnit = async (unit: any) => {
    const nextParentId = unitParentById[unit.id] || null;
    if (nextParentId === (unit.parent_id || null)) return;
    if (!window.confirm(`Chuyển “${unit.name}” sang đơn vị cha mới? Thành viên thuộc nhánh này sẽ được đồng bộ lại lộ trình học.`)) return;
    if (await orgAction({ action: 'MOVE_UNIT', unitId: unit.id, parentId: nextParentId })) {
      notify('success', 'Đã cập nhật cây tổ chức và đồng bộ lộ trình học cho thành viên bị ảnh hưởng.');
    }
  };
  const createRule = async (event: FormEvent) => {
    event.preventDefault();
    if (!ruleForm.organizationUnitId && !ruleForm.positionId && !window.confirm('This rule has no organization or position scope and can apply to every eligible active account. Continue?')) return;
    setSaving(true);
    const result = await apiFetch('/api/v1/admin/learning-rules', { method: 'POST', noCache: true, body: JSON.stringify({ courseId: ruleForm.courseId, organizationUnitId: ruleForm.organizationUnitId || null, positionId: ruleForm.positionId || null, dueDays: ruleForm.dueDays ? Number(ruleForm.dueDays) : null, canAssess: ruleForm.canAssess, canEarnStars: ruleForm.canAssess && ruleForm.canEarnStars }) });
    setSaving(false);
    if (!result.ok) { notify('error', result.error?.message || 'Không thể tạo learning rule.'); return; }
    notify('success', 'Đã tạo rule. Hãy bấm gán để materialize.'); await load();
  };
  const materialize = async (ruleId: string) => {
    const targetRule = rules.find((rule) => rule.id === ruleId);
    const target = [targetRule?.organization_unit?.name, targetRule?.position?.name].filter(Boolean).join(' / ') || 'all eligible users';
    if (!window.confirm(`Create missing learning assignments for ${target}? This can affect many accounts and apply the configured deadline.`)) return;
    setSaving(true);
    const result = await apiFetch(`/api/v1/admin/learning-rules/${ruleId}/materialize`, { method: 'POST', body: JSON.stringify({}), noCache: true });
    setSaving(false);
    if (!result.ok) { notify('error', result.error?.message || 'Không thể gán rule.'); return; }
    notify('success', `Đã tạo ${result.data?.createdAssignments || 0} assignment.`);
  };
  const deactivateRule = async (ruleId: string) => {
    if (!window.confirm('Ngừng rule này? Assignment chưa hoàn thành sẽ kết thúc sau khi đồng bộ; lịch sử hoàn thành được giữ nguyên.')) return;
    setSaving(true);
    const result = await apiFetch(`/api/v1/admin/learning-rules/${ruleId}`, { method: 'PATCH', body: JSON.stringify({ action: 'DEACTIVATE' }), noCache: true });
    setSaving(false);
    if (!result.ok) { notify('error', result.error?.message || 'Không thể ngừng learning rule.'); return; }
    notify('success', `Đã ngừng rule; kết thúc ${result.data?.endedAssignments || 0} assignment đang hoạt động.`);
    await load();
  };
  const addMembership = async (event: FormEvent) => {
    event.preventDefault();
    if (await orgAction({ action: 'ADD_MEMBERSHIP', userId: membershipForm.userId, unitId: membershipForm.unitId, startsAt: membershipForm.startsAt || null })) {
      setMembershipForm({ userId: '', unitId: '', startsAt: '' });
      notify('success', 'Đã thêm thành viên vào đơn vị và đồng bộ lộ trình học.');
    }
  };
  const endMembership = async (membershipId: string) => {
    if (!window.confirm('Kết thúc tư cách thành viên tại đơn vị này? Lịch sử sẽ được lưu và lộ trình học sẽ được đồng bộ.')) return;
    if (await orgAction({ action: 'END_MEMBERSHIP', membershipId })) notify('success', 'Đã kết thúc membership và đồng bộ lại lộ trình học.');
  };
  const endPositionAssignment = async (assignmentId: string) => {
    if (!window.confirm('Kết thúc nhiệm kỳ này? Lịch sử sẽ được giữ lại và learning assignment sẽ được đồng bộ lại.')) return;
    if (await orgAction({ action: 'END_POSITION', assignmentId })) notify('success', 'Đã kết thúc nhiệm kỳ và đồng bộ lại learning assignment.');
  };
  const appointPosition = async (event: FormEvent) => {
    event.preventDefault();
    if (await orgAction({ action: 'APPOINT_POSITION', userId: appointmentForm.userId, positionId: appointmentForm.positionId, unitId: appointmentForm.unitId, startsAt: appointmentForm.startsAt || null, endsAt: appointmentForm.endsAt || null, isPrimary: appointmentForm.isPrimary })) {
      setAppointmentForm({ userId: '', positionId: '', unitId: '', startsAt: '', endsAt: '', isPrimary: false });
      notify('success', 'Đã bổ nhiệm chức vụ và đồng bộ lộ trình học.');
    }
  };
  const grantPermission = async (event: FormEvent) => {
    event.preventDefault();
    if (await orgAction({ action: 'GRANT_PERMISSION', positionId: grantForm.positionId, permissionId: grantForm.permissionId })) {
      setGrantForm({ positionId: '', permissionId: '' });
      notify('success', 'Đã cấp quyền cho chức vụ.');
    }
  };
  const revokePermission = async (positionId: string, permissionId: string) => {
    if (!window.confirm('Thu hồi quyền này khỏi chức vụ? Các nhiệm kỳ đang giữ chức vụ sẽ mất quyền ngay.')) return;
    if (await orgAction({ action: 'REVOKE_PERMISSION', positionId, permissionId })) notify('success', 'Đã thu hồi quyền và ghi audit.');
  };
  const changeRestriction = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const result = await apiFetch('/api/v1/admin/restrictions', { method: 'POST', noCache: true, body: JSON.stringify(restrictionForm) });
    setSaving(false);
    if (!result.ok) { notify('error', result.error?.message || 'Không thể thay đổi trạng thái khóa.'); return; }
    setRestrictionForm({ targetType: 'USER', targetId: '', action: 'LOCK', reason: '' });
    notify('success', restrictionForm.action === 'LOCK' ? 'Đã khóa và ghi nhận lý do.' : 'Đã gỡ restriction hợp lệ.');
    const history = await apiFetch('/api/v1/admin/restrictions?limit=50', { noCache: true });
    if (history.ok) {
      setRestrictionHistory(history.data?.items || []);
      setRestrictionTotal(history.data?.total || 0);
    }
  };
  const saveKpi = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const result = await apiFetch(`/api/v1/chapters/${kpiForm.chapterId}/kpi`, { method: 'PUT', noCache: true, body: JSON.stringify({ month: kpiForm.month, status: kpiForm.status, note: kpiForm.note }) });
    setSaving(false);
    if (!result.ok) { notify('error', result.error?.message || 'Không thể cập nhật KPI.'); return; }
    notify('success', 'Đã cập nhật KPI Chapter cho tháng đã chọn.');
  };
  if (loading) return <div className="text-sm text-[#737686]">Đang tải cấu hình tổ chức…</div>;
  const applyMembershipFilters = (event: FormEvent) => {
    event.preventDefault();
    setMembershipPage(1);
    setMembershipFilter({ ...membershipFilterDraft });
  };
  const applyAssignmentFilters = (event: FormEvent) => {
    event.preventDefault();
    setAssignmentPage(1);
    setAssignmentFilter({ ...assignmentFilterDraft });
  };
  const applyRuleSearch = (event: FormEvent) => {
    event.preventDefault();
    setRulePage(1);
    setRuleSearch(ruleSearchDraft.trim());
  };
  const applyUserSearch = (event: FormEvent) => {
    event.preventDefault();
    setUserSearch(userSearchDraft.trim());
  };
  const unitNodes = (data.units || []).map((unit: any) => ({ id: unit.id, parentId: unit.parent_id || null, type: unit.type }));
  const unitTreeRows = orderOrganizationTree((data.units || []).map((unit: any) => ({ ...unit, parentId: unit.parent_id || null })));
  return <div className="max-w-7xl space-y-7">
    <div><h1 className="text-3xl font-bold text-[#172554]">Cơ cấu tổ chức và chức vụ</h1><p className="mt-1 text-sm text-[#737686]">Tạo DNA, Chapter, Ban; quản lý membership, nhiệm kỳ và quyền theo vị trí.</p></div>
    <nav className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <a href="#structure" className="rounded-2xl border border-blue-100 bg-blue-50 p-4"><b className="text-[#172554]">1. Cơ cấu</b><p className="mt-1 text-xs text-[#737686]">Đơn vị, cây tổ chức và chức vụ</p></a>
      <a href="/admin/users" className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4"><b className="text-[#172554]">2. Thành viên</b><p className="mt-1 text-xs text-[#737686]">Tài khoản và tiến độ chi tiết</p></a>
      <a href="/admin/courses" className="rounded-2xl border border-violet-100 bg-violet-50 p-4"><b className="text-[#172554]">3. Khóa học</b><p className="mt-1 text-xs text-[#737686]">Nội dung, ảnh bìa và bài kiểm tra</p></a>
      <a href="#governance" className="rounded-2xl border border-amber-100 bg-amber-50 p-4"><b className="text-[#172554]">4. Vận hành</b><p className="mt-1 text-xs text-[#737686]">KPI và khóa tài khoản</p></a>
    </nav>
    <Card className="grid gap-4 border border-[#eff4ff] p-4 xl:grid-cols-4">
      <form className="space-y-2" onSubmit={applyMembershipFilters}>
        <h2 className="text-sm font-bold text-[#172554]">Tìm membership</h2>
        <input value={membershipFilterDraft.search} onChange={(event) => setMembershipFilterDraft({ ...membershipFilterDraft, search: event.target.value })} placeholder="Email hoặc đơn vị" className="w-full rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm" />
        <select value={membershipFilterDraft.unitId} onChange={(event) => setMembershipFilterDraft({ ...membershipFilterDraft, unitId: event.target.value })} className="w-full rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="">Mọi đơn vị</option>{data.units.map((unit: any) => <option key={unit.id} value={unit.id}>{unit.type} · {unit.name}</option>)}</select>
        <div className="flex gap-2"><select value={membershipFilterDraft.status} onChange={(event) => setMembershipFilterDraft({ ...membershipFilterDraft, status: event.target.value })} className="min-w-0 flex-1 rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="ALL">Mọi trạng thái</option><option value="ACTIVE">Đang hoạt động</option><option value="ENDED">Đã kết thúc</option></select><Button type="submit" size="sm">Tìm</Button></div>
        <div className="flex items-center justify-between text-[11px] text-[#737686]"><span>{membershipPagination.total} kết quả · trang {membershipPagination.page}/{Math.max(1, membershipPagination.totalPages)}</span><div className="flex gap-1"><button type="button" disabled={membershipPage <= 1} onClick={() => setMembershipPage((page) => Math.max(1, page - 1))} className="rounded border px-2 py-1 disabled:opacity-40">‹</button><button type="button" disabled={!membershipPagination.totalPages || membershipPage >= membershipPagination.totalPages} onClick={() => setMembershipPage((page) => page + 1)} className="rounded border px-2 py-1 disabled:opacity-40">›</button></div></div>
      </form>
      <form className="space-y-2" onSubmit={applyAssignmentFilters}>
        <h2 className="text-sm font-bold text-[#172554]">Tìm nhiệm kỳ chức vụ</h2>
        <input value={assignmentFilterDraft.search} onChange={(event) => setAssignmentFilterDraft({ ...assignmentFilterDraft, search: event.target.value })} placeholder="Email, chức vụ hoặc đơn vị" className="w-full rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm" />
        <select value={assignmentFilterDraft.unitId} onChange={(event) => setAssignmentFilterDraft({ ...assignmentFilterDraft, unitId: event.target.value })} className="w-full rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="">Mọi đơn vị</option>{data.units.map((unit: any) => <option key={unit.id} value={unit.id}>{unit.type} · {unit.name}</option>)}</select>
        <div className="flex gap-2"><select value={assignmentFilterDraft.positionId} onChange={(event) => setAssignmentFilterDraft({ ...assignmentFilterDraft, positionId: event.target.value })} className="min-w-0 flex-1 rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="">Mọi chức vụ</option>{data.positions.map((position: any) => <option key={position.id} value={position.id}>{position.code} · {position.name}</option>)}</select><select value={assignmentFilterDraft.status} onChange={(event) => setAssignmentFilterDraft({ ...assignmentFilterDraft, status: event.target.value })} className="min-w-0 flex-1 rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="ALL">Mọi trạng thái</option><option value="ACTIVE">Đang giữ</option><option value="SCHEDULED">Đã lên lịch</option><option value="ENDED">Đã kết thúc</option></select><Button type="submit" size="sm">Tìm</Button></div>
        <div className="flex items-center justify-between text-[11px] text-[#737686]"><span>{assignmentPagination.total} kết quả · trang {assignmentPagination.page}/{Math.max(1, assignmentPagination.totalPages)}</span><div className="flex gap-1"><button type="button" disabled={assignmentPage <= 1} onClick={() => setAssignmentPage((page) => Math.max(1, page - 1))} className="rounded border px-2 py-1 disabled:opacity-40">‹</button><button type="button" disabled={!assignmentPagination.totalPages || assignmentPage >= assignmentPagination.totalPages} onClick={() => setAssignmentPage((page) => page + 1)} className="rounded border px-2 py-1 disabled:opacity-40">›</button></div></div>
      </form>
      <form className="space-y-2" onSubmit={applyRuleSearch}>
        <h2 className="text-sm font-bold text-[#172554]">Tìm learning rule</h2>
        <input value={ruleSearchDraft} onChange={(event) => setRuleSearchDraft(event.target.value)} placeholder="Khóa học, đơn vị hoặc chức vụ" className="w-full rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm" />
        <Button type="submit" size="sm">Tìm rule</Button>
        <div className="flex items-center justify-between text-[11px] text-[#737686]"><span>{rulePagination.total} kết quả · trang {rulePagination.page}/{Math.max(1, rulePagination.totalPages)}</span><div className="flex gap-1"><button type="button" disabled={rulePage <= 1} onClick={() => setRulePage((page) => Math.max(1, page - 1))} className="rounded border px-2 py-1 disabled:opacity-40">‹</button><button type="button" disabled={!rulePagination.totalPages || rulePage >= rulePagination.totalPages} onClick={() => setRulePage((page) => page + 1)} className="rounded border px-2 py-1 disabled:opacity-40">›</button></div></div>
      </form>
      <form className="space-y-2" onSubmit={applyUserSearch}>
        <h2 className="text-sm font-bold text-[#172554]">Tìm người để gán</h2>
        <input value={userSearchDraft} onChange={(event) => setUserSearchDraft(event.target.value)} placeholder="Email người dùng" className="w-full rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm" />
        <Button type="submit" size="sm">Tìm người dùng</Button>
        <p className="text-[11px] text-[#737686]">Danh sách gán bên dưới hiển thị tối đa 100 kết quả phù hợp.</p>
      </form>
    </Card>
    <div id="structure" className="grid scroll-mt-6 gap-6 lg:grid-cols-2">
      <Card className="space-y-4 border border-[#eff4ff]"><h2 className="font-bold text-[#172554]">Tạo đơn vị tổ chức</h2><form className="grid gap-3 sm:grid-cols-2" onSubmit={createUnit}><input required value={unitForm.name} onChange={(e) => setUnitForm({ ...unitForm, name: e.target.value })} placeholder="Tên DNA / nhóm DNA / Chapter / Ban" className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm" /><select value={unitForm.type} onChange={(e) => setUnitForm({ ...unitForm, type: e.target.value, parentId: '' })} className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="DNA">DNA</option><option value="DNA_GROUP">Nhóm DNA</option><option value="CHAPTER">Chapter</option><option value="DEPARTMENT">Ban</option><option value="ROOT">Root</option></select><select required={unitForm.type === 'DEPARTMENT' || unitForm.type === 'DNA_GROUP'} value={unitForm.parentId} onChange={(e) => setUnitForm({ ...unitForm, parentId: e.target.value })} className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm sm:col-span-2"><option value="">Không có đơn vị cha</option>{data.units.filter((unit: any) => organizationParentTypeMatches(unitForm.type, unit.type)).map((unit: any) => <option key={unit.id} value={unit.id}>{unit.type} · {unit.name}</option>)}</select><p className="text-xs text-[#737686] sm:col-span-2">DNA và Chapter thuộc Root; TT, LDC, SGDC thuộc DNA; Ban thuộc Chapter.</p><Button type="submit" loading={saving} className="sm:col-span-2">Tạo đơn vị</Button></form></Card>
      <Card className="space-y-4 border border-[#eff4ff]"><h2 className="font-bold text-[#172554]">Tạo chức vụ</h2><form className="grid gap-3 sm:grid-cols-2" onSubmit={createPosition}><input required value={positionForm.code} onChange={(e) => setPositionForm({ ...positionForm, code: e.target.value })} placeholder="Mã, ví dụ LT" className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm" /><input required value={positionForm.name} onChange={(e) => setPositionForm({ ...positionForm, name: e.target.value })} placeholder="Tên chức vụ" className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm" /><select value={positionForm.scope} onChange={(e) => setPositionForm({ ...positionForm, scope: e.target.value })} className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="PLATFORM">Platform</option><option value="DNA">DNA</option><option value="CHAPTER">Chapter</option><option value="DEPARTMENT">Department</option></select><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={positionForm.isManager} onChange={(e) => setPositionForm({ ...positionForm, isManager: e.target.checked })} /> Quản lý</label><Button type="submit" loading={saving} className="sm:col-span-2">Tạo chức vụ</Button></form></Card>
    </div>
    <Card className="overflow-hidden border border-[#eff4ff] p-0">
      <div className="border-b border-[#eff4ff] px-5 py-4"><h2 className="font-bold text-[#172554]">Cây tổ chức</h2><p className="mt-1 text-xs text-[#737686]">Đổi đơn vị cha sẽ áp dụng cho toàn bộ nhánh con; vòng lặp bị từ chối và lộ trình học của thành viên bị ảnh hưởng sẽ được tính lại.</p></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-[#f8f9ff] text-xs text-[#737686]"><tr><th className="px-4 py-3">Đơn vị</th><th className="px-4 py-3">Đơn vị cha</th><th className="px-4 py-3">Thành viên trực tiếp</th><th className="px-4 py-3">Thao tác</th></tr></thead>
        <tbody className="divide-y divide-[#eff4ff]">{data.units.length === 0 ? <tr><td colSpan={4} className="px-4 py-7 text-center text-sm text-[#737686]">Chưa có đơn vị.</td></tr> : unitTreeRows.map(({ unit, depth }: any) => {
          const subtreeIds = organizationSubtreeIds(unitNodes, unit.id);
          const parentOptions = data.units.filter((candidate: any) => !subtreeIds.has(candidate.id) && organizationParentTypeMatches(unit.type, candidate.type));
          return <tr key={unit.id}>
            <td className="px-4 py-3" style={{ paddingLeft: `${16 + depth * 18}px` }}><span className="rounded bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">{unit.type}</span><span className="ml-2 font-medium text-[#172554]">{unit.name}</span></td>
            <td className="px-4 py-3"><select required={unit.type === 'DEPARTMENT'} disabled={unit.type === 'ROOT'} value={unitParentById[unit.id] || ''} onChange={(event) => setUnitParentById((current) => ({ ...current, [unit.id]: event.target.value }))} className="w-full max-w-sm rounded-lg border border-[#cbdbf5] px-3 py-2 text-xs disabled:bg-slate-100"><option value="">Không có đơn vị cha</option>{parentOptions.map((candidate: any) => <option key={candidate.id} value={candidate.id}>{candidate.type} · {candidate.name}</option>)}</select></td>
            <td className="px-4 py-3 text-xs text-[#596174]">{unit._count?.memberships || 0}</td>
            <td className="px-4 py-3"><Button size="sm" variant="outline" disabled={saving || unit.type === 'ROOT' || (unitParentById[unit.id] || '') === (unit.parent_id || '')} onClick={() => void moveUnit(unit)}>Lưu cấu trúc</Button></td>
          </tr>;
        })}</tbody>
      </table></div>
    </Card>
    <Card className="space-y-4 border border-[#eff4ff]"><h2 className="font-bold text-[#172554]">Gán khóa học theo đơn vị/chức vụ</h2><form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={createRule}><select required value={ruleForm.courseId} onChange={(e) => setRuleForm({ ...ruleForm, courseId: e.target.value })} className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="">Chọn khóa học</option>{courses.map((course: any) => <option key={course.id || course.courseId} value={course.id || course.courseId}>{course.title}</option>)}</select><select value={ruleForm.organizationUnitId} onChange={(e) => setRuleForm({ ...ruleForm, organizationUnitId: e.target.value })} className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="">Mọi đơn vị</option>{data.units.map((unit: any) => <option key={unit.id} value={unit.id}>{unit.type} · {unit.name}</option>)}</select><select value={ruleForm.positionId} onChange={(e) => setRuleForm({ ...ruleForm, positionId: e.target.value })} className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="">Mọi chức vụ</option>{data.positions.map((position: any) => <option key={position.id} value={position.id}>{position.code} · {position.name}</option>)}</select><input type="number" min="1" value={ruleForm.dueDays} onChange={(e) => setRuleForm({ ...ruleForm, dueDays: e.target.value })} placeholder="Deadline ngày" className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ruleForm.canAssess} onChange={(e) => setRuleForm({ ...ruleForm, canAssess: e.target.checked })} /> Làm quiz</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!ruleForm.canAssess} checked={ruleForm.canEarnStars} onChange={(e) => setRuleForm({ ...ruleForm, canEarnStars: e.target.checked })} /> Nhận Star</label><Button type="submit" loading={saving} className="md:col-span-2">Tạo learning rule</Button></form></Card>
    <Card className="overflow-hidden border border-[#eff4ff]"><div className="border-b border-[#eff4ff] px-5 py-3 font-bold text-[#172554]">Learning rules hiện có</div><div className="divide-y divide-[#eff4ff]">{rules.length === 0 ? <p className="px-5 py-4 text-sm text-[#737686]">Chưa có rule.</p> : rules.map((rule) => { const active = new Date(rule.effective_from) <= new Date() && (!rule.effective_until || new Date(rule.effective_until) > new Date()); return <div key={rule.id} className="flex flex-col gap-2 px-5 py-4 text-sm md:flex-row md:items-center md:justify-between"><div><p className="font-semibold text-[#172554]">{rule.course?.title} <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] ${active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600'}`}>{active ? 'Đang áp dụng' : 'Không hoạt động'}</span></p><p className="text-xs text-[#737686]">{rule.organization_unit?.name || 'Mọi đơn vị'} · {rule.position?.name || 'Mọi chức vụ'} · {rule.due_days ? `${rule.due_days} ngày` : 'Không deadline'} · {rule.can_assess ? 'Có quiz' : 'Chỉ xem'}</p><p className="mt-1 text-[11px] text-[#737686]">Hiệu lực từ {new Date(rule.effective_from).toLocaleDateString('vi-VN')}{rule.effective_until ? ` đến ${new Date(rule.effective_until).toLocaleDateString('vi-VN')}` : ' · chưa đặt ngày kết thúc'}</p></div><div className="flex gap-2"><Button size="sm" disabled={!active || saving} onClick={() => void materialize(rule.id)}>Gán cho người học</Button>{active && <Button size="sm" variant="outline" disabled={saving} onClick={() => void deactivateRule(rule.id)}>Ngừng rule</Button>}</div></div>})}</div></Card>
    <Card className="overflow-hidden border border-[#eff4ff] p-0">
      <div className="border-b border-[#eff4ff] px-5 py-4"><h2 className="font-bold text-[#172554]">Membership hiện tại và lịch sử</h2><p className="mt-1 text-xs text-[#737686]">Kết thúc membership sẽ không xóa lịch sử; assignment theo đơn vị/chức vụ sẽ được tính lại.</p></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-[#f8f9ff] text-xs text-[#737686]"><tr><th className="px-4 py-3">Thành viên</th><th className="px-4 py-3">Đơn vị</th><th className="px-4 py-3">Hiệu lực</th><th className="px-4 py-3">Trạng thái</th><th className="px-4 py-3">Thao tác</th></tr></thead>
          <tbody className="divide-y divide-[#eff4ff]">
            {memberships.length === 0 ? <tr><td colSpan={5} className="px-4 py-7 text-center text-sm text-[#737686]">Chưa có membership.</td></tr> : memberships.map((membership) => (
              <tr key={membership.id}>
                <td className="px-4 py-3 font-medium text-[#172554]">{membership.user?.email || '—'}</td>
                <td className="px-4 py-3">{membership.unit?.type} · {membership.unit?.name}</td>
                <td className="px-4 py-3 text-xs text-[#596174]">{new Date(membership.starts_at).toLocaleDateString('vi-VN')} – {membership.ends_at ? new Date(membership.ends_at).toLocaleDateString('vi-VN') : 'Hiện tại'}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${membership.status === 'ACTIVE' && !membership.ends_at ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600'}`}>{membership.status === 'ACTIVE' && !membership.ends_at ? 'Đang hoạt động' : 'Đã kết thúc'}</span></td>
                <td className="px-4 py-3">{membership.status === 'ACTIVE' && !membership.ends_at ? <Button size="sm" variant="outline" onClick={() => void endMembership(membership.id)}>Kết thúc</Button> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
    <Card className="overflow-hidden border border-[#eff4ff] p-0">
      <div className="border-b border-[#eff4ff] px-5 py-4">
        <h2 className="font-bold text-[#172554]">Nhiệm kỳ chức vụ và lịch sử bổ nhiệm</h2>
        <p className="mt-1 text-xs text-[#737686]">Hiển thị tối đa 200 nhiệm kỳ gần nhất. Kết thúc nhiệm kỳ sẽ lưu audit và tính lại learning path.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-[#f8f9ff] text-xs text-[#737686]"><tr><th className="px-4 py-3">Người dùng</th><th className="px-4 py-3">Chức vụ</th><th className="px-4 py-3">Đơn vị</th><th className="px-4 py-3">Nhiệm kỳ</th><th className="px-4 py-3">Trạng thái</th><th className="px-4 py-3">Thao tác</th></tr></thead>
          <tbody className="divide-y divide-[#eff4ff]">
            {positionAssignments.length === 0 ? <tr><td colSpan={6} className="px-4 py-7 text-center text-sm text-[#737686]">Chưa có nhiệm kỳ chức vụ.</td></tr> : positionAssignments.map((assignment) => {
              const now = new Date();
              const startsAt = new Date(assignment.starts_at);
              const endsAt = assignment.ends_at ? new Date(assignment.ends_at) : null;
              const active = startsAt <= now && (!endsAt || endsAt > now);
              const scheduled = startsAt > now && (!endsAt || endsAt > now);
              return <tr key={assignment.id}>
                <td className="px-4 py-3 font-medium text-[#172554]">{assignment.user?.email || '—'}{assignment.is_primary && <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700">Chính</span>}</td>
                <td className="px-4 py-3">{assignment.position?.name || assignment.position?.code}</td>
                <td className="px-4 py-3">{assignment.unit?.type} · {assignment.unit?.name}</td>
                <td className="px-4 py-3 text-xs">{startsAt.toLocaleDateString('vi-VN')} – {endsAt ? endsAt.toLocaleDateString('vi-VN') : 'Chưa kết thúc'}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${active ? 'bg-green-50 text-green-700' : scheduled ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>{active ? 'Đang giữ chức vụ' : scheduled ? 'Đã lên lịch' : 'Đã kết thúc'}</span><div className="mt-1 text-[10px] text-[#737686]">{assignment.appointed_by ? 'Đã ghi nhận người bổ nhiệm' : 'Không có dữ liệu người bổ nhiệm'}</div></td>
                <td className="px-4 py-3">{active ? <Button size="sm" variant="outline" disabled={saving} onClick={() => void endPositionAssignment(assignment.id)}>Kết thúc nhiệm kỳ</Button> : '—'}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </Card>
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="space-y-4 border border-[#eff4ff]"><h2 className="font-bold text-[#172554]">Thêm người vào đơn vị</h2><form className="space-y-3" onSubmit={addMembership}><select required value={membershipForm.userId} onChange={(e) => setMembershipForm({ ...membershipForm, userId: e.target.value })} className="w-full rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="">Chọn người dùng</option>{users.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}</select><select required value={membershipForm.unitId} onChange={(e) => setMembershipForm({ ...membershipForm, unitId: e.target.value })} className="w-full rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="">Chọn đơn vị</option>{data.units.map((unit: any) => <option key={unit.id} value={unit.id}>{unit.type} · {unit.name}</option>)}</select><input type="date" value={membershipForm.startsAt} onChange={(e) => setMembershipForm({ ...membershipForm, startsAt: e.target.value })} className="w-full rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm" /><Button type="submit" loading={saving} className="w-full">Thêm thành viên</Button></form></Card>
      <Card className="space-y-4 border border-[#eff4ff]"><h2 className="font-bold text-[#172554]">Bổ nhiệm theo nhiệm kỳ</h2><form className="space-y-3" onSubmit={appointPosition}><select required value={appointmentForm.userId} onChange={(e) => setAppointmentForm({ ...appointmentForm, userId: e.target.value })} className="w-full rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="">Chọn người dùng</option>{users.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}</select><select required value={appointmentForm.positionId} onChange={(e) => setAppointmentForm({ ...appointmentForm, positionId: e.target.value })} className="w-full rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="">Chọn chức vụ</option>{data.positions.map((position: any) => <option key={position.id} value={position.id}>{position.code} · {position.name}</option>)}</select><select required value={appointmentForm.unitId} onChange={(e) => setAppointmentForm({ ...appointmentForm, unitId: e.target.value })} className="w-full rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="">Chọn đơn vị</option>{data.units.map((unit: any) => <option key={unit.id} value={unit.id}>{unit.type} · {unit.name}</option>)}</select><div className="grid grid-cols-2 gap-2"><input type="date" value={appointmentForm.startsAt} onChange={(e) => setAppointmentForm({ ...appointmentForm, startsAt: e.target.value })} className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm" /><input type="date" value={appointmentForm.endsAt} onChange={(e) => setAppointmentForm({ ...appointmentForm, endsAt: e.target.value })} className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm" /></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={appointmentForm.isPrimary} onChange={(e) => setAppointmentForm({ ...appointmentForm, isPrimary: e.target.checked })} /> Vị trí quản lý chính</label><Button type="submit" loading={saving} className="w-full">Bổ nhiệm</Button></form></Card>
      <Card className="space-y-4 border border-[#eff4ff]"><h2 className="font-bold text-[#172554]">Cấp quyền cho chức vụ</h2><form className="space-y-3" onSubmit={grantPermission}><select required value={grantForm.positionId} onChange={(e) => setGrantForm({ ...grantForm, positionId: e.target.value })} className="w-full rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="">Chọn chức vụ</option>{data.positions.map((position: any) => <option key={position.id} value={position.id}>{position.code} · {position.name}</option>)}</select><select required value={grantForm.permissionId} onChange={(e) => setGrantForm({ ...grantForm, permissionId: e.target.value })} className="w-full rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="">Chọn quyền</option>{data.permissions.map((permission: any) => <option key={permission.id} value={permission.id}>{permission.code}</option>)}</select><Button type="submit" loading={saving} className="w-full">Cấp quyền</Button></form><p className="text-xs text-[#737686]">Quyền có hiệu lực theo chức vụ, đơn vị và thời gian bổ nhiệm.</p><div className="border-t border-[#eff4ff] pt-3"><h3 className="mb-2 text-sm font-semibold text-[#172554]">Quyền đã cấp</h3><div className="max-h-72 space-y-2 overflow-y-auto">{(data.positionPermissions || []).length === 0 ? <p className="text-xs text-[#737686]">Chưa có quyền nào được gán.</p> : data.positionPermissions.map((grant: any) => <div key={`${grant.position_id}:${grant.permission_id}`} className="flex items-center justify-between gap-3 rounded-lg bg-[#f8f9ff] px-3 py-2"><div className="min-w-0"><p className="truncate text-xs font-semibold text-[#172554]">{grant.position?.code} · {grant.permission?.code}</p><p className="truncate text-[11px] text-[#737686]">{grant.position?.name} · {grant.position?.scope}</p></div><Button size="sm" variant="outline" disabled={saving} onClick={() => void revokePermission(grant.position_id, grant.permission_id)}>Thu hồi</Button></div>)}</div></div></Card>
    </div>
    <Card id="governance" className="scroll-mt-6 space-y-4 border border-[#eff4ff]">
      <div><h2 className="font-bold text-[#172554]">KPI Chapter theo tháng</h2><p className="mt-1 text-xs text-[#737686]">Đen/Đỏ: loại khỏi BXH; Vàng: đủ điều kiện không bonus; Xanh: nhận bonus KPI.</p></div>
      <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={saveKpi}>
        <select required value={kpiForm.chapterId} onChange={(e) => setKpiForm({ ...kpiForm, chapterId: e.target.value })} className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="">Chọn Chapter</option>{chapters.map((chapter) => <option key={chapter.id || chapter.chapterId} value={chapter.id || chapter.chapterId}>{chapter.name}</option>)}</select>
        <input required type="month" value={kpiForm.month} onChange={(e) => setKpiForm({ ...kpiForm, month: e.target.value })} className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm" />
        <select value={kpiForm.status} onChange={(e) => setKpiForm({ ...kpiForm, status: e.target.value })} className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="BLACK">Đen</option><option value="RED">Đỏ</option><option value="YELLOW">Vàng</option><option value="GREEN">Xanh</option></select>
        <input value={kpiForm.note} onChange={(e) => setKpiForm({ ...kpiForm, note: e.target.value })} placeholder="Ghi chú KPI" className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm" />
        <Button type="submit" loading={saving} className="md:col-span-2 xl:col-span-4">Lưu KPI</Button>
      </form>
      <div className="overflow-x-auto rounded-xl border border-[#eff4ff]">
        <table className="w-full min-w-[700px] text-left text-xs"><thead className="bg-[#f8f9ff] text-[#737686]"><tr><th className="px-3 py-2">Chapter</th><th className="px-3 py-2">Tháng</th><th className="px-3 py-2">KPI</th><th className="px-3 py-2">Ghi chú</th><th className="px-3 py-2">Cập nhật</th></tr></thead><tbody className="divide-y divide-[#eff4ff]">{recentKpis.length === 0 ? <tr><td className="px-3 py-4 text-[#737686]" colSpan={5}>Chưa có KPI được cập nhật.</td></tr> : recentKpis.map((item) => <tr key={item.id}><td className="px-3 py-2 font-semibold text-[#172554]">{item.chapterName}</td><td className="px-3 py-2">{new Date(item.month).toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric' })}</td><td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 font-semibold ${item.status === 'GREEN' ? 'bg-green-50 text-green-700' : item.status === 'YELLOW' ? 'bg-yellow-50 text-yellow-700' : item.status === 'BLACK' ? 'bg-slate-900 text-white' : 'bg-red-50 text-red-700'}`}>{item.status}</span></td><td className="px-3 py-2">{item.note || '—'}</td><td className="px-3 py-2 text-[#737686]">{item.configuredBy} · {new Date(item.updatedAt).toLocaleString('vi-VN')}</td></tr>)}</tbody></table>
      </div>
    </Card>
    <Card className="space-y-4 border border-[#eff4ff]">
      <div><h2 className="font-bold text-[#172554]">Khóa / mở khóa có audit</h2><p className="mt-1 text-xs text-[#737686]">Chỉ Admin có quyền gỡ restriction. Khóa Chapter áp dụng cho toàn bộ thành viên.</p></div>
      <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={changeRestriction}>
        <select value={restrictionForm.targetType} onChange={(e) => setRestrictionForm({ ...restrictionForm, targetType: e.target.value, targetId: '' })} className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="USER">Tài khoản</option><option value="CHAPTER">Toàn Chapter</option></select>
        <select required value={restrictionForm.targetId} onChange={(e) => setRestrictionForm({ ...restrictionForm, targetId: e.target.value })} className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="">Chọn đối tượng</option>{restrictionForm.targetType === 'USER' ? users.map((user) => <option key={user.id} value={user.id}>{user.email}</option>) : chapters.map((chapter) => <option key={chapter.id || chapter.chapterId} value={chapter.id || chapter.chapterId}>{chapter.name}</option>)}</select>
        <select value={restrictionForm.action} onChange={(e) => setRestrictionForm({ ...restrictionForm, action: e.target.value })} className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="LOCK">Khóa</option><option value="LIFT">Mở khóa</option></select>
        <input value={restrictionForm.reason} onChange={(e) => setRestrictionForm({ ...restrictionForm, reason: e.target.value })} placeholder="Lý do (bắt buộc khi khóa)" className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm" required={restrictionForm.action === 'LOCK'} />
        <Button type="submit" loading={saving} className="md:col-span-2 xl:col-span-4">Xác nhận thay đổi restriction</Button>
      </form>
    </Card>
    <Card className="overflow-hidden border border-[#eff4ff] p-0">
      <div className="border-b border-[#eff4ff] px-5 py-4"><h2 className="font-bold text-[#172554]">Lịch sử khóa tài khoản</h2><p className="mt-1 text-xs text-[#737686]">Hiển thị {restrictionHistory.length} thay đổi gần nhất · tổng {restrictionTotal} bản ghi</p></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-[#f8f9ff] text-xs text-[#737686]"><tr><th className="px-4 py-3">Đối tượng</th><th className="px-4 py-3">Nguồn</th><th className="px-4 py-3">Lý do</th><th className="px-4 py-3">Tạo bởi / lúc</th><th className="px-4 py-3">Gỡ bởi / lúc</th><th className="px-4 py-3">Tham chiếu</th></tr></thead>
          <tbody className="divide-y divide-[#eff4ff]">{restrictionHistory.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-[#737686]">Chưa có lịch sử khóa.</td></tr> : restrictionHistory.map((item) => <tr key={item.id} className="align-top"><td className="px-4 py-3 font-medium text-[#172554]">{item.user?.email || item.organization_unit?.chapter?.name || item.organization_unit?.name || 'Không xác định'}{item.lifted_at ? <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">Đã gỡ</span> : <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Đang khóa</span>}</td><td className="px-4 py-3 text-xs">{item.type}</td><td className="max-w-xs whitespace-normal px-4 py-3 text-xs">{item.reason}</td><td className="px-4 py-3 text-xs">{item.created_by?.email || 'Hệ thống'}<div className="mt-1 text-[#737686]">{new Date(item.created_at).toLocaleString('vi-VN')}</div></td><td className="px-4 py-3 text-xs">{item.lifted_by?.email || (item.lifted_at ? 'Hệ thống' : '—')}<div className="mt-1 text-[#737686]">{item.lifted_at ? new Date(item.lifted_at).toLocaleString('vi-VN') : '—'}</div></td><td className="max-w-[180px] break-all px-4 py-3 text-[10px] text-[#737686]">{item.source_reference || '—'}</td></tr>)}</tbody>
        </table>
      </div>
    </Card>
    {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
  </div>;
}
