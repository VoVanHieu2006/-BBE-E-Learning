'use client';

import { useState, useEffect, useLayoutEffect, useCallback, FormEvent, useRef } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import { apiFetch, clearApiCache, getCachedApiData, getApiSessionKey, getApiUpdatedAt, getKnownTransferDeadline, getTabSnapshot, invalidateApiQueries, saveTabSnapshot } from '@/lib/api/client';
import { transitionDraftStore } from '@/lib/api/transition-draft-store';
import pilot from '../pilot.module.css';
import { ORDERED_CHAPTER_ROSTER, CHAPTER_ROSTER_COLUMNS } from '@/lib/departments';

const SAMPLE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1MA9pJ1E8oHEZe8d1g6j0Ns6JqLoOCdhSVSgOflO0JBI/edit?gid=0#gid=0';

/**
 * Chuyển đổi số nguyên sang số La Mã (Roman Numerals)
 */
function toRoman(num: number): string {
  if (!num || num <= 0) return '';
  const romanMap: [number, string][] = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let result = '';
  let n = Math.floor(num);
  for (const [val, roman] of romanMap) {
    while (n >= val) {
      result += roman;
      n -= val;
    }
  }
  return result;
}

/**
 * Định dạng nhãn nhiệm kỳ bao gồm cả số thường và số La Mã (Ví dụ: Nhiệm kỳ 6 - VI)
 */
function formatTermBadge(termNum?: number | null): string {
  if (!termNum || termNum <= 0) return '';
  return `Nhiệm kỳ ${termNum} - ${toRoman(termNum)}`;
}

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

    let interval: ReturnType<typeof setInterval> | undefined;
    const visibility = () => {
      if(interval)clearInterval(interval);
      if(document.visibilityState==='visible'){calculate();interval=setInterval(calculate,1000);}
    };
    visibility();
    document.addEventListener('visibilitychange',visibility);
    return () => { if(interval)clearInterval(interval);document.removeEventListener('visibilitychange',visibility); };
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
  const [viewMode, setViewMode] = useState<'current' | 'history'>(() => getTabSnapshot<'current' | 'history'>('term-transition:view') || 'current');
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const [draftError, setDraftError] = useState<string | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const [refreshingView, setRefreshingView] = useState(false);
  const [syncTimes, setSyncTimes] = useState<{current?:number;history?:number}>({});
  const scopeRef = useRef(getApiSessionKey());
  const deadlineRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyDueAttemptRef = useRef<number | null>(null);

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
    deadlineRetryRef.current = setTimeout(() => {
      if (user?.chapterId && document.visibilityState==='visible') {
        loadCurrentRoster(user.chapterId, true);
      }
    }, 2500);
  }, [user?.chapterId]);
  useEffect(() => () => { if (deadlineRetryRef.current) clearTimeout(deadlineRetryRef.current); }, [viewMode]);
  useEffect(() => { saveTabSnapshot('term-transition:view',viewMode); },[viewMode]);
  useEffect(() => {
    if(viewMode!=='history' || !user?.chapterId)return;
    let timer:ReturnType<typeof setTimeout> | undefined;
    const arm=()=>{
      if(timer)clearTimeout(timer);
      if(document.visibilityState!=='visible')return;
      const deadline=getKnownTransferDeadline(user.chapterId);
      if(deadline===null){historyDueAttemptRef.current=null;return;}
      const delay=deadline-Date.now();
      if(delay<=0){
        if(historyDueAttemptRef.current===deadline)return;
        historyDueAttemptRef.current=deadline;
        invalidateChapterViews();void loadHistory(user.chapterId,true);return;
      }
      timer=setTimeout(arm,Math.min(delay,2147483647));
    };
    arm();document.addEventListener('visibilitychange',arm);
    return()=>{if(timer)clearTimeout(timer);document.removeEventListener('visibilitychange',arm);};
  },[viewMode,user?.chapterId,historyList]);

  // Owner data is updated in memory at commit time; persistence is debounced and flushed on departure.
  useLayoutEffect(() => {
    if (!user?.id || !user?.chapterId || scopeRef.current !== getApiSessionKey()) return;
    transitionDraftStore.update(user.id,user.chapterId,{sheetUrl:rosterUrl,parsedResult,effectiveAt,termNumber:selectedTermNumber});
    const flush = () => { const error=transitionDraftStore.flush(user.id,user.chapterId); setDraftError(error); return error; };
    const timer=setTimeout(flush,300);
    return () => clearTimeout(timer);
  },[user?.id,user?.chapterId,rosterUrl,parsedResult,effectiveAt,selectedTermNumber]);
  useEffect(() => {
    if(!user?.id || !user?.chapterId)return;
    const flush = () => { const error=transitionDraftStore.flush(user.id,user.chapterId);setDraftError(error);return error; };
    const leave = (event:BeforeUnloadEvent) => { if(flush()){event.preventDefault();event.returnValue='';} };
    const hidden = () => { if(document.visibilityState==='hidden')flush(); };
    window.addEventListener('pagehide',flush);
    window.addEventListener('beforeunload',leave);
    document.addEventListener('visibilitychange',hidden);
    return () => {flush();window.removeEventListener('pagehide',flush);window.removeEventListener('beforeunload',leave);document.removeEventListener('visibilitychange',hidden); };
  },[user?.id,user?.chapterId]);

  function invalidateChapterViews(applied = false, membersChanged = false) {
    if(!user?.chapterId)return;
    const base=`/api/v1/chapters/${user.chapterId}`;
    const paths=[`${base}/current-roster`,`${base}/reorganizations`];
    if(applied||membersChanged)paths.push(`${base}/dashboard/members`,`${base}/dashboard/courses`);
    invalidateApiQueries(paths);
    if(applied){clearApiCache('/api/v1/learning/me');clearApiCache('/api/v1/courses');clearApiCache('/api/v1/leaderboard');}
  }
  function reconcileVisibleTransfer() {
    if(!user?.chapterId || scopeRef.current!==getApiSessionKey())return;
    invalidateChapterViews();
    if(viewModeRef.current==='current')void loadCurrentRoster(user.chapterId,true);
    else void loadHistory(user.chapterId,true);
  }

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
      if (viewMode === 'history') loadHistory(currentUser.chapterId);
      else loadCurrentRoster(currentUser.chapterId);
      // Khôi phục bản nháp sheet đã import nếu có
      try {
        const savedDraft = transitionDraftStore.read(currentUser.id,currentUser.chapterId);
        if (savedDraft) {
          setParsedResult(savedDraft.parsedResult);
          setRosterUrl(savedDraft.sheetUrl);
          setEffectiveAt(savedDraft.effectiveAt);
          setSelectedTermNumber(savedDraft.termNumber);
        }
      } catch { setDraftError('Không đọc được bản nháp trên thiết bị. Vui lòng kiểm tra quyền lưu trữ.'); }
    }
  }, []);

  async function loadCurrentRoster(chapterId: string, force = false) {
    const url=`/api/v1/chapters/${chapterId}/current-roster`;
    if (!getCachedApiData(url) && rosterData.length===0) setRosterLoading(true);
    if(force)setRefreshingView(true);
    const res = await apiFetch(`/api/v1/chapters/${chapterId}/current-roster`, { noCache: force });
    if(scopeRef.current!==getApiSessionKey())return;
    if (res.ok && res.data) {
      setRosterData(res.data.roster || []);
      setUnassignedMembers(res.data.unassignedMembers || []);
      setAvailableDepartments(res.data.departments || []);
      setScheduledBatch(res.data.scheduledBatch || null);
      setCurrentTermNumber(res.data.currentTermNumber ?? null);
      setSyncTimes(times=>({...times,current:getApiUpdatedAt(url) || Date.now()}));
      setViewError(null);
    }
    if(!res.ok && res.error?.code!=='STALE_REQUEST')setViewError(res.error?.message || 'Chưa cập nhật được sơ đồ. Vui lòng thử lại.');
    setRosterLoading(false);
    setRefreshingView(false);
  }

  // Tự động gợi ý và ràng buộc số thứ tự nhiệm kỳ tiếp theo
  useEffect(() => {
    // Restore the owner's draft and resolve the roster before suggesting a
    // default. A mount-time closure must never overwrite a restored selection.
    if (!mounted || rosterLoading) return;
    if (currentTermNumber) {
      setSelectedTermNumber((prev) => {
        if (!prev || typeof prev !== 'number') {
          return currentTermNumber + 1;
        }
        return prev;
      });
    } else {
      setSelectedTermNumber(prev => prev === '' ? 1 : prev);
    }
  }, [currentTermNumber, rosterLoading, mounted]);

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
    const url=`/api/v1/chapters/${chapterId}/reorganizations`;
    if(!getCachedApiData(url) && historyList.length===0)setHistoryLoading(true);
    if(force)setRefreshingView(true);
    const res = await apiFetch(`/api/v1/chapters/${chapterId}/reorganizations`, { noCache: force });
    if(scopeRef.current!==getApiSessionKey())return;
    if (res.ok && res.data) {
      setHistoryList(res.data.items || []);
      setSyncTimes(times=>({...times,history:getApiUpdatedAt(url) || Date.now()}));
      setViewError(null);
    }
    setHistoryLoading(false);
    setRefreshingView(false);
    if(!res.ok && res.error?.code!=='STALE_REQUEST')setViewError(res.error?.message || 'Chưa cập nhật được lịch sử. Vui lòng thử lại.');
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
    notify(
      'success',
      `Đã phân tích thành công Google Sheet: ${res.data.summary?.matchedInChapter || 0} thành viên hợp lệ trong Chapter!`
    );
  };

  // Xóa bản nháp sheet đang xem
  const handleClearDraft = () => {
    setParsedResult(null);
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

      invalidateChapterViews(false,true);
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

      invalidateChapterViews(false,true);
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

    invalidateChapterViews(false,true);
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

    invalidateChapterViews(false,true);
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

    invalidateChapterViews(false,true);
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
        invalidateChapterViews(res.data?.success === true || res.data?.appliedImmediately === true || res.data?.item?.status === 'APPLIED');
      } else {
        notify('error', res.error?.message || 'Lỗi áp dụng chuyển giao nhiệm kỳ.');
      }
    } catch {
      notify('error', 'Không xác nhận được kết quả; hãy tải lại trạng thái trước khi thử lại.');
    } finally {
      setApplyingBatch(false);
      setActionLoading(null);
      transferActionRef.current = false;
      reconcileVisibleTransfer();
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
        invalidateChapterViews();
      } else {
        notify('error', res.error?.message || 'Lỗi hủy đợt chuyển giao.');
      }
    } catch {
      notify('error', 'Không xác nhận được kết quả; hãy tải lại trạng thái trước khi thử lại.');
    } finally {
      setCancelingBatch(false);
      setActionLoading(null);
      transferActionRef.current = false;
      reconcileVisibleTransfer();
    }
  };

  // Xác nhận chuyển giao nhiệm kỳ
  const handleConfirmTransition = async () => {
    if (!user?.chapterId || !parsedResult?.items || !effectiveAt) return;
    if (!selectedTermNumber) {
      notify('error', 'Vui lòng chọn số thứ tự nhiệm kỳ chuyển giao trước khi xác nhận.');
      return;
    }
    if(currentTermNumber && Number(selectedTermNumber)<=currentTermNumber){
      notify('error','Nhiệm kỳ hiện tại đã thay đổi. Hãy chọn nhiệm kỳ lớn hơn trước khi xác nhận; bản nháp của bạn vẫn được giữ.');
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
        // The owner-scoped empty draft is persisted by the draft effect. Legacy data stays untouched.
      }
      setParsedResult(null);
      notify(
        'success',
        res.data?.appliedImmediately
          ? 'Chuyển giao nhiệm kỳ thành công! Hệ thống đã cập nhật Ban và LT ngay lập tức. Các thành viên không có trong sheet đã chuyển thành Chưa phân Ban.'
          : 'Đã lên lịch chuyển giao nhiệm kỳ thành công! Đợt chuyển giao đã được lưu bên dưới và sẽ tự động áp dụng khi đến ngày hiệu lực.'
      );

      invalidateChapterViews(res.data?.appliedImmediately === true || res.data?.item?.status === 'APPLIED');
    } catch {
      notify('error', 'Không xác nhận được kết quả; hãy tải lại trạng thái trước khi thử lại.');
    } finally {
      setScheduling(false);
      transferActionRef.current = false;
      reconcileVisibleTransfer();
    }
  };

  return (
    <div className={`${pilot.pilot} space-y-8 max-w-7xl pb-20`}>
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
          <Button variant="outline" size="sm" loading={refreshingView} disabled={refreshingView} onClick={() => {
            if(!user?.chapterId)return;
            if(viewMode==='current')void loadCurrentRoster(user.chapterId,true);
            else void loadHistory(user.chapterId,true);
          }}>Làm mới</Button>
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
          {!scheduledBatch ? (
            <Button
              variant="primary"
              onClick={scrollToImport}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            >
              📥 Nạp Google Sheet nhiệm kỳ mới
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 text-[#2563EB] rounded-xl text-xs font-bold border border-blue-200">
              📅 Đã có 1 đợt chuyển giao lên lịch
            </span>
          )}
        </div>
      </div>

      {draftError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{draftError}<button type="button" className="ml-3 underline" onClick={()=>setDraftError(transitionDraftStore.flush(user.id,user.chapterId))}>Thử lưu lại</button></div>}
      {viewError && <p role="alert" className="text-sm text-red-700">{viewError} Dữ liệu đã tải được giữ lại.</p>}
      {syncTimes[viewMode] && <p className="text-xs text-[#596174]">Đồng bộ {viewMode==='current'?'sơ đồ':'lịch sử'}: {new Intl.DateTimeFormat('vi-VN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(syncTimes[viewMode])}</p>}
      {/* VIEW MODE: Nhiệm kỳ hiện tại (8 Cột rộng rãi + Cuộn ngang) */}
      {viewMode === 'current' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-[#172554] flex items-center gap-2 flex-wrap">
                {displayTermNumber ? (
                  <>
                    <span>🏛️ Sơ đồ Phân ban Chapter</span>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-blue-100 text-[#2563EB] text-xs font-bold border border-blue-200">
                      {formatTermBadge(displayTermNumber)}
                    </span>
                  </>
                ) : (
                  <span>🏛️ Sơ đồ Phân ban nhiệm kỳ hiện tại</span>
                )}
              </h2>
              <p className="text-xs text-[#737686] mt-0.5">
                Người đứng đầu mỗi Ban là Trưởng ban. Bấm vào thành viên để xem chi tiết hoặc đổi Ban. Bảng cuộn ngang ↔ để xem đủ 8 cột.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (user?.chapterId) {
                  loadCurrentRoster(user.chapterId, true);
                  notify('success', 'Đang tải lại sơ đồ và đồng bộ trạng thái mới nhất...');
                }
              }}
              loading={rosterLoading || refreshingView}
              loadingText="Đang tải lại sơ đồ..."
              disabled={rosterLoading || refreshingView}
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
                <div className="grid grid-cols-8 gap-3.5 min-w-[1900px]">
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-amber-200/60 pb-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-amber-900 flex items-center gap-1.5">
                  <span>⚠️ Thành viên chưa có Ban ({unassignedMembers.length})</span>
                </h3>
                <p className="text-xs text-[#737686] mt-0.5">
                  Các thành viên thuộc Chapter nhưng chưa phân ban (bao gồm thành viên không có trong sheet sau khi chuyển giao). Bạn có thể gán Ban hoặc vô hiệu hóa tài khoản.
                </p>
              </div>

              {unassignedMembers.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="bg-red-50 text-red-700 hover:bg-red-100 border-red-300 font-bold text-xs shrink-0 self-start sm:self-auto"
                  onClick={() => {
                    setDeactivateText('');
                    setShowBulkUnassignedModal(true);
                  }}
                >
                  ⛔ Vô hiệu hóa tất cả ({unassignedMembers.length})
                </Button>
              )}
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
                              onClick={() => {
                                setDeactivateText('');
                                setSingleDeactivateModal({ userId: m.userId, displayName: m.displayName });
                              }}
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
                      <span>📅</span> Đợt chuyển giao {scheduledBatch.termNumber ? formatTermBadge(scheduledBatch.termNumber) : 'nhiệm kỳ tiếp theo'} (Đã lên lịch)
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
                  {scheduledBatch.lastError && <p role="alert" className="text-xs text-red-700">Chưa áp dụng thành công: {scheduledBatch.lastError}. Bản nhập vẫn được giữ; có thể thử áp dụng lại hoặc hủy lịch.</p>}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => setShowApplyBatchModal(true)}
                    loading={applyingBatch}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                  >
                    ⚡ Áp dụng ngay bây giờ
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowCancelBatchModal(true)}
                    loading={cancelingBatch}
                    className="text-red-600 border-red-200 hover:bg-red-50"
                  >
                    ✕ Hủy lịch này
                  </Button>
                </div>
              </div>

              {/* Sơ đồ 8 cột dự kiến */}
              <div className="overflow-x-auto pb-2">
                <div className="grid grid-cols-8 gap-3 min-w-[1900px]">
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
              CHỈ HIỂN THỊ KHI CHƯA CÓ ĐỢT CHUYỂN GIAO NÀO ĐANG LÊN LỊCH
             ═══════════════════════════════════════════════════════════════════ */}
          {!scheduledBatch && (
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
                  Đọc danh sách phân ban từ Google Sheet, xem trước 8 cột nhiệm kỳ mới và đối soát nhân sự trước khi áp dụng.
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
                Google Sheet gồm đúng 8 cột: <strong>Chủ Tịch, Ban Định Hướng, Ban Thành Viên, Ban Thư Ký, Ban Khách Mời, Ban TT&SK, Ban Nội Dung, Ban Chất Lượng</strong>.
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
                  <div>
                    <label htmlFor="transition-term-number" className="block text-xs font-bold text-[#172554] mb-1">
                      Nhiệm kỳ chuyển giao *
                    </label>
                    <select
                      id="transition-term-number"
                      required
                      value={selectedTermNumber}
                      onChange={(e) => setSelectedTermNumber(e.target.value ? Number(e.target.value) : '')}
                      className="w-full rounded-xl border border-[#cbdbf5] px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] bg-white font-medium text-[#172554]"
                    >
                      <option value="">-- Chọn số thứ tự nhiệm kỳ --</option>
                      {selectedTermNumber!=='' && currentTermNumber && selectedTermNumber<=currentTermNumber && <option value={selectedTermNumber} disabled>{formatTermBadge(selectedTermNumber)} — cần chọn lại</option>}
                      {termOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-[#737686] mt-1">
                      {currentTermNumber
                        ? `Nhiệm kỳ hiện tại: ${formatTermBadge(currentTermNumber)} (Chỉ được chọn lớn hơn)`
                        : 'Chọn số nhiệm kỳ cho đợt chuyển giao này'}
                    </p>
                  </div>

                  <div>
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

                {/* 1. SƠ ĐỒ DỰ KIẾN: 8 Cột Nhiệm kỳ mới */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold text-[#172554] flex items-center gap-1.5">
                      <span>🏛️ 8 Cột Nhiệm kỳ mới dự kiến</span>
                      <span className="text-xs font-normal text-[#737686]">
                        (Phân bổ theo sheet, người đầu in nổi bật là LT / Chủ tịch)
                      </span>
                    </h3>
                  </div>

                  <div className="overflow-x-auto pb-4">
                    <div className="grid grid-cols-8 gap-3 min-w-[1900px]">
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
                        onClick={() => {
                          setDeactivateText('');
                          setShowConfirmDeactivate(true);
                        }}
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
                                  onClick={() => {
                                    setDeactivateText('');
                                    setSingleDeactivateModal({ userId: item.userId, displayName: item.displayName });
                                  }}
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
                          // Legacy drafts have unknown ownership and must remain untouched.
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
          )}
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
              onClick={() => {
                if (user?.chapterId) {
                  loadHistory(user.chapterId, true);
                  notify('success', 'Đang tải lại lịch sử chuyển giao nhiệm kỳ...');
                }
              }}
              loading={historyLoading || refreshingView}
              loadingText="Đang tải lại..."
              disabled={historyLoading || refreshingView}
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
              {historyList.map((term: any) => {
                const dateObj = term.appliedAt || term.effectiveAt ? new Date(term.appliedAt || term.effectiveAt) : null;
                const dateStr = dateObj && !isNaN(dateObj.getTime())
                  ? dateObj.toLocaleString('vi-VN')
                  : 'Chưa xác định';
                const totalCount = term.itemCount ?? term.items?.length ?? 0;
                const termTitle = term.termNumber
                  ? `Sơ đồ 7 Ban ${formatTermBadge(term.termNumber)}`
                  : 'Sơ đồ 7 Ban nhiệm kỳ chuyển giao';

                return (
                  <div
                    key={term.id}
                    className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#f8f9ff] px-3 rounded-xl transition"
                  >
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-[#172554] text-sm">
                          {termTitle}
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
                      {term.last_error && <p role="alert" className="mt-2 text-xs text-red-700">Chưa áp dụng được (lần {term.apply_attempts}): {term.last_error}. Hệ thống sẽ retry; có thể bấm áp dụng lại.</p>}
                      <div className="text-xs text-[#737686] mt-1 space-y-0.5">
                        <p>
                          <span className="font-medium text-slate-700">Đã áp dụng lúc:</span> {dateStr}
                        </p>
                        <p>
                          <span className="font-medium text-slate-700">Tổng nhân sự phân ban:</span> <strong>{totalCount}</strong> thành viên
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
                    </div>

                    <Button size="sm" variant="outline" onClick={() => setSelectedHistoryTerm(term)}>
                      👁️ Xem cơ cấu
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* MODAL CHI TIẾT LỊCH SỬ MỘT NHIỆM KỲ */}
      {selectedHistoryTerm && (
        <Modal
          motion
          isOpen={Boolean(selectedHistoryTerm)}
          onClose={() => setSelectedHistoryTerm(null)}
          maxWidth="max-w-6xl"
        >
          <div className="space-y-4 p-2">
            <div className="flex items-center justify-between border-b border-[#eff4ff] pb-3">
              <div>
                <h3 className="text-lg font-bold text-[#172554]">
                  {selectedHistoryTerm.termNumber
                    ? `Cơ cấu nhân sự ${formatTermBadge(selectedHistoryTerm.termNumber)}`
                    : 'Cơ cấu nhân sự nhiệm kỳ'}
                  {selectedHistoryTerm.appliedAt || selectedHistoryTerm.effectiveAt
                    ? ` (${new Date(selectedHistoryTerm.appliedAt || selectedHistoryTerm.effectiveAt).toLocaleDateString('vi-VN')})`
                    : ''}
                </h3>
                <p className="text-xs text-[#737686]">
                  Tổng {selectedHistoryTerm.itemCount ?? selectedHistoryTerm.items?.length ?? 0} thành viên được phân bổ
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
              <div className="grid grid-cols-8 gap-3 min-w-[1900px]">
                {ORDERED_CHAPTER_ROSTER.map((banName) => {
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
          motion
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

      {/* MODAL CẢNH BÁO XÁC NHẬN VÔ HIỆU HÓA TẤT CẢ (TRONG SHEET DỰ KIẾN) */}
      {showConfirmDeactivate && (
        <Modal
          motion
          isOpen={showConfirmDeactivate}
          onClose={() => {
            setShowConfirmDeactivate(false);
            setDeactivateText('');
          }}
          maxWidth="max-w-md"
        >
          <div className="space-y-4 p-2">
            <div className="flex items-center justify-between pb-2 border-b border-[#eff4ff]">
              <h2 className="text-base font-bold text-red-700">
                Xác nhận vô hiệu hóa tất cả
              </h2>
              <button
                type="button"
                onClick={() => {
                  setShowConfirmDeactivate(false);
                  setDeactivateText('');
                }}
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

            <div className="p-3 bg-red-50/80 border border-red-200 rounded-xl space-y-1.5">
              <label className="block text-xs font-semibold text-red-950">
                Để xác nhận, vui lòng nhập chính xác chữ <strong className="text-red-600 underline font-extrabold">&ldquo;vô hiệu hóa&rdquo;</strong> vào ô bên dưới:
              </label>
              <input
                type="text"
                value={deactivateText}
                onChange={(e) => setDeactivateText(e.target.value)}
                placeholder="vô hiệu hóa"
                className="w-full px-3 py-2 text-xs border border-red-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#eff4ff]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowConfirmDeactivate(false);
                  setDeactivateText('');
                }}
              >
                Hủy
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={deactivating}
                loadingText="Đang vô hiệu hóa..."
                disabled={
                  deactivating ||
                  deactivateText.trim().toLowerCase() !== 'vô hiệu hóa'
                }
                className="bg-red-600 hover:bg-red-700 text-white font-bold"
                onClick={handleBulkDeactivate}
              >
                Vô hiệu hóa tất cả
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL CẢNH BÁO XÁC NHẬN VÔ HIỆU HÓA 1 THÀNH VIÊN RIÊNG LẺ */}
      {singleDeactivateModal && (
        <Modal
          motion
          isOpen={Boolean(singleDeactivateModal)}
          onClose={() => {
            setSingleDeactivateModal(null);
            setDeactivateText('');
          }}
          maxWidth="max-w-md"
        >
          <div className="space-y-4 p-2">
            <div className="flex items-center justify-between pb-2 border-b border-[#eff4ff]">
              <h2 className="text-base font-bold text-red-700">
                Xác nhận vô hiệu hóa thành viên
              </h2>
              <button
                type="button"
                onClick={() => {
                  setSingleDeactivateModal(null);
                  setDeactivateText('');
                }}
                className="text-[#737686] hover:text-[#172554] text-base font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>
            <div className="p-3 bg-red-50 text-red-900 rounded-xl border border-red-200 text-xs leading-relaxed space-y-1">
              <p>
                ⚠️ <strong>Cảnh báo:</strong> Bạn đang thao tác vô hiệu hóa tài khoản của{' '}
                <strong>{singleDeactivateModal.displayName}</strong>.
              </p>
              <p className="text-red-700">
                Tài khoản này sẽ bị chặn đăng nhập và ngừng toàn bộ quyền truy cập học tập trên hệ thống BBE.
              </p>
            </div>

            <div className="p-3 bg-red-50/80 border border-red-200 rounded-xl space-y-1.5">
              <label className="block text-xs font-semibold text-red-950">
                Để xác nhận, vui lòng nhập chính xác chữ <strong className="text-red-600 underline font-extrabold">&ldquo;vô hiệu hóa&rdquo;</strong> vào ô bên dưới:
              </label>
              <input
                type="text"
                value={deactivateText}
                onChange={(e) => setDeactivateText(e.target.value)}
                placeholder="vô hiệu hóa"
                className="w-full px-3 py-2 text-xs border border-red-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#eff4ff]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSingleDeactivateModal(null);
                  setDeactivateText('');
                }}
              >
                Hủy
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={deactivatingUserId === singleDeactivateModal.userId}
                loadingText="Đang xử lý..."
                disabled={
                  Boolean(deactivatingUserId) ||
                  deactivateText.trim().toLowerCase() !== 'vô hiệu hóa'
                }
                className="bg-red-600 hover:bg-red-700 text-white font-bold"
                onClick={() =>
                  handleIndividualDeactivate(
                    singleDeactivateModal.userId,
                    singleDeactivateModal.displayName
                  )
                }
              >
                Xác nhận vô hiệu hóa
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL CẢNH BÁO XÁC NHẬN VÔ HIỆU HÓA TẤT CẢ THÀNH VIÊN CHƯA CÓ BAN */}
      {showBulkUnassignedModal && (
        <Modal
          motion
          isOpen={showBulkUnassignedModal}
          onClose={() => {
            setShowBulkUnassignedModal(false);
            setDeactivateText('');
          }}
          maxWidth="max-w-md"
        >
          <div className="space-y-4 p-2">
            <div className="flex items-center justify-between pb-2 border-b border-[#eff4ff]">
              <h2 className="text-base font-bold text-red-700">
                Xác nhận vô hiệu hóa tất cả thành viên chưa có Ban
              </h2>
              <button
                type="button"
                onClick={() => {
                  setShowBulkUnassignedModal(false);
                  setDeactivateText('');
                }}
                className="text-[#737686] hover:text-[#172554] text-base font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>
            <div className="p-3 bg-red-50 text-red-900 rounded-xl border border-red-200 text-xs leading-relaxed space-y-1">
              <p>
                ⚠️ <strong>Cảnh báo:</strong> Thao tác này sẽ vô hiệu hóa toàn bộ{' '}
                <strong>{unassignedMembers.length} thành viên</strong> chưa có Ban trong danh sách.
              </p>
              <p className="text-red-700">
                Tất cả tài khoản này sẽ bị chuyển sang trạng thái <strong>Ngưng hoạt động (INACTIVE)</strong>, chặn đăng nhập học tập và kết thúc vai trò trong Chapter.
              </p>
            </div>

            <div className="p-3 bg-red-50/80 border border-red-200 rounded-xl space-y-1.5">
              <label className="block text-xs font-semibold text-red-950">
                Để xác nhận, vui lòng nhập chính xác chữ <strong className="text-red-600 underline font-extrabold">&ldquo;vô hiệu hóa&rdquo;</strong> vào ô bên dưới:
              </label>
              <input
                type="text"
                value={deactivateText}
                onChange={(e) => setDeactivateText(e.target.value)}
                placeholder="vô hiệu hóa"
                className="w-full px-3 py-2 text-xs border border-red-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#eff4ff]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowBulkUnassignedModal(false);
                  setDeactivateText('');
                }}
              >
                Hủy
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={deactivating}
                loadingText="Đang vô hiệu hóa..."
                disabled={
                  deactivating ||
                  deactivateText.trim().toLowerCase() !== 'vô hiệu hóa'
                }
                className="bg-red-600 hover:bg-red-700 text-white font-bold"
                onClick={handleBulkDeactivateUnassigned}
              >
                Vô hiệu hóa tất cả ({unassignedMembers.length})
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL CẢNH BÁO XÁC NHẬN ÁP DỤNG NGAY CHUYỂN GIAO ĐÃ LÊN LỊCH */}
      {showApplyBatchModal && scheduledBatch && (
        <Modal
          motion
          isOpen={showApplyBatchModal}
          onClose={() => setShowApplyBatchModal(false)}
          maxWidth="max-w-md"
        >
          <div className="space-y-4 p-2">
            <div className="flex items-center justify-between pb-2 border-b border-[#eff4ff]">
              <h2 className="text-base font-bold text-[#172554] flex items-center gap-2">
                <span>⚡</span> Xác nhận áp dụng chuyển giao ngay?
              </h2>
              <button
                type="button"
                onClick={() => setShowApplyBatchModal(false)}
                className="text-[#737686] hover:text-[#172554] text-base font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>
            <div className="p-3.5 bg-amber-50 text-amber-900 rounded-xl border border-amber-200 text-xs leading-relaxed space-y-1.5">
              <p className="font-bold text-amber-950">
                ⚠️ Cảnh báo áp dụng trước thời hạn:
              </p>
              <p>
                Đợt chuyển giao nhiệm kỳ này đang được lên lịch hiệu lực vào lúc{' '}
                <strong>{new Date(scheduledBatch.effectiveAt).toLocaleString('vi-VN')}</strong>.
              </p>
              <p>
                Nếu bạn chọn <strong>&ldquo;Áp dụng ngay&rdquo;</strong>, toàn bộ sơ đồ 7 Ban, các phân công Trưởng ban (LT) và nhân sự của <strong>{scheduledBatch.totalItems} thành viên</strong> sẽ được áp dụng trực tiếp vào hệ thống ngay lúc này mà không cần chờ đến lịch hẹn.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-[#eff4ff]">
              <Button
                variant="outline"
                size="sm"
                disabled={applyingBatch}
                onClick={() => setShowApplyBatchModal(false)}
              >
                Hủy bỏ
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={applyingBatch}
                loadingText="Đang áp dụng..."
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                onClick={() => handleApplyScheduledBatch(scheduledBatch.id)}
              >
                ⚡ Xác nhận áp dụng ngay
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL CẢNH BÁO XÁC NHẬN HỦY ĐỢT CHUYỂN GIAO ĐÃ LÊN LỊCH */}
      {showCancelBatchModal && scheduledBatch && (
        <Modal
          motion
          isOpen={showCancelBatchModal}
          onClose={() => setShowCancelBatchModal(false)}
          maxWidth="max-w-md"
        >
          <div className="space-y-4 p-2">
            <div className="flex items-center justify-between pb-2 border-b border-[#eff4ff]">
              <h2 className="text-base font-bold text-red-700 flex items-center gap-2">
                <span>⚠️</span> Xác nhận hủy đợt chuyển giao?
              </h2>
              <button
                type="button"
                onClick={() => setShowCancelBatchModal(false)}
                className="text-[#737686] hover:text-[#172554] text-base font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>
            <div className="p-3.5 bg-red-50 text-red-900 rounded-xl border border-red-200 text-xs leading-relaxed space-y-1.5">
              <p className="font-bold text-red-950">
                ⚠️ Cảnh báo hủy chuyển giao đã lên lịch:
              </p>
              <p>
                Đợt chuyển giao nhiệm kỳ (hiệu lực {new Date(scheduledBatch.effectiveAt).toLocaleString('vi-VN')}) gồm <strong>{scheduledBatch.totalItems} thành viên</strong> sẽ bị hủy bỏ hoàn toàn khỏi hệ thống.
              </p>
              <p className="text-red-700 font-medium">
                Sau khi hủy, khu vực nạp Google Sheet sẽ hiển thị lại để bạn có thể tải lên và lên lịch đợt mới khi cần.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-[#eff4ff]">
              <Button
                variant="outline"
                size="sm"
                disabled={cancelingBatch}
                onClick={() => setShowCancelBatchModal(false)}
              >
                Giữ lại lịch
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={cancelingBatch}
                loadingText="Đang hủy..."
                className="bg-red-600 hover:bg-red-700 text-white font-bold"
                onClick={() => handleCancelScheduledBatch(scheduledBatch.id)}
              >
                ✕ Xác nhận hủy lịch
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
