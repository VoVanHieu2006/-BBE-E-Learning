'use client';

import { useState, useEffect, useCallback, FormEvent, useRef } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import { apiFetch, clearApiCache } from '@/lib/api/client';
import { ORDERED_7_BANS } from '@/lib/departments';

const SAMPLE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1MA9pJ1E8oHEZe8d1g6j0Ns6JqLoOCdhSVSgOflO0JBI/edit?gid=0#gid=0';

/**
 * Đồng hồ đếm ngược thời gian thực siêu nhẹ (Zero-Lag)
 * Chỉ tính toán chênh lệch millisecond thuần trong bộ nhớ trình duyệt, không gây chậm hệ thống.
 * Tự động gọi onExpire() khi đếm về 0.
 */
function TermTransitionCountdown({
  targetDate,
  onExpire,
}: {
  targetDate: string;
  onExpire: () => void;
}) {
  const [timeLeft, setTimeLeft] = useState<{
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    isDue: boolean;
  } | null>(null);

  useEffect(() => {
    const targetMs = new Date(targetDate).getTime();
    if (isNaN(targetMs)) return;

    let hasExpired = false;

    function calculate() {
      const diff = targetMs - Date.now();
      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0, isDue: true });
        if (!hasExpired) {
          hasExpired = true;
          onExpire();
        }
        return;
      }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const minutes = Math.floor((diff / (1000 * 60)) % 60);
      const seconds = Math.floor((diff / 1000) % 60);
      setTimeLeft({ days, hours, minutes, seconds, isDue: false });
    }

    calculate();
    const interval = setInterval(calculate, 1000);
    return () => clearInterval(interval);
  }, [targetDate, onExpire]);

  if (!timeLeft) return null;

  if (timeLeft.isDue) {
    return (
      <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-500 text-white rounded-xl text-xs font-bold shadow-xs animate-pulse">
        <span>⚡</span>
        <span>Đã đến giờ hiệu lực! Đang tự động chuyển giao...</span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 px-3 py-1 bg-gradient-to-r from-blue-700 via-indigo-600 to-blue-600 text-white rounded-xl text-xs shadow-xs font-mono">
      <span className="text-amber-300 animate-pulse">⏳</span>
      <span className="font-sans font-semibold text-[11px] text-blue-100">Còn lại:</span>
      <span className="font-extrabold tracking-wider">
        {timeLeft.days > 0 ? `${timeLeft.days} ngày ` : ''}
        {String(timeLeft.hours).padStart(2, '0')}:{String(timeLeft.minutes).padStart(2, '0')}:{String(timeLeft.seconds).padStart(2, '0')}
      </span>
    </div>
  );
}

export default function ChapterManagerTermTransitionPage() {
  const [user, setUser] = useState<any>(null);
  const [mounted, setMounted] = useState(false);

  // Chế độ xem: 'current' (Nhiệm kỳ hiện tại) | 'history' (Lịch sử)
  const [viewMode, setViewMode] = useState<'current' | 'history'>('current');

  // Dữ liệu sơ đồ hiện tại & Ban
  const [rosterData, setRosterData] = useState<any[]>([]);
  const [unassignedMembers, setUnassignedMembers] = useState<any[]>([]);
  const [availableDepartments, setAvailableDepartments] = useState<any[]>([]);
  const [rosterLoading, setRosterLoading] = useState(true);

  // Đợt chuyển giao nhiệm kỳ đã lên lịch (chờ hiệu lực)
  const [scheduledBatch, setScheduledBatch] = useState<any | null>(null);
  const [applyingBatch, setApplyingBatch] = useState(false);
  const [cancelingBatch, setCancelingBatch] = useState(false);

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
    notify('success', '🎉 Đã đến thời gian hiệu lực! Đang tự động áp dụng chuyển giao nhiệm kỳ...');
    loadCurrentRoster(user.chapterId);
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

  async function loadCurrentRoster(chapterId: string) {
    setRosterLoading(true);
    const res = await apiFetch(`/api/v1/chapters/${chapterId}/current-roster`);
    if (res.ok && res.data) {
      setRosterData(res.data.roster || []);
      setUnassignedMembers(res.data.unassignedMembers || []);
      setAvailableDepartments(res.data.departments || []);
      setScheduledBatch(res.data.scheduledBatch || null);
    }
    setRosterLoading(false);
  }

  async function loadHistory(chapterId: string) {
    setHistoryLoading(true);
    const res = await apiFetch(`/api/v1/chapters/${chapterId}/reorganizations`);
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

  // Vô hiệu hóa từng thành viên riêng lẻ
  const handleIndividualDeactivate = async (userId: string, name?: string) => {
    if (!user?.chapterId) return;
    setDeactivatingUserId(userId);

    const res = await apiFetch(`/api/v1/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'INACTIVE', chapterId: user.chapterId }),
    });

    setDeactivatingUserId(null);

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

  // Vô hiệu hóa tất cả thành viên không có trong sheet
  const handleBulkDeactivate = async () => {
    if (!user?.chapterId || !parsedResult?.unmatchedCurrentMembers?.length) return;
    setDeactivating(true);

    const userIds = parsedResult.unmatchedCurrentMembers.map((m: any) => m.userId);
    const res = await apiFetch(`/api/v1/chapters/${user.chapterId}/members/bulk-deactivate`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    });

    setDeactivating(false);
    setShowConfirmDeactivate(false);

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
  const handleApplyScheduledBatch = async (batchId: string) => {
    if (!user?.chapterId) return;
    setApplyingBatch(true);
    setActionLoading({ type: 'applyScheduled', id: batchId });
    const res = await apiFetch(`/api/v1/chapters/${user.chapterId}/reorganizations/${batchId}`, {
      method: 'POST',
    });
    setApplyingBatch(false);
    setActionLoading(null);
    if (res.ok) {
      notify('success', 'Chuyển giao nhiệm kỳ thành công! Sơ đồ 7 Ban đã được cập nhật ngay lập tức.');
      clearApiCache('/api/v1/chapters');
      loadCurrentRoster(user.chapterId);
    } else {
      notify('error', res.error?.message || 'Lỗi áp dụng chuyển giao nhiệm kỳ.');
    }
  };

  // Hủy đợt chuyển giao đã lên lịch
  const handleCancelScheduledBatch = async (batchId: string) => {
    if (!user?.chapterId || !confirm('Bạn có chắc chắn muốn hủy đợt chuyển giao nhiệm kỳ đã lên lịch này?')) return;
    setCancelingBatch(true);
    setActionLoading({ type: 'cancelScheduled', id: batchId });
    const res = await apiFetch(`/api/v1/chapters/${user.chapterId}/reorganizations/${batchId}`, {
      method: 'DELETE',
    });
    setCancelingBatch(false);
    setActionLoading(null);
    if (res.ok) {
      notify('success', 'Đã hủy đợt chuyển giao nhiệm kỳ đã lên lịch.');
      clearApiCache('/api/v1/chapters');
      loadCurrentRoster(user.chapterId);
    } else {
      notify('error', res.error?.message || 'Lỗi hủy đợt chuyển giao.');
    }
  };

  // Xác nhận chuyển giao nhiệm kỳ
  const handleConfirmTransition = async () => {
    if (!user?.chapterId || !parsedResult?.items || !effectiveAt) return;
    setScheduling(true);
    setMessage(null);

    const res = await apiFetch(`/api/v1/chapters/${user.chapterId}/reorganizations`, {
      method: 'POST',
      body: JSON.stringify({
        sourceUrl: rosterUrl,
        effectiveAt: new Date(effectiveAt).toISOString(),
        items: parsedResult.items.map((item: any) => ({
          userId: item.userId,
          displayName: item.displayName,
          departmentUnitId: item.departmentUnitId,
          positionId: item.positionId,
          isPrimary: item.isLead,
        })),
      }),
    });

    setScheduling(false);
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
    loadCurrentRoster(user.chapterId);
  };

  return (
    <div className="space-y-8 max-w-7xl pb-20">
      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="inline-block text-xs font-bold px-3 py-1 bg-[#2563EB]/10 text-[#2563EB] rounded-full mb-1">
            🔄 Quản trị nhân sự & Nhiệm kỳ Chapter
          </span>
          <h1 className="text-3xl font-extrabold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Chuyển Giao Nhiệm Kỳ Chapter
          </h1>
          <p className="text-sm text-[#737686] mt-0.5">
            Chapter: <span className="font-semibold text-[#172554]">{mounted && user?.chapterName ? user.chapterName : 'Chapter Demo'}</span> • Cơ cấu 7 Ban chuẩn và sơ đồ lãnh đạo LT
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant={viewMode === 'current' ? 'primary' : 'outline'}
            onClick={handleOpenCurrent}
            size="sm"
          >
            🏛️ Nhiệm kỳ hiện tại
          </Button>
          <Button
            variant={viewMode === 'history' ? 'primary' : 'outline'}
            onClick={handleOpenHistory}
            size="sm"
          >
            📜 Lịch sử nhiệm kỳ
          </Button>
          <Button
            variant="primary"
            onClick={scrollToImport}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
          >
            📥 Nạp Google Sheet nhiệm kỳ mới
          </Button>
        </div>
      </div>

      {/* VIEW MODE: Nhiệm kỳ hiện tại (7 Cột rộng rãi + Cuộn ngang) */}
      {viewMode === 'current' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-[#172554] flex items-center gap-2">
                <span>🏛️ Sơ đồ 7 Ban nhiệm kỳ hiện tại</span>
              </h2>
              <p className="text-xs text-[#737686] mt-0.5">
                Người đứng đầu mỗi Ban là Trưởng ban. Bấm vào thành viên để xem chi tiết hoặc đổi Ban. Bảng cuộn ngang ↔ để xem đủ 7 cột.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => user?.chapterId && loadCurrentRoster(user.chapterId)}
              loading={rosterLoading}
            >
              🔄 Tải lại sơ đồ
            </Button>
          </div>

          {rosterLoading ? (
            <Card className="p-16 text-center text-[#737686]">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent mb-3" />
              <p className="font-semibold">Đang tải sơ đồ phân ban của Chapter...</p>
            </Card>
          ) : (
            <div className="relative">
              {/* Lớp phủ làm mờ mượt mà khi đang xử lý bổ nhiệm / đổi ban */}
              {actionLoading && (
                <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] z-20 flex flex-col items-center justify-center rounded-2xl transition-all">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-3 border-blue-600 border-t-transparent mb-2" />
                  <span className="text-xs font-bold text-slate-800 bg-white/95 px-3.5 py-1.5 rounded-full shadow-md border border-slate-200">
                    {actionLoading.type === 'appoint'
                      ? '👑 Đang bổ nhiệm Trưởng ban...'
                      : actionLoading.type === 'saveDept'
                      ? '⚙️ Đang lưu thông tin phân Ban...'
                      : actionLoading.type === 'applyScheduled'
                      ? '⚡ Đang áp dụng chuyển giao nhiệm kỳ...'
                      : 'Đang xử lý...'}
                  </span>
                </div>
              )}

              <div className={`overflow-x-auto pb-4 ${actionLoading ? 'pointer-events-none opacity-50' : ''}`}>
                <div className="grid grid-cols-7 gap-4 min-w-[1650px]">
                {rosterData.map((ban, idx) => {
                  const isPresidentBan = ban.name === 'Chủ Tịch';
                  return (
                    <div
                      key={ban.id || ban.name || idx}
                      className="bg-slate-50/70 border border-[#e2e8f0] rounded-2xl p-3.5 flex flex-col h-full shadow-xs min-w-[230px]"
                    >
                      {/* Cột Header */}
                      <div className="pb-3 mb-3 border-b border-[#e2e8f0] flex items-center justify-between">
                        <div className="font-bold text-xs text-[#172554] truncate" title={ban.name}>
                          {ban.name}
                        </div>
                        <span
                          className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full ${
                            isPresidentBan
                              ? 'bg-amber-100 text-amber-900 border border-amber-300'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {ban.total}
                        </span>
                      </div>

                      {/* Danh sách thành viên trong Ban (Không cuộn riêng lẻ từng cột) */}
                      <div className="space-y-2.5 flex-1 pr-0.5">
                        {ban.members.map((member: any, mIdx: number) => {
                          const isLead = member.isLead;

                          return (
                            <div
                              key={member.userId || mIdx}
                              className={`rounded-xl p-3 text-xs transition relative group ${
                                isPresidentBan
                                  ? 'bg-gradient-to-b from-amber-50 to-white border-2 border-amber-400 shadow-sm'
                                  : isLead
                                  ? 'bg-gradient-to-b from-amber-50/80 to-white border-2 border-amber-300 shadow-xs'
                                  : 'bg-white border border-[#eff4ff] hover:border-blue-300'
                              }`}
                            >
                              {/* Badge Chức vụ */}
                              {isPresidentBan ? (
                                <div className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-amber-900 bg-amber-200/80 px-2 py-0.5 rounded-md mb-1.5 shadow-2xs">
                                  <span>⭐</span> Chủ tịch Chapter
                                </div>
                              ) : isLead ? (
                                <div className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md mb-1.5 border border-amber-200">
                                  <span>👑</span> Trưởng ban
                                </div>
                              ) : null}

                              {/* Click vào tên để xem chi tiết */}
                              <Link
                                href={`/chapter-manager/members/${member.userId}`}
                                className="font-bold text-[#172554] hover:text-[#2563EB] block text-[13px] transition break-words"
                                title="Bấm để xem chi tiết thành viên"
                              >
                                {member.displayName}
                              </Link>
                              <div className="text-[11px] text-[#737686] truncate mt-0.5" title={member.email}>
                                {member.email}
                              </div>

                              {/* Nút hành động */}
                              <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                                {!isLead && !isPresidentBan && ban.id ? (
                                  <button
                                    type="button"
                                    disabled={Boolean(actionLoading)}
                                    onClick={() => handleAppointLead(member.userId, member.displayName, ban.id!, ban.name)}
                                    className="text-amber-700 hover:text-amber-900 font-bold flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                                    title="Bổ nhiệm làm Trưởng ban"
                                  >
                                    {actionLoading?.type === 'appoint' && actionLoading.id === member.userId ? (
                                      <>
                                        <div className="animate-spin rounded-full h-3 w-3 border-2 border-amber-700 border-t-transparent" />
                                        <span>Đang bổ nhiệm...</span>
                                      </>
                                    ) : (
                                      <>
                                        <span>👑</span> Bổ nhiệm LT
                                      </>
                                    )}
                                  </button>
                                ) : (
                                  <span className="text-[10px] text-amber-800 font-bold">{isPresidentBan ? '⭐ Lãnh đạo' : '👑 Trưởng ban'}</span>
                                )}
                                <button
                                  type="button"
                                  disabled={Boolean(actionLoading)}
                                  onClick={() => {
                                    setChangeDeptModal({
                                      userId: member.userId,
                                      displayName: member.displayName,
                                      currentDeptName: ban.name,
                                    });
                                    setSelectedDeptId(ban.id || '');
                                    setMakeLead(member.isLead);
                                  }}
                                  className="text-slate-500 hover:text-[#2563EB] font-semibold flex items-center gap-0.5 ml-auto disabled:opacity-40 disabled:cursor-not-allowed"
                                  title="Chuyển sang ban khác"
                                >
                                  ⚙️ Đổi ban
                                </button>
                              </div>
                            </div>
                          );
                        })}

                        {ban.members.length === 0 && (
                          <div className="text-center py-8 text-xs text-[#94a3b8] italic">
                            Chưa có thành viên
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

          {/* KHU VỰC THÀNH VIÊN CHƯA CÓ BAN (ĐẶT NGAY DƯỚI SƠ ĐỒ NHIỆM KỲ HIỆN TẠI ĐỂ DỄ THAO TÁC) */}
          <Card className="border border-amber-200 bg-amber-50/20 p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-200/60 pb-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-amber-900 flex items-center gap-1.5">
                  <span>⚠️ Thành viên chưa có Ban ({unassignedMembers.length})</span>
                </h3>
                <p className="text-xs text-[#737686] mt-0.5">
                  Các thành viên thuộc Chapter nhưng chưa phân ban (bao gồm thành viên không có trong sheet sau khi chuyển giao). Bạn có thể gán Ban hoặc vô hiệu hóa tài khoản.
                </p>
              </div>
            </div>

            {unassignedMembers.length === 0 ? (
              <p className="text-xs text-[#737686] italic py-2">
                Tất cả thành viên trong Chapter đã được phân vào các Ban đầy đủ.
              </p>
            ) : (
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-left text-xs bg-white rounded-xl border border-amber-200/80 overflow-hidden">
                  <thead className="bg-slate-100 border-b-2 border-slate-300 text-slate-900 font-extrabold text-[11px] uppercase tracking-wider sticky top-0">
                    <tr>
                      <th className="py-2.5 px-4">Thành viên</th>
                      <th className="py-2.5 px-4">Email</th>
                      <th className="py-2.5 px-4 text-center">Gán vào Ban</th>
                      <th className="py-2.5 px-4 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {unassignedMembers.map((m) => (
                      <tr key={m.userId} className="hover:bg-amber-50/30 transition">
                        <td className="py-2.5 px-4">
                          <Link
                            href={`/chapter-manager/members/${m.userId}`}
                            className="font-semibold text-[#172554] hover:text-[#2563EB]"
                          >
                            {m.displayName}
                          </Link>
                        </td>
                        <td className="py-2.5 px-4 text-[#737686]">{m.email}</td>
                        <td className="py-2.5 px-4 text-center">
                          <select
                            value={changeDeptModal?.userId === m.userId ? selectedDeptId : ''}
                            disabled={Boolean(actionLoading)}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val) {
                                setSelectedDeptId(val);
                                setChangeDeptModal({
                                  userId: m.userId,
                                  displayName: m.displayName,
                                });
                                const deptObj = availableDepartments.find((d: any) => d.id === val);
                                setMakeLead(deptObj?.name === 'Chủ Tịch');
                              }
                            }}
                            className="text-xs border border-[#cbdbf5] rounded-lg px-2.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-[#2563EB] disabled:opacity-50"
                          >
                            <option value="">➕ Chọn ban để gán...</option>
                            {availableDepartments.map((d: any) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={`/chapter-manager/members/${m.userId}`}
                              className="text-blue-600 hover:underline font-semibold"
                            >
                              Chi tiết
                            </Link>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-700 bg-red-50 hover:bg-red-100 border-red-200 font-semibold text-xs py-1 px-2.5"
                              loading={deactivatingUserId === m.userId}
                              onClick={() => handleIndividualDeactivate(m.userId, m.displayName)}
                            >
                              ⛔ Vô hiệu hóa
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ĐỢT CHUYỂN GIAO NHIỆM KỲ ĐÃ LÊN LỊCH (ĐẶT DƯỚI THÀNH VIÊN CHƯA CÓ BAN) */}
          {scheduledBatch && (
            <Card className="p-5 border-2 border-blue-300 bg-gradient-to-r from-blue-50/50 via-white to-blue-50/30 rounded-2xl shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-blue-100 pb-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-100 text-[#2563EB] rounded-full text-xs font-bold">
                      <span>📅</span> Đợt chuyển giao nhiệm kỳ tiếp theo (Đã lên lịch)
                    </span>
                    <TermTransitionCountdown
                      targetDate={scheduledBatch.effectiveAt}
                      onExpire={handleAutoApplyScheduled}
                    />
                  </div>
                  <h3 className="text-lg font-bold text-[#172554]">
                    Dự kiến hiệu lực lúc: {new Date(scheduledBatch.effectiveAt).toLocaleString('vi-VN')}
                  </h3>
                  <p className="text-xs text-[#737686] mt-0.5">
                    Tổng cộng <strong>{scheduledBatch.totalItems}</strong> thành viên được xếp vào 7 Ban. Hệ thống sẽ tự động chuyển giao khi đến giờ hẹn.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleApplyScheduledBatch(scheduledBatch.id)}
                    loading={applyingBatch}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                  >
                    ⚡ Áp dụng ngay bây giờ
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCancelScheduledBatch(scheduledBatch.id)}
                    loading={cancelingBatch}
                    className="text-red-600 border-red-200 hover:bg-red-50"
                  >
                    ✕ Hủy lịch này
                  </Button>
                </div>
              </div>

              {/* Sơ đồ 7 cột dự kiến */}
              <div className="overflow-x-auto pb-2">
                <div className="grid grid-cols-7 gap-3 min-w-[1650px]">
                  {scheduledBatch.newTerm?.map((col: any, cIdx: number) => {
                    const isPresidentBan = col.departmentName === 'Chủ Tịch';
                    return (
                      <div key={cIdx} className="bg-white border border-blue-200 rounded-xl p-3 text-xs min-w-[230px] shadow-2xs">
                        <div className="font-bold text-[#172554] border-b border-blue-100 pb-2 mb-2 flex justify-between items-center">
                          <span>{col.departmentName}</span>
                          <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                            {col.total}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {col.members.map((m: any, mIdx: number) => (
                            <div
                              key={mIdx}
                              className={`p-2.5 rounded-lg ${
                                isPresidentBan
                                  ? 'bg-amber-100 border border-amber-300 font-bold'
                                  : m.isLead
                                  ? 'bg-amber-50 border border-amber-200 font-semibold'
                                  : 'bg-slate-50 border border-slate-100'
                              }`}
                            >
                              {m.isLead && (
                                <div className="text-[9px] font-extrabold text-amber-800 uppercase mb-1">
                                  {isPresidentBan ? '⭐ Chủ tịch' : '👑 Trưởng ban'}
                                </div>
                              )}
                              <div className="truncate text-[#172554] font-semibold">{m.displayName}</div>
                              <div className="truncate text-[10px] text-[#737686]">{m.email}</div>
                            </div>
                          ))}
                          {col.members.length === 0 && (
                            <div className="text-center py-4 text-[11px] text-slate-400 italic">Trống</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Bảng thành viên Chapter không có tên trong nhiệm kỳ tiếp theo */}
              {scheduledBatch.unmatchedCurrentMembers && scheduledBatch.unmatchedCurrentMembers.length > 0 && (
                <div className="pt-4 border-t border-blue-200/80 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <h4 className="text-xs font-extrabold text-amber-900 uppercase tracking-wide flex items-center gap-1.5">
                      <span>⚠️</span> Thành viên Chapter không có tên trong nhiệm kỳ tiếp theo ({scheduledBatch.unmatchedCurrentMembers.length})
                    </h4>
                    <span className="text-[11px] text-[#737686]">
                      (Sau khi chuyển giao, các thành viên này sẽ chuyển về trạng thái Chưa phân Ban)
                    </span>
                  </div>

                  <div className="border border-amber-200 rounded-xl overflow-hidden bg-white max-h-56 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 border-b-2 border-slate-300 text-slate-900 font-extrabold text-[11px] uppercase tracking-wider sticky top-0">
                        <tr>
                          <th className="py-2.5 px-4">Họ và tên</th>
                          <th className="py-2.5 px-4">Email</th>
                          <th className="py-2.5 px-4">Ban hiện tại</th>
                          <th className="py-2.5 px-4 text-right">Chi tiết</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-100/60">
                        {scheduledBatch.unmatchedCurrentMembers.map((m: any) => (
                          <tr key={m.userId} className="hover:bg-amber-50/20">
                            <td className="py-2 px-4 font-semibold text-[#172554]">
                              <Link
                                href={`/chapter-manager/members/${m.userId}`}
                                className="hover:text-[#2563EB]"
                              >
                                {m.displayName}
                              </Link>
                            </td>
                            <td className="py-2 px-4 text-[#737686]">{m.email}</td>
                            <td className="py-2 px-4 font-medium text-slate-700">{m.currentDepartmentName}</td>
                            <td className="py-2 px-4 text-right">
                              <Link
                                href={`/chapter-manager/members/${m.userId}`}
                                className="text-blue-600 hover:underline font-semibold"
                              >
                                Chi tiết →
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              KHU VỰC NHẬP GOOGLE SHEET CHUYỂN GIAO NHIỆM KỲ MỚI (NẰM PHÍA DƯỚI)
             ═══════════════════════════════════════════════════════════════════ */}
          <div
            id="import-sheet-section"
            ref={importSectionRef}
            className="pt-8 border-t-2 border-slate-200 space-y-6"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-md border border-blue-100">
                  Bước chuẩn bị chuyển giao
                </span>
                <h2 className="text-xl font-bold text-[#172554] mt-1">
                  📥 Nhập Dữ Liệu Nhiệm Kỳ Mới từ Google Sheet
                </h2>
                <p className="text-xs text-[#737686] mt-0.5">
                  Đọc danh sách phân ban từ Google Sheet, xem trước 7 cột nhiệm kỳ mới và đối soát nhân sự trước khi áp dụng.
                </p>
              </div>

              <a
                href={SAMPLE_SHEET_URL}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-bold text-blue-600 hover:text-blue-800 underline inline-flex items-center gap-1 self-start sm:self-auto"
              >
                📋 Xem Sheet mẫu chuẩn ↗
              </a>
            </div>

            {/* Hướng dẫn & Nhắc nhở làm mới */}
            <div className="p-4 bg-blue-50/70 rounded-2xl border border-blue-200/80 space-y-2">
              <p className="text-xs text-blue-950 font-semibold">
                Google Sheet gồm đúng 7 cột: <strong>Chủ Tịch, Ban Thành Viên, Ban Thư Ký, Ban Khách Mời, Ban TT&SK, Ban Nội Dung, Ban Chất Lượng</strong>.
                Người đứng đầu mỗi cột là <strong>LT của ban đó</strong> (Chủ Tịch có 1 người duy nhất). Định dạng mỗi ô: <strong>Họ tên (email@gmail.com)</strong>.
              </p>
              <p className="text-xs text-blue-800 bg-blue-100/70 px-3 py-1.5 rounded-lg border border-blue-200 inline-block">
                💡 <strong>Lưu ý:</strong> Nếu bạn vừa sửa dữ liệu trên Google Sheet, vui lòng bấm nút <strong>"🔍 Đọc và phân tích sheet"</strong> để hệ thống làm mới bản dự kiến mới nhất!
              </p>
            </div>

            {/* Thông báo kết quả / lỗi chuyển giao ngay tại khu vực thao tác */}
            {message && (
              <div
                className={`p-4 rounded-xl text-sm font-medium flex items-center justify-between border shadow-xs ${
                  message.type === 'success'
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                    : 'bg-red-50 text-red-900 border-red-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{message.type === 'success' ? '✅' : '⚠️'}</span>
                  <span>{message.text}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMessage(null)}
                  className="text-xs font-bold text-slate-500 hover:text-slate-800 ml-4 px-2 py-1 rounded"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Form nhập Sheet & ngày hiệu lực */}
            <Card className="p-5 border border-[#eff4ff] shadow-sm">
              <form onSubmit={handleParseSheet} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                  <div>
                    <label className="block text-xs font-bold text-[#172554] mb-1">
                      Đường dẫn Google Sheet danh sách nhiệm kỳ mới:
                    </label>
                    <input
                      required
                      type="url"
                      value={rosterUrl}
                      onChange={(e) => setRosterUrl(e.target.value)}
                      placeholder="Dán link Google Sheet..."
                      className="w-full rounded-xl border border-[#cbdbf5] px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <Button type="submit" loading={parsing} loadingText="Đang phân tích...">
                      🔍 Đọc và phân tích sheet
                    </Button>
                  </div>
                </div>

                <div className="max-w-xs">
                  <label className="block text-xs font-bold text-[#172554] mb-1">
                    Thời gian bắt đầu có hiệu lực *
                  </label>
                  <input
                    required
                    type="datetime-local"
                    value={effectiveAt}
                    onChange={(e) => setEffectiveAt(e.target.value)}
                    className="w-full rounded-xl border border-[#cbdbf5] px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  />
                  <p className="text-[11px] text-[#737686] mt-1">
                    Nếu đặt ngày hiện tại, hệ thống sẽ áp dụng và đổi Ban cho Chapter ngay lập tức.
                  </p>
                </div>
              </form>
            </Card>

            {/* KẾT QUẢ PHÂN TÍCH (XEM TRƯỚC 7 CỘT VÀ 2 BẢNG ĐỐI SOÁT) */}
            {parsedResult && (
              <div className="space-y-6 pt-4 border-t border-[#eff4ff]">
                {/* 3 Thẻ Tóm tắt */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 text-center">
                    <div className="text-2xl font-extrabold text-emerald-800">
                      {parsedResult.summary?.matchedInChapter || 0}
                    </div>
                    <div className="text-xs text-emerald-700 font-semibold mt-0.5">
                      Thành viên khớp Chapter
                    </div>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 text-center">
                    <div className="text-2xl font-extrabold text-blue-800">
                      {parsedResult.summary?.unmatchedSheetCount || 0}
                    </div>
                    <div className="text-xs text-blue-700 font-semibold mt-0.5">
                      Thành viên có trong Sheet nhưng chưa thuộc Chapter
                    </div>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-center">
                    <div className="text-2xl font-extrabold text-amber-800">
                      {parsedResult.summary?.unmatchedCurrentCount || 0}
                    </div>
                    <div className="text-xs text-amber-700 font-semibold mt-0.5">
                      Thành viên Chapter không có tên trong sheet
                    </div>
                  </div>
                </div>

                {/* 1. SƠ ĐỒ DỰ KIẾN: 7 Cột Nhiệm kỳ mới */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold text-[#172554] flex items-center gap-1.5">
                      <span>🏛️ 7 Cột Nhiệm kỳ mới dự kiến</span>
                      <span className="text-xs font-normal text-[#737686]">
                        (Phân bổ theo sheet, người đầu in nổi bật là LT / Chủ tịch)
                      </span>
                    </h3>
                  </div>

                  <div className="overflow-x-auto pb-4">
                    <div className="grid grid-cols-7 gap-3 min-w-[1650px]">
                      {parsedResult.matchedNewTerm?.map((col: any, cIdx: number) => {
                        const isPresidentBan = col.departmentName === 'Chủ Tịch';
                        return (
                          <div key={cIdx} className="bg-slate-50 border border-[#e2e8f0] rounded-xl p-3 text-xs min-w-[230px]">
                            <div className="font-bold text-[#172554] border-b border-[#e2e8f0] pb-2 mb-2.5 flex justify-between items-center">
                              <span className="truncate">{col.departmentName}</span>
                              <span className="text-[10px] font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                                {col.total}
                              </span>
                            </div>

                            <div className="space-y-2">
                              {col.members.map((m: any, mIdx: number) => {
                                const isLead = m.isLead;
                                return (
                                  <div
                                    key={mIdx}
                                    className={`p-2.5 rounded-lg ${
                                      isPresidentBan
                                        ? 'bg-amber-100 border border-amber-300 font-bold'
                                        : isLead
                                        ? 'bg-amber-50 border border-amber-200 font-semibold'
                                        : 'bg-white border border-[#eff4ff]'
                                    }`}
                                  >
                                    {isLead && (
                                      <div className="text-[9px] font-bold text-amber-800 uppercase mb-1">
                                        {isPresidentBan ? '⭐ Chủ tịch' : '👑 Trưởng ban'}
                                      </div>
                                    )}
                                    {m.userId ? (
                                      <Link
                                        href={`/chapter-manager/members/${m.userId}`}
                                        className="truncate text-[#172554] hover:text-[#2563EB] font-semibold block"
                                      >
                                        {m.displayName}
                                      </Link>
                                    ) : (
                                      <div className="truncate text-[#172554] font-medium">{m.displayName}</div>
                                    )}
                                    <div className="truncate text-[10px] text-[#737686]">{m.email}</div>
                                  </div>
                                );
                              })}

                              {col.members.length === 0 && (
                                <div className="text-center py-6 text-[11px] text-[#94a3b8] italic">
                                  Trống
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* 2. BẢNG 1: Thành viên có trong Sheet nhưng chưa thuộc Chapter */}
                {parsedResult.unmatchedSheetMembers?.length > 0 && (
                  <div className="space-y-2.5 border-t border-[#eff4ff] pt-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-blue-900 flex items-center gap-1.5">
                        <span>ℹ️ Thành viên có trong Sheet nhưng chưa thuộc Chapter ({parsedResult.unmatchedSheetMembers.length})</span>
                      </h3>
                      <span className="text-xs text-[#737686]">Cần mời hoặc tạo tài khoản vào Chapter để được xếp ban</span>
                    </div>

                    <div className="border border-blue-200 rounded-xl overflow-hidden bg-white max-h-60 overflow-y-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 border-b-2 border-slate-300 text-slate-900 font-extrabold text-[11px] uppercase tracking-wider sticky top-0">
                          <tr>
                            <th className="py-2.5 px-4">Họ và tên</th>
                            <th className="py-2.5 px-4">Gmail</th>
                            <th className="py-2.5 px-4">Ban trong sheet</th>
                            <th className="py-2.5 px-4 text-center">Vai trò dự kiến</th>
                            <th className="py-2.5 px-4 text-center">Trạng thái</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#eff4ff]">
                          {parsedResult.unmatchedSheetMembers.map((item: any, idx: number) => (
                            <tr key={idx} className="hover:bg-blue-50/30">
                              <td className="py-2 px-4 font-semibold text-[#172554]">{item.displayName}</td>
                              <td className="py-2 px-4 text-[#737686]">{item.email}</td>
                              <td className="py-2 px-4 font-medium text-blue-700">{item.departmentName}</td>
                              <td className="py-2 px-4 text-center">
                                {item.isLead ? (
                                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold text-[10px]">
                                    👑 Trưởng ban
                                  </span>
                                ) : (
                                  <span className="text-[#737686]">Thành viên</span>
                                )}
                              </td>
                              <td className="py-2 px-4 text-center">
                                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium text-[10px]">
                                  Chưa có trong Chapter
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 3. BẢNG 2: Thành viên Chapter không có tên trong sheet */}
                {parsedResult.unmatchedCurrentMembers?.length > 0 && (
                  <div className="space-y-2.5 border-t border-[#eff4ff] pt-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-red-700 flex items-center gap-1.5">
                          <span>⚠️ Thành viên Chapter không có tên trong sheet ({parsedResult.unmatchedCurrentMembers.length})</span>
                        </h3>
                        <p className="text-xs text-[#737686]">
                          Những thành viên này sẽ mất ban sau chuyển giao. Bạn có thể vô hiệu hóa tất cả hoặc vô hiệu hóa từng người.
                        </p>
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="bg-red-50 text-red-700 border-red-300 hover:bg-red-100 font-bold"
                        onClick={() => setShowConfirmDeactivate(true)}
                      >
                        ⛔ Vô hiệu hóa tất cả ({parsedResult.unmatchedCurrentMembers.length})
                      </Button>
                    </div>

                    <div className="border border-red-200 rounded-xl overflow-hidden bg-white max-h-60 overflow-y-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 border-b-2 border-slate-300 text-slate-900 font-extrabold text-[11px] uppercase tracking-wider sticky top-0">
                          <tr>
                            <th className="py-2.5 px-4">Họ và tên</th>
                            <th className="py-2.5 px-4">Email</th>
                            <th className="py-2.5 px-4">Ban hiện tại</th>
                            <th className="py-2.5 px-4 text-right">Thao tác</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#eff4ff]">
                          {parsedResult.unmatchedCurrentMembers.map((item: any, idx: number) => (
                            <tr key={idx} className="hover:bg-red-50/20">
                              <td className="py-2 px-4 font-semibold text-[#172554]">
                                <Link
                                  href={`/chapter-manager/members/${item.userId}`}
                                  className="hover:text-[#2563EB]"
                                >
                                  {item.displayName}
                                </Link>
                              </td>
                              <td className="py-2 px-4 text-[#737686]">{item.email}</td>
                              <td className="py-2 px-4 font-medium text-slate-700">{item.currentDepartmentName}</td>
                              <td className="py-2 px-4 text-right">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-700 bg-red-50 hover:bg-red-100 border-red-200 font-bold text-xs py-1 px-2.5"
                                  loading={deactivatingUserId === item.userId}
                                  onClick={() => handleIndividualDeactivate(item.userId, item.displayName)}
                                >
                                  ⛔ Vô hiệu hóa
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Hàng nút Hành động Xác nhận chuyển giao */}
                <div className="flex flex-col sm:flex-row justify-between items-center gap-3 pt-4 border-t border-[#eff4ff]">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setParsedResult(null);
                        if (typeof window !== 'undefined' && user?.chapterId) {
                          localStorage.removeItem(`bbe_term_transition_draft_${user.chapterId}`);
                        }
                      }}
                      className="text-slate-600 hover:text-red-600"
                    >
                      ✕ Đóng và xóa bản nháp
                    </Button>
                  </div>
                  <Button
                    loading={scheduling}
                    loadingText="Đang xử lý chuyển giao..."
                    onClick={handleConfirmTransition}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                  >
                    🚀 Xác nhận chuyển giao nhiệm kỳ
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW MODE: Lịch sử nhiệm kỳ */}
      {viewMode === 'history' && (
        <Card className="p-6 border border-[#eff4ff] space-y-6">
          <div className="flex items-center justify-between border-b border-[#eff4ff] pb-4">
            <div>
              <h2 className="text-lg font-bold text-[#172554]">Lịch sử các đợt chuyển giao nhiệm kỳ</h2>
              <p className="text-xs text-[#737686] mt-0.5">
                Xem lại danh sách nhân sự và cơ cấu Ban của các nhiệm kỳ trước
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => user?.chapterId && loadHistory(user.chapterId)}
              loading={historyLoading}
            >
              🔄 Tải lại
            </Button>
          </div>

          {historyLoading ? (
            <div className="text-center py-12 text-[#737686]">Đang tải lịch sử nhiệm kỳ...</div>
          ) : historyList.length === 0 ? (
            <div className="text-center py-12 text-[#737686] italic">
              Chưa có lịch sử đợt chuyển giao nhiệm kỳ nào được lưu lại.
            </div>
          ) : (
            <div className="divide-y divide-[#eff4ff]">
              {historyList.map((term: any) => (
                <div
                  key={term.id}
                  className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#f8f9ff] px-3 rounded-xl transition"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#172554] text-sm">
                        Nhiệm kỳ áp dụng lúc: {new Date(term.effectiveAt).toLocaleString('vi-VN')}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          term.status === 'APPLIED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {term.status === 'APPLIED' ? 'Đã áp dụng' : 'Đã lên lịch'}
                      </span>
                    </div>
                    <p className="text-xs text-[#737686] mt-1">
                      Tổng nhân sự phân ban: <strong>{term.itemCount}</strong> thành viên
                      {term.sourceUrl && (
                        <span>
                          {' · '}
                          <a
                            href={term.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 underline"
                          >
                            Nguồn Google Sheet
                          </a>
                        </span>
                      )}
                    </p>
                  </div>

                  <Button size="sm" variant="outline" onClick={() => setSelectedHistoryTerm(term)}>
                    👁️ Xem cơ cấu
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* MODAL CHI TIẾT LỊCH SỬ MỘT NHIỆM KỲ */}
      {selectedHistoryTerm && (
        <Modal
          isOpen={Boolean(selectedHistoryTerm)}
          onClose={() => setSelectedHistoryTerm(null)}
          maxWidth="max-w-6xl"
        >
          <div className="space-y-4 p-2">
            <div className="flex items-center justify-between border-b border-[#eff4ff] pb-3">
              <div>
                <h3 className="text-lg font-bold text-[#172554]">
                  Cơ cấu nhân sự nhiệm kỳ ({new Date(selectedHistoryTerm.effectiveAt).toLocaleDateString('vi-VN')})
                </h3>
                <p className="text-xs text-[#737686]">
                  Tổng {selectedHistoryTerm.itemCount} thành viên được phân bổ
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedHistoryTerm(null)}
                className="text-[#737686] hover:text-[#172554] text-lg font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>

            <div className="overflow-x-auto pb-4 max-h-[500px]">
              <div className="grid grid-cols-7 gap-3 min-w-[1650px]">
                {ORDERED_7_BANS.map((banName) => {
                  const banItems = (selectedHistoryTerm.items || []).filter(
                    (it: any) => it.departmentName === banName
                  );
                  const isPresidentBan = banName === 'Chủ Tịch';

                  return (
                    <div key={banName} className="bg-slate-50 border border-[#e2e8f0] rounded-xl p-2.5 min-w-[230px]">
                      <div className="font-bold text-xs text-[#172554] border-b border-[#e2e8f0] pb-1.5 mb-2 flex justify-between">
                        <span className="truncate">{banName}</span>
                        <span className="text-[11px] font-bold text-blue-700">{banItems.length}</span>
                      </div>
                      <div className="space-y-1.5">
                        {banItems.map((item: any, iIdx: number) => (
                          <div
                            key={item.id || iIdx}
                            className={`p-2 rounded-lg text-xs ${
                              isPresidentBan
                                ? 'bg-amber-100 border border-amber-300 font-bold'
                                : item.isLead
                                ? 'bg-amber-50 border border-amber-200 font-semibold'
                                : 'bg-white border border-[#eff4ff]'
                            }`}
                          >
                            {item.isLead && !isPresidentBan && (
                              <div className="text-[9px] font-bold text-amber-800 uppercase">👑 Trưởng ban</div>
                            )}
                            {item.userId ? (
                              <Link
                                href={`/chapter-manager/members/${item.userId}`}
                                className="truncate text-[#172554] hover:text-[#2563EB] block font-semibold"
                              >
                                {item.displayName}
                              </Link>
                            ) : (
                              <div className="truncate text-[#172554]">{item.displayName}</div>
                            )}
                            <div className="truncate text-[10px] text-[#737686]">{item.email}</div>
                          </div>
                        ))}
                        {banItems.length === 0 && (
                          <div className="text-center py-4 text-[11px] text-[#94a3b8] italic">Không có</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-[#eff4ff]">
              <Button onClick={() => setSelectedHistoryTerm(null)}>Đóng</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL ĐỔI BAN CHO THÀNH VIÊN */}
      {changeDeptModal && (
        <Modal
          isOpen={Boolean(changeDeptModal)}
          onClose={() => {
            if (!savingDept) {
              setChangeDeptModal(null);
              setSelectedDeptId('');
              setMakeLead(false);
            }
          }}
          maxWidth="max-w-md"
        >
          <div className="space-y-4 p-2">
            <div className="flex items-center justify-between pb-2 border-b border-[#eff4ff]">
              <h3 className="text-base font-bold text-[#172554]">
                Phân Ban cho: {changeDeptModal.displayName}
              </h3>
              {!savingDept && (
                <button
                  type="button"
                  onClick={() => {
                    setChangeDeptModal(null);
                    setSelectedDeptId('');
                    setMakeLead(false);
                  }}
                  className="text-[#737686] hover:text-[#172554] text-base font-bold px-2 py-1"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="space-y-3">
              <p className="text-xs text-[#596174]">
                Ban hiện tại:{' '}
                <strong>{changeDeptModal.currentDeptName || 'Chưa phân Ban'}</strong>
              </p>

              <div>
                <label className="block text-xs font-bold text-[#172554] mb-1">
                  Chọn Ban mới:
                </label>
                <select
                  disabled={savingDept}
                  value={selectedDeptId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedDeptId(id);
                    const deptObj = availableDepartments.find((d: any) => d.id === id);
                    if (deptObj?.name === 'Chủ Tịch') {
                      setMakeLead(true);
                    }
                  }}
                  className="w-full rounded-xl border border-[#cbdbf5] px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] bg-white font-medium disabled:opacity-50"
                >
                  <option value="">⚠️ Đưa về trạng thái Chưa phân Ban</option>
                  {availableDepartments.map((d: any) => (
                    <option key={d.id} value={d.id}>
                      🏢 {d.name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedDeptId && (
                <div className="pt-2">
                  {availableDepartments.find((d: any) => d.id === selectedDeptId)?.name === 'Chủ Tịch' ? (
                    <div className="bg-amber-100/90 p-2.5 rounded-xl border border-amber-300 text-xs text-amber-900 font-semibold flex items-center gap-2">
                      <span>⭐</span>
                      <span>Ban Chủ Tịch chỉ có 1 người duy nhất. Thành viên này sẽ trở thành Chủ tịch mới của Chapter.</span>
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer bg-amber-50/80 p-2.5 rounded-xl border border-amber-200">
                      <input
                        type="checkbox"
                        checked={makeLead}
                        disabled={savingDept}
                        onChange={(e) => setMakeLead(e.target.checked)}
                        className="rounded text-amber-600 focus:ring-amber-500 w-4 h-4 cursor-pointer"
                      />
                      <span>👑 Bổ nhiệm làm Trưởng ban của Ban này</span>
                    </label>
                  )}
                  {availableDepartments.find((d: any) => d.id === selectedDeptId)?.name !== 'Chủ Tịch' && (
                    <p className="text-[11px] text-slate-500 mt-1 pl-6">
                      (Nếu được chọn, thành viên sẽ trở thành Trưởng ban mới, thay thế Trưởng ban cũ của ban đó)
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-[#eff4ff]">
              <Button
                variant="outline"
                size="sm"
                disabled={savingDept}
                onClick={() => {
                  setChangeDeptModal(null);
                  setSelectedDeptId('');
                  setMakeLead(false);
                }}
              >
                Hủy
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={savingDept}
                disabled={savingDept}
                onClick={handleSaveDepartment}
              >
                Lưu thay đổi
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL CẢNH BÁO XÁC NHẬN VÔ HIỆU HÓA TẤT CẢ */}
      {showConfirmDeactivate && (
        <Modal
          isOpen={showConfirmDeactivate}
          onClose={() => setShowConfirmDeactivate(false)}
          maxWidth="max-w-md"
        >
          <div className="space-y-4 p-2">
            <div className="flex items-center justify-between pb-2 border-b border-[#eff4ff]">
              <h2 className="text-base font-bold text-red-700">
                Xác nhận vô hiệu hóa tất cả
              </h2>
              <button
                type="button"
                onClick={() => setShowConfirmDeactivate(false)}
                className="text-[#737686] hover:text-[#172554] text-base font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>
            <div className="p-3 bg-red-50 text-red-900 rounded-xl border border-red-200 text-xs leading-relaxed">
              ⚠️ <strong>Cảnh báo:</strong> Thao tác này sẽ chuyển trạng thái của{' '}
              <strong>{parsedResult?.unmatchedCurrentMembers?.length || 0} thành viên</strong> sang{' '}
              <strong>Ngưng hoạt động (INACTIVE)</strong> và kết thúc tư cách Ban của họ trong Chapter này.
            </div>
            <p className="text-xs text-[#596174]">
              Họ sẽ không thể đăng nhập học và không tham gia vào các phép tính hoàn thành khóa học của nhiệm kỳ mới. Bạn có chắc chắn muốn thực hiện?
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-[#eff4ff]">
              <Button variant="outline" onClick={() => setShowConfirmDeactivate(false)}>
                Hủy
              </Button>
              <Button
                variant="primary"
                loading={deactivating}
                loadingText="Đang vô hiệu hóa..."
                className="bg-red-600 hover:bg-red-700 text-white font-bold"
                onClick={handleBulkDeactivate}
              >
                Vô hiệu hóa tất cả
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
