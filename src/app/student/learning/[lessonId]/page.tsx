'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import YouTubePlayer from '@/components/YouTubePlayer';
import LessonComments from '@/components/lesson/LessonComments';
import StarRewardCelebration from '@/components/StarRewardCelebration';
import { apiFetch, ApiResponse, clearApiCache } from '@/lib/api/client';

export default function LearningVideoPage({ params }: { params: { lessonId: string } }) {
  const [currentLessonId, setCurrentLessonId] = useState(params.lessonId);
  const [user, setUser] = useState<any>(null);
  const [lesson, setLesson] = useState<any>(null);
  const [lessonError, setLessonError] = useState<{ code: string; message: string; status: number } | null>(null);
  const [progress, setProgress] = useState<any>(null);
  const seenRewardKeysRef = useRef<Set<string>>(new Set());
  const durationMismatchRef = useRef(false);
  useEffect(() => {
    durationMismatchRef.current = false;
  }, [currentLessonId]);
  const [starReward, setStarReward] = useState<number | null>(null);
  const [starBalance, setStarBalance] = useState<number | null>(null);
  const [courseData, setCourseData] = useState<any>(null);
  const [courseProgress, setCourseProgress] = useState<any>(null);
  const [loadingLesson, setLoadingLesson] = useState(true);
  const [isSwitchingLesson, setIsSwitchingLesson] = useState(false);
  const [loadingCourse, setLoadingCourse] = useState(true);
  const [token, setToken] = useState<string>('');
  const [downloadLoading, setDownloadLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'desc' | 'docs' | 'comments' | 'quiz'>('desc');
  const [openSessions, setOpenSessions] = useState<Record<string, boolean>>({});
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const currentLessonIdRef = useRef(currentLessonId);
  currentLessonIdRef.current = currentLessonId;
  const pendingLessonIdRef = useRef<string | null>(null);
  const switchReqIdRef = useRef(0);
  const switchAbortRef = useRef<AbortController | null>(null);

  const showToast = (type: 'success' | 'error' | 'info', message: string, title?: string) => {
    setToast({ type, message, title });
  };

  useEffect(() => {
    let t = '';
    if (typeof window !== 'undefined') {
      t = localStorage.getItem('accessToken') || '';
      const u = localStorage.getItem('user');
      if (u) {
        try {
          setUser(JSON.parse(u));
        } catch {}
      }
    }
    setToken(t);
    loadInitialData(params.lessonId, t);
  }, [params.lessonId]);

  // Lắng nghe sự kiện popstate cho các nút Back / Forward trên trình duyệt
  useEffect(() => {
    const handlePopState = () => {
      const match = window.location.pathname.match(/\/student\/learning\/([^/]+)/);
      if (match && match[1] && match[1] !== currentLessonId) {
        switchLesson(match[1], { skipPushHistory: true });
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [currentLessonId]);

  // Initial load: Fetch lesson details + full course outline + course progress
  async function loadInitialData(lessonId: string, authToken?: string) {
    setLoadingLesson(true);
    setLoadingCourse(true);
    setLessonError(null);
    const activeToken = authToken || (typeof window !== 'undefined' ? localStorage.getItem('accessToken') : '') || '';

    const lessonRes = await apiFetch(`/api/v1/lessons/${lessonId}`);
    if (lessonRes.ok && lessonRes.data) {
      const lData = lessonRes.data;
      setLesson(lData);
      setLessonError(null);

      const courseId = lData.session?.courseId;
      if (courseId) {
        const [courseRes, lessonProgRes] = await Promise.all([
          apiFetch(`/api/v1/courses/${courseId}`),
          activeToken ? apiFetch(`/api/v1/lessons/${lessonId}/progress`, { noCache: true }) : Promise.resolve<ApiResponse<any>>({ ok: false, status: 0 }),
        ]);
        // The course-wide progress and Star balance are secondary panels. Load
        // them after the lesson/video dependencies so they never block playback.
        if (activeToken) {
          void apiFetch(`/api/v1/courses/${courseId}/my-progress`, { noCache: true })
            .then((progListRes) => {
              if (progListRes.ok && progListRes.data) setCourseProgress(progListRes.data);
            })
            .catch(() => {});
          void apiFetch(`/api/v1/stars/me?balanceOnly=1`, { noCache: true })
            .then((starRes) => {
              if (starRes.ok && typeof starRes.data?.balance === 'number') setStarBalance(starRes.data.balance);
            })
            .catch(() => {});
        }

        if (courseRes.ok && courseRes.data) {
          setCourseData(courseRes.data);
          // Default all sessions open
          const initOpen: Record<string, boolean> = {};
          (courseRes.data.sessions || []).forEach((s: any) => {
            initOpen[s.sessionId || s.id] = true;
          });
          setOpenSessions(initOpen);
        }

        if (lessonProgRes && lessonProgRes.ok && lessonProgRes.data) {
          setProgress({ ...lessonProgRes.data, lessonId });
        } else {
          setProgress({ lessonId, completed: false, progressPercentage: 0 });
        }

      }
    } else {
      setLesson(null);
      if (!activeToken && (lessonRes.status === 401 || lessonRes.status === 403)) {
        if (typeof window !== 'undefined') {
          window.location.href = '/login?callbackUrl=' + encodeURIComponent(window.location.pathname);
          return;
        }
      }
      setLessonError({
        code: lessonRes.error?.code || (lessonRes.status === 404 ? 'LessonNotFound' : 'AccessDenied'),
        message: lessonRes.error?.message || (lessonRes.status === 404 ? 'Bài học không tồn tại' : 'Bạn chưa có quyền truy cập bài học này.'),
        status: lessonRes.status || 403,
      });
    }

    setLoadingLesson(false);
    setLoadingCourse(false);
  }

  // Silent progress revalidation triggered on focus, tab visibility or quiz completion
  const revalidateProgress = useCallback(async () => {
    const activeToken = token || (typeof window !== 'undefined' ? localStorage.getItem('accessToken') : '') || '';
    if (!activeToken) return;
    const targetLessonId = currentLessonIdRef.current;
    const cid = lesson?.session?.courseId || courseData?.courseId || courseData?.id;
    const [progRes, courseProgRes] = await Promise.all([
      apiFetch(`/api/v1/lessons/${targetLessonId}/progress`, { noCache: true, token: activeToken }),
      cid ? apiFetch(`/api/v1/courses/${cid}/my-progress`, { noCache: true, token: activeToken }) : Promise.resolve<any>(null),
    ]);
    // Stale guard: if user switched to another lesson, drop this result
    if (targetLessonId !== currentLessonIdRef.current) return;
    if (progRes.ok && progRes.data) {
      if (progRes.data.lessonId && progRes.data.lessonId !== targetLessonId) return;
      setProgress((prev: any) => {
        if (prev?.lessonId && prev.lessonId !== targetLessonId) return prev;
        return {
          ...prev,
          ...progRes.data,
          lessonId: targetLessonId,
        };
      });
    }
    if (courseProgRes && courseProgRes.ok && courseProgRes.data) {
      setCourseProgress(courseProgRes.data);
    }
  }, [lesson?.session?.courseId, courseData, token]);

  useEffect(() => {
    let timer: any = null;
    const debouncedRevalidate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        revalidateProgress();
      }, 300);
    };

    const handleProgressUpdate = () => {
      debouncedRevalidate();
    };
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        debouncedRevalidate();
      }
    };

    window.addEventListener('bbe-progress-updated', handleProgressUpdate);
    window.addEventListener('focus', handleVisibilityOrFocus);
    window.addEventListener('pageshow', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('bbe-progress-updated', handleProgressUpdate);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      window.removeEventListener('pageshow', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [revalidateProgress]);

  // Fast In-Place Lesson Switch with AbortController and Zero Race Conditions
  async function switchLesson(newLessonId: string, options?: { skipPushHistory?: boolean }) {
    if (newLessonId === currentLessonId && !pendingLessonIdRef.current) return;
    if (pendingLessonIdRef.current === newLessonId) return;
    pendingLessonIdRef.current = newLessonId;

    if (switchAbortRef.current) {
      switchAbortRef.current.abort();
    }
    const abortController = new AbortController();
    switchAbortRef.current = abortController;

    const reqId = ++switchReqIdRef.current;
    if (typeof window !== 'undefined' && (window as any).__bbeProbe) (window as any).__bbePerf?.push({ name: 'lesson_switch', at: performance.now() });
    setIsSwitchingLesson(true);
    setActiveTab('desc'); // Reset tab to description when switching lessons

    // Clear progress immediately so previous lesson progress cannot leak into current view
    setProgress({
      lessonId: newLessonId,
      completed: false,
      watchedUntil: 0,
      lastPosition: 0,
      progressPercentage: 0,
    });

    // Update browser URL without adding redundant history entries on popstate
    if (!options?.skipPushHistory && typeof window !== 'undefined') {
      window.history.pushState(null, '', `/student/learning/${newLessonId}`);
    }

    const activeToken = token || (typeof window !== 'undefined' ? localStorage.getItem('accessToken') : '') || '';

    try {
      const [lessonRes, lessonProgRes] = await Promise.all([
        apiFetch(`/api/v1/lessons/${newLessonId}`, { signal: abortController.signal }),
        activeToken
          ? apiFetch(`/api/v1/lessons/${newLessonId}/progress`, { noCache: true, token: activeToken, signal: abortController.signal })
          : Promise.resolve<ApiResponse<any>>({ ok: false, status: 0 }),
      ]);

      // Ignore if a newer lesson switch request has already fired
      if (reqId !== switchReqIdRef.current) return;
      pendingLessonIdRef.current = null;

      setCurrentLessonId(newLessonId);
      currentLessonIdRef.current = newLessonId;

      if (lessonRes.ok && lessonRes.data) {
        setLesson(lessonRes.data);
        setLessonError(null);
      } else {
        setLesson(null);
        if (!activeToken && (lessonRes.status === 401 || lessonRes.status === 403)) {
          if (typeof window !== 'undefined') {
            window.location.href = '/login?callbackUrl=' + encodeURIComponent(window.location.pathname);
            return;
          }
        }
        setLessonError({
          code: lessonRes.error?.code || (lessonRes.status === 404 ? 'LessonNotFound' : 'AccessDenied'),
          message: lessonRes.error?.message || (lessonRes.status === 404 ? 'Bài học không tồn tại' : 'Bạn chưa thể truy cập bài học này.'),
          status: lessonRes.status || 403,
        });
      }

      if (lessonProgRes && lessonProgRes.ok && lessonProgRes.data) {
        setProgress({ ...lessonProgRes.data, lessonId: newLessonId });
      } else {
        setProgress({ lessonId: newLessonId, completed: false, progressPercentage: 0 });
      }
    } catch (err: any) {
      if (reqId === switchReqIdRef.current && err?.name !== 'AbortError') {
        showToast('error', 'Không thể tải bài học. Vui lòng thử lại.', 'Lỗi tải bài');
      }
    } finally {
      if (reqId === switchReqIdRef.current) {
        pendingLessonIdRef.current = null;
        if (typeof window !== 'undefined' && (window as any).__bbeProbe) (window as any).__bbePerf?.push({ name: 'lesson_switch_done', at: performance.now() });
        setIsSwitchingLesson(false);
      }
    }
  }

  function celebrateStarReward(amount: number, rewardKey: string | null) {
    if (!(amount > 0)) return;
    const key = rewardKey || `amount:${amount}:${Math.floor(Date.now() / 2000)}`;
    if (seenRewardKeysRef.current.has(key)) return;
    seenRewardKeysRef.current.add(key);
    setStarReward(amount);
    window.setTimeout(() => setStarReward(null), 3600);
  }

  async function handleProgress(event: {
    currentTime: number;
    furthest: number;
    viewSessionId: string;
    playbackRate: number;
    event: 'PLAY' | 'HEARTBEAT' | 'PAUSE' | 'ENDED';
    playerDurationSeconds?: number;
    lessonId?: string;
    videoId?: string;
  }) {
    if (!token) return null; // Guests don't track progress
    const targetLessonId = event.lessonId || currentLessonId;
    const reqId = switchReqIdRef.current;
    const res = await apiFetch(`/api/v1/lessons/${targetLessonId}/progress`, {
      method: 'PATCH',
      body: JSON.stringify({
        positionSeconds: event.currentTime,
        furthestWatchedPositionSeconds: event.furthest,
        playerDurationSeconds: event.playerDurationSeconds,
        playbackRate: event.playbackRate,
        event: event.event,
        viewSessionId: event.viewSessionId,
      }),
    });
    if (!res.ok || !res.data) return null;

    const data = res.data;

    // Strict isolation: Only update local active state if response is for the currently viewed lesson
    if (targetLessonId === currentLessonId && targetLessonId === currentLessonIdRef.current && reqId === switchReqIdRef.current) {
      setProgress((prev: any) => {
        if (prev?.lessonId && prev.lessonId !== targetLessonId) return prev;
        return {
          ...prev,
          lessonId: targetLessonId,
          videoCompleted: Boolean(data.videoCompleted),
          completed: Boolean(data.completed),
          replay: data.replay,
          progressPercentage: data.progressPercentage,
          watchedUntil: data.furthestWatchedPositionSeconds ?? event.furthest,
          lastPosition: data.lastPositionSeconds ?? prev?.lastPosition,
          ...(data.videoStarsThisMonth ? { videoStarsThisMonth: data.videoStarsThisMonth } : {}),
          ...(data.replayHistory ? { replayHistory: data.replayHistory } : {}),
        };
      });

      if (data.videoDurationMismatch?.playerSeconds > 0) {
        const mismatch = data.videoDurationMismatch;
        if (!durationMismatchRef.current) {
          durationMismatchRef.current = true;
          if (isAdmin) {
            showToast(
              'error',
              `Thời lượng video trong DB (${mismatch.databaseSeconds}s) lệch với YouTube (${Number(mismatch.playerSeconds).toFixed(1)}s). Hãy chạy "npm run db:fix-durations" hoặc sửa số giây của bài học.`,
              'Lệch thời lượng video'
            );
          }
        }
      }

      if (data.starReward?.awarded && Number(data.starReward.amount) > 0) {
        celebrateStarReward(Number(data.starReward.amount), data.starReward.rewardKey || null);
        clearApiCache(`/api/v1/lessons/${targetLessonId}/progress`);
        void revalidateProgress();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('bbe-progress-updated', { detail: { lessonId: targetLessonId } }));
        }
      }
      if (typeof data.starReward?.balance === 'number') {
        setStarBalance(data.starReward.balance);
      }

      if (data.completed) {
        setCourseProgress((prev: any) => {
          if (!prev) return prev;
          let wasDone = false;
          const sessions = (prev.sessions || []).map((ps: any) => ({
            ...ps,
            lessons: (ps.lessons || []).map((pl: any) => {
              if (pl.lessonId !== targetLessonId) return pl;
              wasDone = Boolean(pl.completed);
              return { ...pl, completed: true };
            }),
          }));
          return {
            ...prev,
            sessions,
            completedLessons: wasDone
              ? prev.completedLessons
              : Math.min((prev.completedLessons || 0) + 1, prev.totalLessons || (prev.completedLessons || 0) + 1),
          };
        });
      }
    }

    // Do not return data if user switched away to another lesson
    if (targetLessonId !== currentLessonIdRef.current) {
      return null;
    }
    return data;
  }

  async function handleDownload(documentId: string, fileName: string) {
    setDownloadLoading(documentId);
    try {
      const res = await apiFetch(`/api/v1/documents/${documentId}/download`);
      if (!res.ok || !res.data?.downloadUrl) {
        throw new Error(res.error?.message || 'Không thể tải xuống tài liệu.');
      }

      try {
        // Ưu tiên tải dạng blob cùng nguồn để xác nhận được kết quả thật
        // (tránh trình duyệt chặn tab mới / bỏ qua thuộc tính download cross-origin).
        const fileRes = await fetch(res.data.downloadUrl);
        if (!fileRes.ok) throw new Error('fetch-failed');
        const blob = await fileRes.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        showToast('success', `Đã tải xuống tài liệu "${fileName}"`);
      } catch {
        // Bucket R2 chưa cấu hình CORS → fetch bị chặn. Dùng điều hướng tải trực tiếp
        // (top-level navigation không chịu CORS, dựa vào Content-Disposition của R2).
        const link = document.createElement('a');
        link.href = res.data.downloadUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('info', `Đang tải xuống tài liệu "${fileName}"`);
      }
    } catch (e: any) {
      showToast('error', e?.message || 'Không thể tải xuống tài liệu.');
    } finally {
      setDownloadLoading(null);
    }
  }

  const toggleSession = (sessionId: string) => {
    setOpenSessions((prev) => ({
      ...prev,
      [sessionId]: !prev[sessionId],
    }));
  };

  // Flatten all lessons across sessions in order
  const allCourseLessons: any[] = [];
  (courseData?.sessions || []).forEach((session: any) => {
    (session.lessons || []).forEach((l: any) => {
      allCourseLessons.push({
        ...l,
        sessionTitle: session.title,
        sessionId: session.sessionId || session.id,
      });
    });
  });

  const currentIndex = allCourseLessons.findIndex((l) => (l.lessonId || l.id) === currentLessonId);
  const previousLesson = currentIndex > 0 ? allCourseLessons[currentIndex - 1] : null;
  const nextLesson = currentIndex >= 0 && currentIndex < allCourseLessons.length - 1 ? allCourseLessons[currentIndex + 1] : null;

  const courseId = lesson?.session?.courseId;
  const isAdmin = user?.role === 'ADMIN';
  const isLeaderOrAdmin = isAdmin;
  const isGuest = !token;
  const allowFreeSeek = isGuest || isAdmin;

  const formatWatchMonth = (monthKey: string) => {
    const [year, month] = String(monthKey || '').split('-');
    const names = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12'];
    const idx = Number(month) - 1;
    return idx >= 0 && idx < names.length ? `${names[idx]}/${year}` : monthKey;
  };
  const historyRows: any[] = progress?.replayHistory || [];
  const cycleVideoFull = Boolean(progress?.videoCompleted);
  const cycleVideoPercent = Number(progress?.progressPercentage ?? 0);
  const cycleLessonFull = Boolean(progress?.lessonCompleted);

  const totalLessonsCount = allCourseLessons.length || 1;
  const completedLessonsCount = courseProgress?.completedLessons ?? (progress?.completed ? 1 : 0);
  const overallPercent = Math.round((completedLessonsCount / totalLessonsCount) * 100);
  // Independent check: only true if current lesson data has loaded and matches currentLessonId
  const hasQuiz = Boolean(!loadingLesson && lesson?.id === currentLessonId && lesson?.assessment);
  const isLessonPassed = Boolean(!loadingLesson && progress?.lessonId === currentLessonId && progress?.completed) || isAdmin;
  const canGoNext = !loadingLesson && (isGuest || isAdmin || Boolean(progress?.lessonId === currentLessonId && progress?.completed));

  const handleLessonComplete = (result?: any) => {
    if (isGuest) return;
    if (hasQuiz && !progress?.completed && !isAdmin) {
      setActiveTab('quiz');
      showToast(
        'info',
        'Bạn đã xem xong video! Hãy hoàn thành bài kiểm tra bên dưới để vượt qua bài học.',
        'Làm bài kiểm tra'
      );
      return;
    }
    if (!result?.completed) {
      showToast('info', 'Đã ghi nhận video. Hệ thống đang đồng bộ tiến độ bài học.', 'Đồng bộ tiến độ');
      return;
    }
    if (nextLesson) {
      showToast('success', 'Đã hoàn thành bài học! Bạn có thể bấm "Bài tiếp theo →" để học tiếp.', 'Hoàn thành bài học');
    } else {
      showToast('success', 'Chúc mừng! Bạn đã hoàn thành tất cả bài học trong khóa học này.', 'Hoàn thành khóa học');
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9ff] text-[#0b1c30] flex flex-col">
      {starReward !== null && <StarRewardCelebration amount={starReward} balance={starBalance} message="Hoàn thành video, nhận Star thôi!" />}
      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* Top Classroom Header with Official Theme: Navy #172554, Blue #2563EB, White #ffffff */}
      <header className="bg-white border-b border-[#e5eeff] px-6 py-3.5 flex items-center justify-between sticky top-0 z-40 shadow-xs">
        <div className="flex items-center gap-4 min-w-0">
          <Link
            href={courseId ? `/student/courses/${courseId}` : '/student/courses'}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#eff4ff] hover:bg-[#2563EB] text-[#2563EB] hover:text-white border border-[#cbdbf5] text-xs font-bold transition-all shadow-xs shrink-0"
          >
            ← Quay lại khóa học
          </Link>

          <div className="min-w-0">
            <h1 className="text-sm md:text-base font-bold text-[#172554] truncate" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              {lesson?.session?.courseTitle || courseData?.title || 'Khóa học BBE'}
            </h1>
            <p className="text-[11px] text-[#737686] truncate">
              {lesson?.session?.title && `${lesson.session.title} • `}
              <span className="text-[#2563EB] font-bold">
                {loadingLesson ? 'Đang tải bài giảng...' : (lesson?.title || 'Bài học')}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {!isGuest && starBalance !== null && (
            <div className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800" title="Tổng Star hiện có">
              <span aria-hidden="true">⭐</span>
              <span className="tabular-nums" aria-live="polite">{starBalance.toLocaleString('vi-VN')}</span>
              <span className="hidden sm:inline">Star</span>
            </div>
          )}
          {/* Progress Indicator for Members */}
          {!isGuest && (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-[#eff4ff] border border-[#cbdbf5] rounded-xl text-xs">
              <span className="text-[#172554] font-semibold">
                {isAdmin ? '👑 Quản trị (chế độ xem)' : `${completedLessonsCount}/${totalLessonsCount} bài hoàn thành`}
              </span>
              <div className="w-20 h-2 bg-[#cbdbf5] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#2563EB] rounded-full transition-all duration-300"
                  style={{ width: `${isAdmin ? 100 : overallPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Toggle Playlist Sidebar Button */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="px-3 py-1.5 bg-white hover:bg-[#eff4ff] border border-[#cbdbf5] text-[#172554] hover:text-[#2563EB] rounded-xl text-xs font-bold flex items-center gap-1.5 transition shadow-xs"
            title="Đóng / Mở danh sách bài học"
          >
            <span>📑</span>
            <span className="hidden md:inline">{sidebarOpen ? 'Ẩn danh sách' : 'Hiện danh sách'}</span>
          </button>
        </div>
      </header>

      {/* Main Classroom Body */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        {/* Left Side: Video Theater, Navigation Bar & Details */}
        <div className="flex-1 flex flex-col overflow-y-auto bg-[#f8f9ff] p-4 md:p-6 lg:p-8 space-y-6">
          {/* Main Video Cinema Container with Crisp Rounded Corners & Shadow */}
          <div className="w-full bg-black rounded-3xl overflow-hidden shadow-xl border border-slate-900 aspect-video relative max-w-5xl mx-auto">
            {loadingLesson && !lesson ? (
              <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-3 bg-slate-950" aria-busy="true" aria-live="polite">
                <div className="w-10 h-10 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin"></div>
                <p className="text-sm font-bold text-white">Đang tải thông tin bài học…</p>
                <p className="text-[11px] text-slate-400">Trình phát video sẽ xuất hiện ngay khi dữ liệu sẵn sàng.</p>
              </div>
            ) : !lesson ? (
              <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-slate-300 bg-slate-950">
                {lessonError?.status === 403 ? (
                  <div className="max-w-md mx-auto space-y-4">
                    <div className="w-16 h-16 mx-auto rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-3xl">
                      🔒
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white mb-1.5">Bài học đang bị khóa</h3>
                      <p className="text-xs text-amber-200/90 leading-relaxed font-medium">
                        {lessonError.message || 'Bạn cần hoàn thành video và bài kiểm tra của bài trước để mở khóa bài học này.'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                      <button
                        onClick={() => loadInitialData(currentLessonId, token)}
                        className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition border border-white/20"
                      >
                        ↻ Thử tải lại
                      </button>
                      {previousLesson && (
                        <button
                          onClick={() => switchLesson(previousLesson.lessonId || previousLesson.id)}
                          className="px-4 py-2 rounded-xl bg-[#2563EB] hover:bg-blue-600 text-white text-xs font-bold transition shadow-md"
                        >
                          ← Quay lại học bài trước
                        </button>
                      )}
                      <Link
                        href={courseId ? `/student/courses/${courseId}` : '/student/courses'}
                        className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition border border-slate-700"
                      >
                        Về lộ trình khóa học
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-base font-semibold text-white">
                      {lessonError?.message || 'Không tìm thấy bài học'}
                    </p>
                    <Link href="/student/courses" className="text-xs text-[#2563EB] hover:underline font-bold inline-block">
                      Quay lại danh mục khóa học
                    </Link>
                  </div>
                )}
              </div>
            ) : lesson.video ? (
              <YouTubePlayer
                key={`${currentLessonId}:${lesson.video.youtubeVideoId}`}
                lessonId={currentLessonId}
                youtubeVideoId={lesson.video.youtubeVideoId}
                accessToken={token}
                allowFreeSeek={allowFreeSeek}
                initialPosition={
                  progress?.lessonId === currentLessonId &&
                  progress?.completed && (progress?.lastPosition || 0) >= (lesson.video.durationSeconds || 0) - 5
                    ? 0
                    : (progress?.lessonId === currentLessonId ? (progress?.lastPosition || 0) : 0)
                }
                initialFurthest={
                  progress?.lessonId === currentLessonId
                    ? (progress?.watchedUntil ?? progress?.furthestWatchedPositionSeconds ?? 0)
                    : 0
                }
                durationSeconds={lesson.video.durationSeconds || 0}
                onProgress={handleProgress}
                onComplete={handleLessonComplete}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm bg-slate-950">
                Bài học này chưa có video đính kèm.
              </div>
            )}

            {/* True Floating Non-Destructive Loading Overlay */}
            {isSwitchingLesson && (
              <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-xs flex flex-col items-center justify-center z-30 transition-opacity">
                <div className="w-10 h-10 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin"></div>
                <p className="text-xs text-slate-200 mt-2.5 font-medium">Đang chuyển bài giảng...</p>
              </div>
            )}
          </div>

          {/* Lịch sử học của chính video này: chu kỳ đào tạo khác lượt xem thưởng tháng */}
          {!isGuest && (cycleVideoPercent > 0 || cycleLessonFull || historyRows.length > 0) && (
            <div className="rounded-2xl border border-[#eff4ff] bg-white p-4 max-w-5xl w-full mx-auto shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#eff4ff]">
                <h3 className="text-xs font-bold text-[#172554] uppercase tracking-wide flex items-center gap-1.5">
                  <span>🗓️</span> Lịch sử học video này
                </h3>
                <span className="text-[10px] text-[#737686]">
                  "Hoàn thành đào tạo" (chu kỳ học) khác "lượt xem thưởng" (theo tháng) — hai mốc độc lập.
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3">
                <div className={`rounded-xl border px-3 py-2 text-xs ${cycleVideoFull ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-[#cbdbf5] bg-[#f8f9ff] text-[#172554]'}`}>
                  <p className="font-bold">{cycleVideoFull ? '✓ Đã xem đủ video (chu kỳ này)' : `Đang xem: ${cycleVideoPercent}% video`}</p>
                  <p className="text-[10px] opacity-80 mt-0.5">
                    Tiến độ backend ghi nhận: {Math.round(progress?.watchedUntil || 0)}/{lesson?.video?.durationSeconds || 0}s
                  </p>
                </div>
                <div className={`rounded-xl border px-3 py-2 text-xs ${cycleLessonFull ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-[#cbdbf5] bg-[#f8f9ff] text-[#172554]'}`}>
                  <p className="font-bold">{cycleLessonFull ? '✓ Bài học hoàn thành' : hasQuiz ? 'Bài học: còn cần quiz đạt' : 'Bài học: chưa hoàn thành'}</p>
                  <p className="text-[10px] opacity-80 mt-0.5">
                    {hasQuiz ? 'Video + quiz đều đạt mới tính xong bài của chu kỳ.' : 'Chu kỳ này chưa có bài kiểm tra đi kèm.'}
                  </p>
                </div>
                <div className={`rounded-xl border px-3 py-2 text-xs ${(progress?.videoStarsThisMonth?.awardedStars || 0) > 0 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-[#cbdbf5] bg-[#f8f9ff] text-[#172554]'}`}>
                  <p className="font-bold">
                    {(progress?.videoStarsThisMonth?.awardedStars || 0) > 0
                      ? `Tháng này đã nhận: +${progress.videoStarsThisMonth.awardedStars} ⭐`
                      : 'Tháng này chưa nhận sao video'}
                  </p>
                  <p className="text-[10px] opacity-80 mt-0.5">
                    {(progress?.videoStarsThisMonth?.awardedStars || 0) > 0 || progress?.videoStarsThisMonth?.completed
                      ? 'Đủ lượt xem nhận thưởng trong tháng hiện tại.'
                      : 'Xem lại toàn bộ video trong tháng để nhận sao.'}
                  </p>
                </div>
              </div>

              {historyRows.length > 0 && (
                <div className="pt-3 mt-3 border-t border-dashed border-[#eff4ff]">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-[#737686] mb-1.5">Những tháng trước</p>
                  <div className="flex flex-wrap gap-2">
                    {historyRows.map((row: any) => (
                      <span
                        key={row.competitionMonthId}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${
                          row.awardedStars > 0
                            ? 'border-amber-200 bg-amber-50 text-amber-800'
                            : row.completed
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : 'border-[#cbdbf5] bg-white text-slate-600'
                        }`}
                        title={`Đã xem ${row.watchedSeconds}s`}
                      >
                        {formatWatchMonth(row.competitionMonth)}: {row.awardedStars > 0 ? `+${row.awardedStars} ⭐` : row.completed ? '✓ đã xem lại' : `${row.watchedSeconds}s`}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Under-Video Action Bar: Prev / Next with Brand Orange Button #F97316 */}
          <div className="bg-white rounded-2xl border border-[#eff4ff] shadow-sm p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 max-w-5xl w-full mx-auto">
            <div className="flex items-center gap-3 flex-wrap">
              {previousLesson ? (
                <button
                  disabled={loadingLesson}
                  onClick={() => switchLesson(previousLesson.lessonId || previousLesson.id)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#eff4ff] hover:bg-[#cbdbf5] disabled:opacity-50 text-[#172554] text-xs font-bold transition shadow-xs"
                >
                  ← Bài trước
                </button>
              ) : (
                <span className="text-xs text-[#737686] px-3 py-2 font-medium">Đang ở bài đầu tiên</span>
              )}

              {nextLesson && (
                canGoNext ? (
                  <button
                    disabled={loadingLesson}
                    onClick={() => switchLesson(nextLesson.lessonId || nextLesson.id)}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#F97316] hover:bg-[#ea580c] disabled:opacity-50 text-white text-xs font-bold shadow-md transition hover:scale-[1.02] active:scale-[0.98]"
                  >
                    Bài tiếp theo →
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={loadingLesson}
                    onClick={() => {
                      if (hasQuiz) {
                        setActiveTab('quiz');
                        showToast(
                          'info',
                          'Bạn cần vượt qua bài kiểm tra để tiếp tục sang bài tiếp theo.',
                          'Yêu cầu hoàn thành Quiz'
                        );
                      } else {
                        showToast(
                          'info',
                          'Bạn cần xem video bài giảng trước khi sang bài tiếp theo.',
                          'Xem video'
                        );
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 disabled:opacity-50 text-slate-500 text-xs font-bold transition shadow-2xs"
                    title={hasQuiz ? 'Cần hoàn thành bài kiểm tra để tiếp tục' : 'Cần xem video trước'}
                  >
                    <span>🔒 Bài tiếp theo →</span>
                  </button>
                )
              )}

              {!nextLesson && courseId && (
                canGoNext ? (
                  <Link
                    href={courseData?.assessment || courseData?.finalAssessment ? `/student/courses/${courseId}/quiz` : `/student/courses/${courseId}`}
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-700 hover:to-yellow-700 text-white text-xs font-bold shadow-md transition hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <span>{courseData?.assessment || courseData?.finalAssessment ? '🎓 Làm bài thi cuối khóa →' : '✓ Hoàn tất khóa học →'}</span>
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-slate-200 text-slate-500 text-xs font-bold transition shadow-2xs opacity-75 cursor-not-allowed"
                    title={hasQuiz ? 'Cần hoàn thành bài kiểm tra để mở bài thi cuối khóa' : 'Cần xem video trước'}
                  >
                    <span>🔒 {courseData?.assessment || courseData?.finalAssessment ? 'Bài thi cuối khóa →' : 'Hoàn tất khóa học →'}</span>
                  </button>
                )
              )}
            </div>

            <div className="flex items-center gap-3 text-xs text-[#737686]">
              {lesson?.documents?.length > 0 && (
                <button
                  onClick={() => setActiveTab('docs')}
                  className="hover:text-[#2563EB] flex items-center gap-1 font-bold transition bg-[#f8f9ff] px-3 py-1.5 rounded-xl border border-[#cbdbf5]"
                >
                  <span>📎</span>
                  <span>{lesson.documents.length} tài liệu đính kèm</span>
                </button>
              )}
            </div>
          </div>

          {/* Lesson Tabs: Description & Documents (White/Navy Stitch Theme) */}
          <div className="max-w-5xl w-full mx-auto space-y-4">
            <div className="flex border-b border-[#cbdbf5]/70 gap-6 overflow-x-auto whitespace-nowrap pb-0.5 scrollbar-none">
              <button
                onClick={() => setActiveTab('desc')}
                className={`pb-3 text-sm font-bold border-b-2 transition ${
                  activeTab === 'desc'
                    ? 'border-[#2563EB] text-[#2563EB]'
                    : 'border-transparent text-[#737686] hover:text-[#172554]'
                }`}
              >
                📖 Mô tả bài giảng
              </button>
              <button
                onClick={() => setActiveTab('docs')}
                className={`pb-3 text-sm font-bold border-b-2 transition flex items-center gap-1.5 ${
                  activeTab === 'docs'
                    ? 'border-[#2563EB] text-[#2563EB]'
                    : 'border-transparent text-[#737686] hover:text-[#172554]'
                }`}
              >
                <span>📎 Tài liệu học tập</span>
                {lesson?.documents?.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-[#eff4ff] text-xs font-bold text-[#2563EB]">
                    {lesson.documents.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('comments')}
                className={`pb-3 text-sm font-bold border-b-2 transition flex items-center gap-1.5 ${
                  activeTab === 'comments'
                    ? 'border-[#2563EB] text-[#2563EB]'
                    : 'border-transparent text-[#737686] hover:text-[#172554]'
                }`}
              >
                <span>💬 Hỏi đáp</span>
              </button>
              {!loadingLesson && hasQuiz && (
                <button
                  onClick={() => setActiveTab('quiz')}
                  className={`pb-3 text-sm font-bold border-b-2 transition flex items-center gap-1.5 ${
                    activeTab === 'quiz'
                      ? 'border-[#2563EB] text-[#2563EB]'
                      : 'border-transparent text-[#737686] hover:text-[#172554]'
                  }`}
                >
                  <span>📝 Bài kiểm tra</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      progress?.completed
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-orange-100 text-orange-800'
                    }`}
                  >
                    {progress?.completed ? '✓ Đã đạt' : 'Cần làm'}
                  </span>
                </button>
              )}
            </div>

            {loadingLesson ? (
              <Card className="p-8 border border-[#eff4ff] shadow-sm flex flex-col items-center justify-center py-12 text-slate-400 gap-3">
                <div className="w-8 h-8 border-3 border-[#2563EB] border-t-transparent rounded-full animate-spin"></div>
                <span className="text-xs font-medium text-slate-500">Đang tải nội dung bài giảng...</span>
              </Card>
            ) : activeTab === 'desc' ? (
              <Card className="p-6 border border-[#eff4ff] shadow-sm space-y-3">
                <h2 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                  {lesson?.title}
                </h2>
                <p className="text-sm text-[#434655] leading-relaxed whitespace-pre-line">
                  {lesson?.description || 'Bài học này không có mô tả chi tiết.'}
                </p>
              </Card>
            ) : activeTab === 'docs' ? (
              <Card className="p-6 border border-[#eff4ff] shadow-sm space-y-4">
                <h3 className="text-base font-bold text-[#172554] flex items-center gap-2">
                  <span>📄</span> Danh sách tài liệu đính kèm ({lesson?.documents?.length || 0})
                </h3>

                {!lesson?.documents || lesson.documents.length === 0 ? (
                  <p className="text-xs text-[#737686] py-4">Bài học này không có tài liệu đính kèm nào.</p>
                ) : (
                  <div className="space-y-2.5">
                    {lesson.documents.map((doc: any) => (
                      <div
                        key={doc.documentId || doc.id}
                        className="p-4 bg-[#f8f9ff] rounded-2xl border border-[#eff4ff] flex items-center justify-between gap-3 hover:bg-white hover:shadow-xs transition"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-2xl">📄</span>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-[#172554] truncate">{doc.fileName}</p>
                            {doc.fileSize && (
                              <p className="text-[10px] text-[#737686]">{(doc.fileSize / 1024 / 1024).toFixed(2)} MB</p>
                            )}
                          </div>
                        </div>

                        <button
                          onClick={() => handleDownload(doc.documentId || doc.id, doc.fileName)}
                          disabled={downloadLoading === (doc.documentId || doc.id)}
                          className="px-3.5 py-1.5 bg-[#2563EB] hover:bg-[#1d4ed8] disabled:opacity-50 text-white text-xs font-bold rounded-xl shrink-0 transition shadow-xs flex items-center gap-1.5"
                        >
                          {downloadLoading === (doc.documentId || doc.id) ? (
                            <span>Đang tải...</span>
                          ) : (
                            <>
                              <span>⬇</span>
                              <span>Tải về</span>
                            </>
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ) : activeTab === 'comments' ? (
              <LessonComments
                lessonId={currentLessonId}
                currentUser={user}
                accessToken={token}
                onToast={showToast}
              />
            ) : activeTab === 'quiz' && hasQuiz && !loadingLesson && lesson?.id === currentLessonId ? (
              <Card className="p-6 border border-[#eff4ff] shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="text-base font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                      📝 {lesson.assessment.title || 'Bài kiểm tra bài học'}
                    </h3>
                    <p className="text-xs text-[#737686] leading-relaxed max-w-xl">
                      {progress?.completed
                        ? 'Bạn đã vượt qua bài kiểm tra này. Có thể xem lại kết quả bất cứ lúc nào.'
                        : 'Hoàn thành bài kiểm tra (đạt từ 85%) để vượt qua bài học. Trang làm bài sẽ tách riêng để bạn tập trung.'}
                    </p>
                  </div>
                  {isAdmin || Boolean(progress?.completed) || (progress?.progressPercentage ?? 0) >= 100 || !(lesson?.video?.durationSeconds || lesson?.video?.duration_seconds) ? (
                    <Link href={`/student/learning/${currentLessonId}/quiz`} className="shrink-0">
                      <Button variant="primary">
                        {progress?.completed ? 'Xem bài kiểm tra →' : 'Vào làm bài kiểm tra →'}
                      </Button>
                    </Link>
                  ) : (
                    <div className="shrink-0 flex flex-col sm:items-end gap-1">
                      <Button
                        variant="secondary"
                        disabled
                        className="!bg-slate-100 !text-slate-400 !border-slate-200 cursor-not-allowed font-bold"
                      >
                        🔒 Cần xem video trước ({progress?.progressPercentage || 0}%/100%)
                      </Button>
                      <span className="text-[10px] text-amber-700 font-medium">
                        Cần xem hết 100% video để mở khóa bài kiểm tra
                      </span>
                    </div>
                  )}
                </div>
              </Card>
            ) : null}
          </div>
        </div>

        {/* Right Side: Udemy-style Collapsible Playlist Sidebar */}
        {sidebarOpen && (
          <aside className="w-full lg:w-96 bg-white border-l border-[#e5eeff] flex flex-col shrink-0 overflow-y-auto max-h-[85vh] lg:max-h-none z-20 shadow-sm">
            {/* Sidebar Header */}
            <div className="p-4 border-b border-[#eff4ff] sticky top-0 bg-white z-10 flex items-center justify-between shadow-2xs">
              <div>
                <h3 className="font-bold text-sm text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                  Nội dung khóa học
                </h3>
                <p className="text-[11px] text-[#737686] mt-0.5 font-medium">
                  {courseData?.sessions?.length || 0} buổi • {allCourseLessons.length} bài giảng
                </p>
              </div>
              <button
                onClick={() => setSidebarOpen(false)}
                className="text-[#737686] hover:text-[#172554] p-1 rounded-lg hover:bg-[#eff4ff] lg:hidden"
              >
                ✕
              </button>
            </div>

            {/* Sessions & Lessons Accordion List */}
            <div className="divide-y divide-[#eff4ff]">
              {courseData?.sessions?.map((session: any, sIdx: number) => {
                const sId = session.sessionId || session.id;
                const isOpen = openSessions[sId] ?? true;

                return (
                  <div key={sId} className="bg-white">
                    {/* Session Accordion Header (Thả ra / thu vào) */}
                    <button
                      onClick={() => toggleSession(sId)}
                      className="w-full px-4 py-3.5 bg-[#f8f9ff] hover:bg-[#eff4ff] flex items-center justify-between text-left transition"
                    >
                      <div className="min-w-0 pr-2">
                        <span className="text-[10px] font-bold text-[#2563EB] uppercase tracking-wider block">
                          Buổi {sIdx + 1}
                        </span>
                        <h4 className="text-xs font-bold text-[#172554] truncate">{session.title}</h4>
                      </div>
                      <span className="text-[#737686] text-xs font-bold shrink-0 transition-transform duration-200">
                        {isOpen ? '▲' : '▼'}
                      </span>
                    </button>

                    {/* Lessons list in session (Instant in-place switch on click!) */}
                    {isOpen && (
                      <div className="divide-y divide-[#eff4ff]">
                        {session.lessons?.map((l: any, lIdx: number) => {
                          const lId = l.lessonId || l.id;
                          const isCurrent = lId === currentLessonId;
                          const isLessonDone =
                            isLeaderOrAdmin ||
                            Boolean(
                              courseProgress?.sessions
                                ?.find((ps: any) => ps.sessionId === sId)
                                ?.lessons?.find((pl: any) => pl.lessonId === lId)?.completed
                            ) ||
                            (isCurrent && !loadingLesson && progress?.lessonId === lId && Boolean(progress?.completed));

                          return (
                            <button
                              key={lId}
                              type="button"
                              onClick={() => switchLesson(lId)}
                              className={`w-full text-left px-4 py-3.5 flex items-start gap-3 text-xs transition ${
                                isCurrent
                                  ? 'bg-[#eff4ff] text-[#172554] border-l-4 border-[#2563EB] font-bold'
                                  : 'text-[#434655] hover:bg-[#f8f9ff] hover:text-[#172554]'
                              }`}
                            >
                              {/* Status Icon */}
                              <span className="mt-0.5 shrink-0 text-sm" title={isLessonDone ? 'Đã hoàn thành' : undefined}>
                                {isCurrent ? (
                                  <span className={`font-bold ${isLessonDone ? 'text-emerald-600' : 'text-[#2563EB]'}`}>▶</span>
                                ) : isLessonDone ? (
                                  <span className="w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center">✓</span>
                                ) : (
                                  <span className="text-slate-300">○</span>
                                )}
                              </span>

                              <div className="min-w-0 flex-1">
                                <p className={`font-semibold line-clamp-2 ${isCurrent ? 'text-[#2563EB]' : 'text-[#172554]'}`}>
                                  Bài {lIdx + 1}: {l.title}
                                </p>
                              <div className="flex items-center gap-2 text-[10px] text-[#737686] mt-1 font-normal flex-wrap">
                                  <span>📹 {l.video?.durationSeconds ? `${Math.floor(l.video.durationSeconds / 60)}:${(l.video.durationSeconds % 60).toString().padStart(2, '0')}` : 'Video'}</span>
                                  {l.assessment && (
                                    <span className={`font-semibold px-1.5 py-0.5 rounded text-[9px] ${
                                      isLessonDone
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-amber-100 text-amber-700'
                                    }`}>
                                      {isLessonDone ? '✓ Quiz đạt' : '📝 Quiz'}
                                    </span>
                                  )}
                                  {l.documents?.length > 0 && <span>• 📎 {l.documents.length} tài liệu</span>}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
