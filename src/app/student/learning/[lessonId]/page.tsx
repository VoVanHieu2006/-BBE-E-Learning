'use client';
import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import YouTubePlayer from '@/components/YouTubePlayer';
import { apiFetch, ApiResponse } from '@/lib/api/client';

export default function LearningVideoPage({ params }: { params: { lessonId: string } }) {
  const [currentLessonId, setCurrentLessonId] = useState(params.lessonId);
  const [user, setUser] = useState<any>(null);
  const [lesson, setLesson] = useState<any>(null);
  const [progress, setProgress] = useState<any>(null);
  const [courseData, setCourseData] = useState<any>(null);
  const [courseProgress, setCourseProgress] = useState<any>(null);
  const [loadingLesson, setLoadingLesson] = useState(true);
  const [loadingCourse, setLoadingCourse] = useState(true);
  const [token, setToken] = useState<string>('');
  const [downloadLoading, setDownloadLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'desc' | 'docs'>('desc');
  const [openSessions, setOpenSessions] = useState<Record<string, boolean>>({});
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toast, setToast] = useState<ToastMessage | null>(null);

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

  // Initial load: Fetch lesson details + full course outline + course progress
  async function loadInitialData(lessonId: string, authToken?: string) {
    setLoadingLesson(true);
    setLoadingCourse(true);
    const activeToken = authToken || (typeof window !== 'undefined' ? localStorage.getItem('accessToken') : '') || '';

    const lessonRes = await apiFetch(`/api/v1/lessons/${lessonId}`);
    if (lessonRes.ok && lessonRes.data) {
      const lData = lessonRes.data;
      setLesson(lData);

      const courseId = lData.session?.courseId;
      if (courseId) {
        const [courseRes, progListRes, lessonProgRes] = await Promise.all([
          apiFetch(`/api/v1/courses/${courseId}`),
          activeToken ? apiFetch(`/api/v1/courses/${courseId}/my-progress`, { noCache: true }) : Promise.resolve<ApiResponse<any>>({ ok: false, status: 0 }),
          activeToken ? apiFetch(`/api/v1/lessons/${lessonId}/progress`, { noCache: true }) : Promise.resolve<ApiResponse<any>>({ ok: false, status: 0 }),
        ]);

        if (courseRes.ok && courseRes.data) {
          setCourseData(courseRes.data);
          // Default all sessions open
          const initOpen: Record<string, boolean> = {};
          (courseRes.data.sessions || []).forEach((s: any) => {
            initOpen[s.sessionId || s.id] = true;
          });
          setOpenSessions(initOpen);
        }

        if (progListRes && progListRes.ok && progListRes.data) {
          setCourseProgress(progListRes.data);
        }

        if (lessonProgRes && lessonProgRes.ok && lessonProgRes.data) {
          setProgress(lessonProgRes.data);
        }
      }
    } else if (!activeToken && (lessonRes.status === 401 || lessonRes.status === 403)) {
      if (typeof window !== 'undefined') {
        window.location.href = '/login?callbackUrl=' + encodeURIComponent(window.location.pathname);
        return;
      }
    }

    setLoadingLesson(false);
    setLoadingCourse(false);
  }

  // Fast In-Place Lesson Switch (Request 3: ZERO reload of the course playlist!)
  async function switchLesson(newLessonId: string) {
    if (newLessonId === currentLessonId) return;

    setCurrentLessonId(newLessonId);
    setLoadingLesson(true);

    // Update browser URL without triggering full-page router remount
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', `/student/learning/${newLessonId}`);
    }

    const activeToken = token || (typeof window !== 'undefined' ? localStorage.getItem('accessToken') : '') || '';
    const [lessonRes, lessonProgRes] = await Promise.all([
      apiFetch(`/api/v1/lessons/${newLessonId}`),
      activeToken ? apiFetch(`/api/v1/lessons/${newLessonId}/progress`, { noCache: true }) : Promise.resolve<ApiResponse<any>>({ ok: false, status: 0 }),
    ]);

    if (lessonRes.ok && lessonRes.data) {
      setLesson(lessonRes.data);
    } else if (!activeToken && (lessonRes.status === 401 || lessonRes.status === 403)) {
      if (typeof window !== 'undefined') {
        window.location.href = '/login?callbackUrl=' + encodeURIComponent(window.location.pathname);
        return;
      }
    }

    if (lessonProgRes && lessonProgRes.ok && lessonProgRes.data) {
      setProgress(lessonProgRes.data);
    } else {
      setProgress(null);
    }

    setLoadingLesson(false);
  }

  async function handleProgress(currentTime: number, furthest: number) {
    if (!token) return; // Guests don't track progress
    const res = await apiFetch(`/api/v1/lessons/${currentLessonId}/progress`, {
      method: 'PATCH',
      body: JSON.stringify({
        positionSeconds: currentTime,
        furthestWatchedPositionSeconds: furthest,
      }),
    });

    if (res.ok && res.data) {
      setProgress((prev: any) => ({
        ...prev,
        completed: res.data.completed,
        progressPercentage: res.data.progressPercentage,
        watchedUntil: furthest,
      }));

      // Đánh dấu bài hiện tại hoàn thành ngay trong courseProgress (chỉ tăng đếm 1 lần duy nhất)
      if (res.data.completed) {
        setCourseProgress((prev: any) => {
          if (!prev) return prev;
          let wasDone = false;
          const sessions = (prev.sessions || []).map((ps: any) => ({
            ...ps,
            lessons: (ps.lessons || []).map((pl: any) => {
              if (pl.lessonId !== currentLessonId) return pl;
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
  const isLeaderOrAdmin = user?.role === 'ADMIN' || user?.role === 'CHAPTER_LEADER';
  const isGuest = !token;
  const allowFreeSeek = isLeaderOrAdmin || isGuest;

  const totalLessonsCount = allCourseLessons.length || 1;
  const completedLessonsCount = isLeaderOrAdmin
    ? totalLessonsCount
    : courseProgress?.completedLessons ?? (progress?.completed ? 1 : 0);
  const overallPercent = Math.round((completedLessonsCount / totalLessonsCount) * 100);

  const handleLessonComplete = () => {
    if (!isGuest) {
      setProgress((prev: any) => ({ ...prev, completed: true, progressPercentage: 100 }));
      if (nextLesson) {
        showToast('success', `Đã hoàn thành bài học! Bạn có thể bấm "Bài tiếp theo →" để học tiếp.`, 'Hoàn thành bài học');
      } else {
        showToast('success', 'Chúc mừng! Bạn đã hoàn thành tất cả bài học trong khóa học này.', 'Hoàn thành khóa học');
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9ff] text-[#0b1c30] flex flex-col">
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
              <span className="text-[#2563EB] font-bold">{lesson?.title || 'Đang tải bài giảng...'}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Progress Indicator for Members */}
          {!isGuest && (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-[#eff4ff] border border-[#cbdbf5] rounded-xl text-xs">
              <span className="text-[#172554] font-semibold">
                {isLeaderOrAdmin ? '👑 BĐHU / Quản trị' : `${completedLessonsCount}/${totalLessonsCount} bài hoàn thành`}
              </span>
              <div className="w-20 h-2 bg-[#cbdbf5] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#2563EB] rounded-full transition-all duration-300"
                  style={{ width: `${isLeaderOrAdmin ? 100 : overallPercent}%` }}
                />
              </div>
            </div>
          )}

          {isGuest && (
            <span className="px-3 py-1.5 bg-blue-50 border border-blue-200 text-[#2563EB] text-xs font-bold rounded-xl shadow-xs">
              🌐 Khóa học công khai
            </span>
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
            {loadingLesson ? (
              <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-3 bg-slate-950">
                <div className="w-10 h-10 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin"></div>
                <p className="text-xs text-slate-300 font-medium">Đang nạp bài giảng...</p>
              </div>
            ) : !lesson ? (
              <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center text-slate-400 bg-slate-950">
                <p className="text-base font-semibold text-white mb-2">Không tìm thấy bài học</p>
                <Link href="/student/courses" className="text-xs text-[#2563EB] hover:underline font-bold">
                  Quay lại danh mục khóa học
                </Link>
              </div>
            ) : lesson.video ? (
              <YouTubePlayer
                lessonId={currentLessonId}
                youtubeVideoId={lesson.video.youtubeVideoId}
                accessToken={token}
                allowFreeSeek={allowFreeSeek}
                initialPosition={
                  progress?.completed && (progress?.lastPosition || 0) >= (lesson.video.durationSeconds || 0) - 5
                    ? 0
                    : progress?.lastPosition || 0
                }
                initialFurthest={progress?.watchedUntil || progress?.furthestWatchedPositionSeconds || 0}
                durationSeconds={lesson.video.durationSeconds || 120}
                onProgress={(p) => handleProgress(p.currentTime, p.furthest)}
                onComplete={handleLessonComplete}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm bg-slate-950">
                Bài học này chưa có video đính kèm.
              </div>
            )}
          </div>

          {/* Under-Video Action Bar: Prev / Next with Brand Orange Button #F97316 */}
          <div className="bg-white rounded-2xl border border-[#eff4ff] shadow-sm p-4 flex items-center justify-between max-w-5xl w-full mx-auto">
            <div className="flex items-center gap-3">
              {previousLesson ? (
                <button
                  onClick={() => switchLesson(previousLesson.lessonId || previousLesson.id)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#eff4ff] hover:bg-[#cbdbf5] text-[#172554] text-xs font-bold transition shadow-xs"
                >
                  ← Bài trước
                </button>
              ) : (
                <span className="text-xs text-[#737686] px-3 py-2 font-medium">Đang ở bài đầu tiên</span>
              )}

              {nextLesson && (
                <button
                  onClick={() => switchLesson(nextLesson.lessonId || nextLesson.id)}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#F97316] hover:bg-[#ea580c] text-white text-xs font-bold shadow-md transition hover:scale-[1.02] active:scale-[0.98]"
                >
                  Bài tiếp theo →
                </button>
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
            <div className="flex border-b border-[#cbdbf5]/70 gap-6">
              <button
                onClick={() => setActiveTab('desc')}
                className={`pb-3 text-sm font-bold border-b-2 transition ${
                  activeTab === 'desc'
                    ? 'border-[#2563EB] text-[#2563EB]'
                    : 'border-transparent text-[#737686] hover:text-[#172554]'
                }`}
              >
                📝 Mô tả bài giảng
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
            </div>

            {activeTab === 'desc' ? (
              <Card className="p-6 border border-[#eff4ff] shadow-sm space-y-3">
                <h2 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                  {lesson?.title}
                </h2>
                <p className="text-sm text-[#434655] leading-relaxed whitespace-pre-line">
                  {lesson?.description || 'Bài học này không có mô tả chi tiết.'}
                </p>
              </Card>
            ) : (
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
            )}
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
                            (courseProgress?.sessions
                              ?.find((ps: any) => ps.sessionId === sId)
                              ?.lessons?.find((pl: any) => pl.lessonId === lId)?.completed) ||
                            (isCurrent && progress?.completed);

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
                                  {sIdx + 1}.{lIdx + 1} {l.title}
                                </p>
                                <div className="flex items-center gap-2 text-[10px] text-[#737686] mt-1 font-normal">
                                  <span>📹 {l.video?.durationSeconds ? `${Math.floor(l.video.durationSeconds / 60)}:${(l.video.durationSeconds % 60).toString().padStart(2, '0')}` : 'Video'}</span>
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
