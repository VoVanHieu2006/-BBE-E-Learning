'use client';

import { useState, useEffect, useCallback, FormEvent, useRef } from 'react';
import type { ToastMessage } from '@/components/ui/Toast';
import { apiFetch, clearApiCache, getCachedApiData } from '@/lib/api/client';
import { formatTermBadge, SAMPLE_SHEET_URL } from './term-format';

export default function useTermTransition() {
  const [user, setUser] = useState<any>(null);
  const [mounted, setMounted] = useState(false);

  // Chế độ xem: 'current' (Nhiệm kỳ hiện tại) | 'history' (Lịch sử)
  const [viewMode, setViewMode] = useState<'current' | 'history'>('current');

  // Dữ liệu sơ đồ hiện tại & Ban
  const [rosterData, setRosterData] = useState<any[]>([]);
  const [unassignedMembers, setUnassignedMembers] = useState<any[]>([]);
  const [availableDepartments, setAvailableDepartments] = useState<any[]>([]);
  const [currentTermNumber, setCurrentTermNumber] = useState<number | null>(null);
  const [selectedTermNumber, setSelectedTermNumber] = useState<number | ''>('');
  const [rosterLoading, setRosterLoading] = useState(true);

  // Đợt chuyển giao nhiệm kỳ đã lên lịch (chờ hiệu lực)
  const [scheduledBatch, setScheduledBatch] = useState<any | null>(null);
  const [applyingBatch, setApplyingBatch] = useState(false);
  const [cancelingBatch, setCancelingBatch] = useState(false);
  const [showApplyBatchModal, setShowApplyBatchModal] = useState(false);
  const [showCancelBatchModal, setShowCancelBatchModal] = useState(false);

  // Modal đổi ban cho thành viên
  const [changeDeptModal, setChangeDeptModal] = useState<{
    userId: string;
    displayName: string;
    currentDeptName?: string;
  } | null>(null);
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');
  const [makeLead, setMakeLead] = useState(false);
  const [savingDept, setSavingDept] = useState(false);
  const [actionLoading, setActionLoading] = useState<{
    type: 'appoint' | 'saveDept' | 'applyScheduled' | 'cancelScheduled';
    id?: string;
  } | null>(null);

  // Chuyển giao nhiệm kỳ từ Google Sheet
  const [rosterUrl, setRosterUrl] = useState(SAMPLE_SHEET_URL);
  const [effectiveAt, setEffectiveAt] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  });
  const [parsing, setParsing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [parsedResult, setParsedResult] = useState<any | null>(null);

  // Vô hiệu hóa
  const [showConfirmDeactivate, setShowConfirmDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivatingUserId, setDeactivatingUserId] = useState<string | null>(null);
  const [deactivateText, setDeactivateText] = useState('');
  const [singleDeactivateModal, setSingleDeactivateModal] = useState<{
    userId: string;
    displayName: string;
  } | null>(null);
  const [showBulkUnassignedModal, setShowBulkUnassignedModal] = useState(false);

  // Lịch sử nhiệm kỳ
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistoryTerm, setSelectedHistoryTerm] = useState<any | null>(null);

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const importSectionRef = useRef<HTMLDivElement>(null);

  const notify = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setToast({ type, message: text });
  };

  // Tự động kích hoạt làm mới và áp dụng khi đồng hồ đếm ngược về 0
  const handleAutoApplyScheduled = useCallback(() => {
    if (!user?.chapterId) return;
    setMessage(null);
    setToast({ type: 'info', message: 'Đã đến thời gian hiệu lực. Đang tải trạng thái xử lý chuyển giao.' });
    loadCurrentRoster(user.chapterId, true);
    setTimeout(() => {
      if (user?.chapterId) {
        loadCurrentRoster(user.chapterId, true);
      }
    }, 2500);
  }, [user?.chapterId]);

  useEffect(() => {
    setMounted(true);
    let currentUser: any = null;
    if (typeof window !== 'undefined') {
      try {
        const u = localStorage.getItem('user');
        if (u) {
          currentUser = JSON.parse(u);
          setUser(currentUser);
        }
      } catch {}
    }
    if (currentUser?.chapterId) {
      loadCurrentRoster(currentUser.chapterId);
      // Khôi phục bản nháp sheet đã import nếu có
      try {
        const savedDraft = localStorage.getItem(`bbe_term_transition_draft_${currentUser.chapterId}`);
        if (savedDraft) {
          setParsedResult(JSON.parse(savedDraft));
        }
      } catch {}
    }
  }, []);

  function applyRosterData(data: any) {
    setRosterData(data.roster || []);
    setUnassignedMembers(data.unassignedMembers || []);
    setAvailableDepartments(data.departments || []);
    setScheduledBatch(data.scheduledBatch || null);
    setCurrentTermNumber(data.currentTermNumber ?? null);
  }

  async function loadCurrentRoster(chapterId: string, force = false) {
    const url = `/api/v1/chapters/${chapterId}/current-roster`;
    if (!force) {
      const cached = getCachedApiData<any>(url);
      if (cached) {
        applyRosterData(cached);
        setRosterLoading(false);
        return;
      }
    }
    setRosterLoading(true);
    const res = await apiFetch(url, { noCache: force, tabCache: true });
    if (res.ok && res.data) {
      applyRosterData(res.data);
    }
    // Nếu force refresh, đồng bộ lại thông tin user session từ server nếu chức vụ hoặc quyền đã thay đổi
    if (force) {
      try {
        const meRes = await apiFetch('/api/v1/auth/me', { noCache: true });
        if (meRes.ok && meRes.data?.user) {
          const updated = { ...user, ...meRes.data.user };
          localStorage.setItem('user', JSON.stringify(updated));
          setUser(updated);
        }
      } catch {}
    }
    setRosterLoading(false);
  }

  // Tự động gợi ý và ràng buộc số thứ tự nhiệm kỳ tiếp theo
  useEffect(() => {
    if (currentTermNumber) {
      setSelectedTermNumber((prev) => {
        if (!prev || typeof prev !== 'number' || prev <= currentTermNumber) {
          return currentTermNumber + 1;
        }
        return prev;
      });
    } else if (selectedTermNumber === '') {
      setSelectedTermNumber(1);
    }
  }, [currentTermNumber]);

  // Xác định số nhiệm kỳ hiển thị cho Sơ đồ 7 Ban
  // Nếu chưa có currentTermNumber mà đã có scheduledBatch thì suy luận nhiệm kỳ hiện tại = scheduledBatch.termNumber - 1
  const displayTermNumber =
    currentTermNumber ??
    (scheduledBatch?.termNumber && scheduledBatch.termNumber > 1 ? scheduledBatch.termNumber - 1 : null);

  // Danh sách các lựa chọn nhiệm kỳ chuyển giao hợp lệ
  const termOptions = (() => {
    const start = currentTermNumber ? currentTermNumber + 1 : 1;
    const count = 25;
    const list: { value: number; label: string }[] = [];
    for (let i = start; i < start + count; i++) {
      list.push({
        value: i,
        label: formatTermBadge(i),
      });
    }
    return list;
  })();

  async function loadHistory(chapterId: string, force = false) {
    const url = `/api/v1/chapters/${chapterId}/reorganizations`;
    if (!force) {
      const cached = getCachedApiData<any>(url);
      if (cached) {
        setHistoryList(cached.items || []);
        setHistoryLoading(false);
        return;
      }
    }
    setHistoryLoading(true);
    const res = await apiFetch(url, { noCache: force, tabCache: true });
    if (res.ok && res.data) {
      setHistoryList(res.data.items || []);
    }
    setHistoryLoading(false);
  }

  const handleOpenHistory = () => {
    setViewMode('history');
    if (user?.chapterId) {
      loadHistory(user.chapterId);
    }
  };

  const handleOpenCurrent = () => {
    setViewMode('current');
    if (user?.chapterId) {
      loadCurrentRoster(user.chapterId);
    }
  };

  const scrollToImport = () => {
    setViewMode('current');
    importSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Đọc và phân tích sheet
  const handleParseSheet = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!user?.chapterId || !rosterUrl.trim()) return;
    setParsing(true);
    setMessage(null);

    const res = await apiFetch(`/api/v1/chapters/${user.chapterId}/reorganizations/parse-sheet`, {
      method: 'POST',
      body: JSON.stringify({ url: rosterUrl.trim() }),
    });

    setParsing(false);
    if (!res.ok) {
      notify('error', res.error?.message || 'Không thể đọc dữ liệu từ Google Sheet. Vui lòng kiểm tra quyền chia sẻ công khai.');
      return;
    }

    setParsedResult(res.data);
    if (typeof window !== 'undefined') {
      localStorage.setItem(`bbe_term_transition_draft_${user.chapterId}`, JSON.stringify(res.data));
    }
    notify(
      'success',
      `Đã phân tích thành công Google Sheet: ${res.data.summary?.matchedInChapter || 0} thành viên hợp lệ trong Chapter!`
    );
  };

  // Xóa bản nháp sheet đang xem
  const handleClearDraft = () => {
    setParsedResult(null);
    if (user?.chapterId && typeof window !== 'undefined') {
      localStorage.removeItem(`bbe_term_transition_draft_${user.chapterId}`);
    }
    notify('success', 'Đã xóa bản xem trước của Google Sheet.');
  };

  // Đổi ban cho thành viên
  const handleSaveDepartment = async () => {
    if (!user?.chapterId || !changeDeptModal?.userId) return;
    const targetUserId = changeDeptModal.userId;
    const targetDisplayName = changeDeptModal.displayName;
    const targetDeptId = selectedDeptId.trim() || null;
    const isTargetDeptPresident = availableDepartments.find((d: any) => d.id === targetDeptId)?.name === 'Chủ Tịch';
    const isAppointLead = isTargetDeptPresident ? true : makeLead;

    setSavingDept(true);
    setActionLoading({ type: 'saveDept', id: targetUserId });

    const res = await apiFetch(
      `/api/v1/chapters/${user.chapterId}/members/${targetUserId}/department`,
      {
        method: 'POST',
        body: JSON.stringify({ departmentUnitId: targetDeptId, makeLead: isAppointLead }),
      }
    );

    setSavingDept(false);
    setActionLoading(null);

    if (res.ok) {
      notify(
        'success',
        targetDeptId
          ? isAppointLead
            ? isTargetDeptPresident
              ? `Đã phân ${targetDisplayName} làm Chủ tịch Chapter thành công!`
              : `Đã chuyển ${targetDisplayName} và bổ nhiệm làm Trưởng ban thành công!`
            : `Đã chuyển ban cho ${targetDisplayName} thành công!`
          : `Đã đưa ${targetDisplayName} về danh sách Chưa phân Ban.`
      );
      setChangeDeptModal(null);
      setSelectedDeptId('');
      setMakeLead(false);

      // CẬP NHẬT GIAO DIỆN LẠC QUAN (OPTIMISTIC UI): Phản hồi ngay < 50ms không bị trễ
      if (!targetDeptId) {
        let memberEmail = '';
        setRosterData((prev) =>
          prev.map((ban) => {
            const found = ban.members.find((m: any) => m.userId === targetUserId);
            if (found) memberEmail = found.email;
            const updated = ban.members.filter((m: any) => m.userId !== targetUserId);
            return { ...ban, members: updated, total: updated.length };
          })
        );
        setUnassignedMembers((prev) => {
          if (prev.some((m) => m.userId === targetUserId)) return prev;
          return [{ userId: targetUserId, displayName: targetDisplayName, email: memberEmail, role: 'MEMBER' }, ...prev];
        });
      } else {
        let memberEmail = '';
        setUnassignedMembers((prev) => {
          const found = prev.find((m) => m.userId === targetUserId);
          if (found) memberEmail = found.email;
          return prev.filter((m) => m.userId !== targetUserId);
        });

        setRosterData((prev) => {
          let oldPresidentToUnassigned: any = null;

          // Xóa khỏi ban cũ
          const cleaned = prev.map((ban) => {
            const found = ban.members.find((m: any) => m.userId === targetUserId);
            if (found && !memberEmail) memberEmail = found.email;
            const updated = ban.members.filter((m: any) => m.userId !== targetUserId);
            return { ...ban, members: updated, total: updated.length };
          });

          // Nếu chuyển vào ban Chủ Tịch: Chủ tịch cũ tự động chuyển sang chưa phân ban
          const withPresidentHandled = cleaned.map((ban) => {
            if (ban.id === targetDeptId && isTargetDeptPresident && ban.members.length > 0) {
              oldPresidentToUnassigned = ban.members[0];
              return { ...ban, members: [], total: 0 };
            }
            return ban;
          });

          if (oldPresidentToUnassigned) {
            setUnassignedMembers((un) => [
              {
                userId: oldPresidentToUnassigned.userId,
                displayName: oldPresidentToUnassigned.displayName,
                email: oldPresidentToUnassigned.email,
                role: 'MEMBER',
              },
              ...un,
            ]);
          }

          const newMemberObj = {
            userId: targetUserId,
            displayName: targetDisplayName,
            email: memberEmail,
            role: 'MEMBER',
            isLead: isAppointLead,
          };

          return withPresidentHandled.map((ban) => {
            if (ban.id === targetDeptId) {
              const updatedMembers = ban.members.map((m: any) => ({
                ...m,
                isLead: isAppointLead ? false : m.isLead,
              }));
              updatedMembers.push(newMemberObj);
              updatedMembers.sort((a: any, b: any) => {
                if (a.isLead && !b.isLead) return -1;
                if (!a.isLead && b.isLead) return 1;
                return a.displayName.localeCompare(b.displayName, 'vi');
              });
              return { ...ban, members: updatedMembers, total: updatedMembers.length };
            }
            return ban;
          });
        });
      }

      clearApiCache('/api/v1/chapters');
      loadCurrentRoster(user.chapterId);
    } else {
      notify('error', res.error?.message || 'Lỗi cập nhật ban cho thành viên.');
    }
  };

  // Bổ nhiệm nhanh Trưởng ban
  const handleAppointLead = async (userId: string, displayName: string, deptId: string, deptName: string) => {
    if (!user?.chapterId) return;
    if (!confirm(`Bạn có chắc chắn muốn bổ nhiệm ${displayName} làm Trưởng ban của ${deptName}?`)) return;

    setSavingDept(true);
    setActionLoading({ type: 'appoint', id: userId });

    const res = await apiFetch(
      `/api/v1/chapters/${user.chapterId}/members/${userId}/department`,
      {
        method: 'POST',
        body: JSON.stringify({ departmentUnitId: deptId, makeLead: true }),
      }
    );

    setSavingDept(false);
    setActionLoading(null);

    if (res.ok) {
      notify('success', `Đã bổ nhiệm ${displayName} làm Trưởng ban ${deptName} thành công!`);

      // Cập nhật lạc quan
      setRosterData((prev) =>
        prev.map((ban) => {
          if (ban.id === deptId) {
            const updated = ban.members.map((m: any) => ({
              ...m,
              isLead: m.userId === userId,
            }));
            updated.sort((a: any, b: any) => {
              if (a.isLead && !b.isLead) return -1;
              if (!a.isLead && b.isLead) return 1;
              return a.displayName.localeCompare(b.displayName, 'vi');
            });
            return { ...ban, members: updated };
          }
          return ban;
        })
      );

      clearApiCache('/api/v1/chapters');
      loadCurrentRoster(user.chapterId);
    } else {
      notify('error', res.error?.message || 'Lỗi bổ nhiệm Trưởng ban.');
    }
  };

  // Vô hiệu hóa từng thành viên riêng lẻ (cần xác nhận gõ chữ "vô hiệu hóa")
  const handleIndividualDeactivate = async (userId: string, name?: string) => {
    if (!user?.chapterId) return;
    if (deactivateText.trim().toLowerCase() !== 'vô hiệu hóa') {
      notify('error', 'Vui lòng nhập đúng chữ "vô hiệu hóa" để xác nhận.');
      return;
    }
    setDeactivatingUserId(userId);

    const res = await apiFetch(`/api/v1/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'INACTIVE', chapterId: user.chapterId }),
    });

    setDeactivatingUserId(null);
    setSingleDeactivateModal(null);
    setDeactivateText('');

    if (!res.ok) {
      notify('error', res.error?.message || 'Không thể vô hiệu hóa thành viên.');
      return;
    }

    notify('success', `Đã vô hiệu hóa thành công tài khoản ${name || 'thành viên'}!`);

    if (parsedResult?.unmatchedCurrentMembers) {
      setParsedResult((prev: any) => ({
        ...prev,
        unmatchedCurrentMembers: prev.unmatchedCurrentMembers.filter((m: any) => m.userId !== userId),
      }));
    }

    clearApiCache('/api/v1/chapters');
    clearApiCache('/api/v1/users');
    loadCurrentRoster(user.chapterId);
  };

  // Vô hiệu hóa tất cả thành viên chưa có Ban (cần xác nhận gõ chữ "vô hiệu hóa")
  const handleBulkDeactivateUnassigned = async () => {
    if (!user?.chapterId || !unassignedMembers.length) return;
    if (deactivateText.trim().toLowerCase() !== 'vô hiệu hóa') {
      notify('error', 'Vui lòng nhập đúng chữ "vô hiệu hóa" để xác nhận.');
      return;
    }
    setDeactivating(true);

    const userIds = unassignedMembers.map((m: any) => m.userId);
    const res = await apiFetch(`/api/v1/chapters/${user.chapterId}/members/bulk-deactivate`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    });

    setDeactivating(false);
    setShowBulkUnassignedModal(false);
    setDeactivateText('');

    if (!res.ok) {
      notify('error', res.error?.message || 'Không thể vô hiệu hóa thành viên.');
      return;
    }

    notify(
      'success',
      `Đã vô hiệu hóa thành công ${userIds.length} thành viên chưa có Ban!`
    );

    clearApiCache('/api/v1/chapters');
    clearApiCache('/api/v1/users');
    loadCurrentRoster(user.chapterId);
  };

  // Vô hiệu hóa tất cả thành viên không có trong sheet (cần xác nhận gõ chữ "vô hiệu hóa")
  const handleBulkDeactivate = async () => {
    if (!user?.chapterId || !parsedResult?.unmatchedCurrentMembers?.length) return;
    if (deactivateText.trim().toLowerCase() !== 'vô hiệu hóa') {
      notify('error', 'Vui lòng nhập đúng chữ "vô hiệu hóa" để xác nhận.');
      return;
    }
    setDeactivating(true);

    const userIds = parsedResult.unmatchedCurrentMembers.map((m: any) => m.userId);
    const res = await apiFetch(`/api/v1/chapters/${user.chapterId}/members/bulk-deactivate`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    });

    setDeactivating(false);
    setShowConfirmDeactivate(false);
    setDeactivateText('');

    if (!res.ok) {
      notify('error', res.error?.message || 'Không thể vô hiệu hóa thành viên.');
      return;
    }

    notify(
      'success',
      `Đã vô hiệu hóa thành công ${userIds.length} thành viên không có trong nhiệm kỳ mới!`
    );

    setParsedResult((prev: any) => ({
      ...prev,
      unmatchedCurrentMembers: [],
    }));

    clearApiCache('/api/v1/chapters');
    clearApiCache('/api/v1/users');
    loadCurrentRoster(user.chapterId);
  };

  // Áp dụng ngay lập tức đợt chuyển giao đã lên lịch
  const transferActionRef = useRef(false);
  const handleApplyScheduledBatch = async (batchId: string) => {
    if (!user?.chapterId) return;
    if (transferActionRef.current) return;
    transferActionRef.current = true;
    try {
      setApplyingBatch(true);
      setActionLoading({ type: 'applyScheduled', id: batchId });
      const res = await apiFetch(`/api/v1/chapters/${user.chapterId}/reorganizations/${batchId}`, {
        method: 'POST',
        signal: AbortSignal.timeout(45_000),
      });
      setShowApplyBatchModal(false);
      if (res.ok) {
        notify('success', 'Chuyển giao nhiệm kỳ thành công! Sơ đồ 7 Ban đã được cập nhật ngay lập tức.');
        clearApiCache('/api/v1/chapters');
      } else {
        notify('error', res.error?.message || 'Lỗi áp dụng chuyển giao nhiệm kỳ.');
      }
    } catch {
      notify('error', 'Không xác nhận được kết quả; hãy tải lại trạng thái trước khi thử lại.');
    } finally {
      setApplyingBatch(false);
      setActionLoading(null);
      transferActionRef.current = false;
      clearApiCache('/api/v1/learning/me');
      clearApiCache('/api/v1/courses');
      void loadCurrentRoster(user.chapterId, true);
      void loadHistory(user.chapterId, true);
    }
  };

  // Hủy đợt chuyển giao đã lên lịch
  const handleCancelScheduledBatch = async (batchId: string) => {
    if (!user?.chapterId) return;
    if (transferActionRef.current) return;
    transferActionRef.current = true;
    try {
      setCancelingBatch(true);
      setActionLoading({ type: 'cancelScheduled', id: batchId });
      const res = await apiFetch(`/api/v1/chapters/${user.chapterId}/reorganizations/${batchId}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(45_000),
      });
      setShowCancelBatchModal(false);
      if (res.ok) {
        notify('success', 'Đã hủy đợt chuyển giao nhiệm kỳ đã lên lịch.');
        clearApiCache('/api/v1/chapters');
      } else {
        notify('error', res.error?.message || 'Lỗi hủy đợt chuyển giao.');
      }
    } catch {
      notify('error', 'Không xác nhận được kết quả; hãy tải lại trạng thái trước khi thử lại.');
    } finally {
      setCancelingBatch(false);
      setActionLoading(null);
      transferActionRef.current = false;
      clearApiCache('/api/v1/learning/me');
      clearApiCache('/api/v1/courses');
      void loadCurrentRoster(user.chapterId, true);
      void loadHistory(user.chapterId, true);
    }
  };

  // Xác nhận chuyển giao nhiệm kỳ
  const handleConfirmTransition = async () => {
    if (!user?.chapterId || !parsedResult?.items || !effectiveAt) return;
    if (!selectedTermNumber) {
      notify('error', 'Vui lòng chọn số thứ tự nhiệm kỳ chuyển giao trước khi xác nhận.');
      return;
    }
    if (transferActionRef.current) return;
    transferActionRef.current = true;
    try {
      setScheduling(true);
      setMessage(null);

      const res = await apiFetch(`/api/v1/chapters/${user.chapterId}/reorganizations`, {
        method: 'POST',
        signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({
          sourceUrl: rosterUrl,
          effectiveAt: new Date(effectiveAt).toISOString(),
          termNumber: Number(selectedTermNumber),
          items: parsedResult.items.map((item: any) => ({
            userId: item.userId,
            displayName: item.displayName,
            departmentUnitId: item.departmentUnitId,
            positionId: item.positionId,
            isPrimary: item.isLead,
          })),
        }),
      });

      if (!res.ok) {
        notify('error', res.error?.message || 'Vui lòng chọn ngày giờ hiệu lực hợp lệ và kiểm tra đầy đủ danh sách phân ban trước khi xác nhận chuyển giao.');
        return;
      }

      if (typeof window !== 'undefined') {
        localStorage.removeItem(`bbe_term_transition_draft_${user.chapterId}`);
      }
      setParsedResult(null);
      notify(
        'success',
        res.data?.appliedImmediately
          ? 'Chuyển giao nhiệm kỳ thành công! Hệ thống đã cập nhật Ban và LT ngay lập tức. Các thành viên không có trong sheet đã chuyển thành Chưa phân Ban.'
          : 'Đã lên lịch chuyển giao nhiệm kỳ thành công! Đợt chuyển giao đã được lưu bên dưới và sẽ tự động áp dụng khi đến ngày hiệu lực.'
      );

      clearApiCache('/api/v1/chapters');
    } catch {
      notify('error', 'Không xác nhận được kết quả; hãy tải lại trạng thái trước khi thử lại.');
    } finally {
      setScheduling(false);
      transferActionRef.current = false;
      clearApiCache('/api/v1/learning/me');
      clearApiCache('/api/v1/courses');
      void loadCurrentRoster(user.chapterId, true);
      void loadHistory(user.chapterId, true);
    }
  };

  return {
    actionLoading,
    applyingBatch,
    availableDepartments,
    cancelingBatch,
    changeDeptModal,
    currentTermNumber,
    deactivateText,
    deactivating,
    deactivatingUserId,
    displayTermNumber,
    effectiveAt,
    handleApplyScheduledBatch,
    handleAppointLead,
    handleAutoApplyScheduled,
    handleBulkDeactivate,
    handleBulkDeactivateUnassigned,
    handleCancelScheduledBatch,
    handleConfirmTransition,
    handleIndividualDeactivate,
    handleOpenCurrent,
    handleOpenHistory,
    handleParseSheet,
    handleSaveDepartment,
    historyList,
    historyLoading,
    importSectionRef,
    loadCurrentRoster,
    loadHistory,
    makeLead,
    message,
    mounted,
    notify,
    parsedResult,
    parsing,
    rosterData,
    rosterLoading,
    rosterUrl,
    savingDept,
    scheduledBatch,
    scheduling,
    scrollToImport,
    selectedDeptId,
    selectedHistoryTerm,
    selectedTermNumber,
    setChangeDeptModal,
    setDeactivateText,
    setEffectiveAt,
    setMakeLead,
    setMessage,
    setParsedResult,
    setRosterUrl,
    setSelectedDeptId,
    setSelectedHistoryTerm,
    setSelectedTermNumber,
    setShowApplyBatchModal,
    setShowBulkUnassignedModal,
    setShowCancelBatchModal,
    setShowConfirmDeactivate,
    setSingleDeactivateModal,
    setToast,
    showApplyBatchModal,
    showBulkUnassignedModal,
    showCancelBatchModal,
    showConfirmDeactivate,
    singleDeactivateModal,
    termOptions,
    toast,
    unassignedMembers,
    user,
    viewMode,
  };
}

export type TermTransitionState = ReturnType<typeof useTermTransition>;
