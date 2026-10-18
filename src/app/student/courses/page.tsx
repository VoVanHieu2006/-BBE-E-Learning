'use client';
import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { apiFetch, getCachedApiData } from '@/lib/api/client';
import { getUrgencyLevel } from '@/lib/deadline-urgency';

export default function StudentCoursesPage() {
  const [user, setUser] = useState<any>(null);
  const [courses, setCourses] = useState<any[]>([]);
  const [progressCourses, setProgressCourses] = useState<any[]>([]);
  const [progressSummary, setProgressSummary] = useState<any>(null);
  const [deadlines, setDeadlines] = useState<Record<string, string | null>>({});
  const [deadlinesSummary, setDeadlinesSummary] = useState<any>(null);
  const [starBalance, setStarBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'IN_PROGRESS' | 'NOT_STARTED' | 'COMPLETED'>('ALL');
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Clock tick every 1 second for live zero-lag countdown
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      const u = localStorage.getItem('user');
      if (u) {
        try {
          setUser(JSON.parse(u));
        } catch {}
      }

      // Read caches immediately
      const cachedCourses = getCachedApiData<any>('/api/v1/courses');
      if (cachedCourses?.items) {
        setCourses(cachedCourses.items);
      }
      const cachedProgress = getCachedApiData<any>('/api/v1/members/me/courses');
      if (cachedProgress?.items) {
        setProgressCourses(cachedProgress.items);
        setProgressSummary(cachedProgress.summary || null);
      }
      const cachedStars = getCachedApiData<any>('/api/v1/stars/me?page=1&limit=20');
      if (cachedStars?.balance !== undefined) {
        setStarBalance(cachedStars.balance);
      }
    }
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [coursesRes, progressRes, deadlinesRes, userRes, starsRes] = await Promise.all([
      apiFetch<any>('/api/v1/courses'),
      apiFetch<any>('/api/v1/members/me/courses'),
      apiFetch<any>('/api/v1/members/me/deadlines', { noCache: true }),
      apiFetch<any>('/api/v1/users/me'),
      apiFetch<any>('/api/v1/stars/me?page=1&limit=20'),
    ]);

    if (coursesRes.ok && coursesRes.data) {
      setCourses(coursesRes.data.items || []);
    }
    if (progressRes.ok && progressRes.data) {
      setProgressCourses(progressRes.data.items || []);
      setProgressSummary(progressRes.data.summary || null);
    }
    if (deadlinesRes.ok && deadlinesRes.data) {
      setDeadlines(Object.fromEntries((deadlinesRes.data.items || []).map((item: any) => [item.courseId, item.dueAt])));
      setDeadlinesSummary(deadlinesRes.data.summary || null);
    }
    if (userRes.ok && userRes.data) {
      setUser((prev: any) => ({ ...prev, ...userRes.data }));
    }
    if (starsRes.ok && starsRes.data) {
      setStarBalance(starsRes.data.balance ?? 0);
    }
    setLoading(false);
  }

  // Map progress to courses
  const progressMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const p of progressCourses) {
      map.set(p.courseId || p.id, p);
    }
    return map;
  }, [progressCourses]);

  const enrichedCourses = useMemo(() => {
    return courses.map((c) => {
      const courseId = c.courseId || c.id;
      const prog = progressMap.get(courseId);
      const isMandatory = courseId in deadlines;
      const dueAt = deadlines[courseId] || null;
      const progressPercent = prog?.progressPercentage ?? 0;
      const isCompleted = Boolean(prog?.isCompleted || progressPercent >= 100);
      const isStarted = Boolean(prog && (prog.completedLessons > 0 || progressPercent > 0));
      return {
        ...c,
        courseId,
        isMandatory,
        dueAt,
        progressPercent,
        completedLessons: prog?.completedLessons || 0,
        totalLessons: prog?.totalLessons || c.sessionCount || 0,
        isCompleted,
        isStarted,
      };
    });
  }, [courses, progressMap, deadlines]);

  const mandatoryCourses = useMemo(() => {
    return enrichedCourses.filter((c) => c.isMandatory && !c.isCompleted);
  }, [enrichedCourses]);

  const filteredCourses = useMemo(() => {
    return enrichedCourses.filter((c) => {
      if (filter === 'IN_PROGRESS') return c.isStarted && !c.isCompleted;
      if (filter === 'NOT_STARTED') return !c.isStarted && !c.isCompleted;
      if (filter === 'COMPLETED') return c.isCompleted;
      return true;
    });
  }, [enrichedCourses, filter]);

  // Overall deadline countdown calculations
  const mostUrgentDueAt = deadlinesSummary?.earliestDueAt
    ? new Date(deadlinesSummary.earliestDueAt).getTime()
    : null;

  const msRemaining = mostUrgentDueAt ? mostUrgentDueAt - currentTime : null;
  const daysRemaining = msRemaining !== null ? Math.ceil(msRemaining / (1000 * 60 * 60 * 24)) : null;
  const urgencyLevel = getUrgencyLevel(daysRemaining);

  const formatCountdown = (ms: number | null) => {
    if (ms === null) return null;
    if (ms <= 0) return 'Đã hết hạn';
    const totalSec = Math.floor(ms / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${d > 0 ? `${d} ngày ` : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const totalCoursesCount = progressSummary?.totalCourses ?? courses.length;
  const completedCoursesCount = progressSummary?.completedCourses ?? enrichedCourses.filter((c) => c.isCompleted).length;
  const overallLessonsDone = progressSummary?.completedLessons ?? enrichedCourses.reduce((sum, c) => sum + (c.completedLessons || 0), 0);
  const overallLessonsTotal = progressSummary?.totalLessons ?? courses.reduce((sum, c) => sum + (c.sessionCount || 0), 0);
  const overallProgress = progressSummary?.overallProgressPercent ?? (overallLessonsTotal > 0 ? Math.round((overallLessonsDone / overallLessonsTotal) * 100) : 0);

  return (
    <div className="w-full">
      {mounted && user ? (
        <div className="w-full space-y-8">
          {/* Welcome & Affiliation Banner */}
          <div className="bg-gradient-to-r from-[#172554] via-[#1e3a8a] to-[#2563EB] rounded-3xl p-6 md:p-8 text-white shadow-md relative overflow-hidden">
            <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/15 backdrop-blur-md rounded-full text-xs font-semibold">
                  <span>🏛️</span>
                  <span>
                    {user.currentDepartment?.name
                      ? `Thành viên · Ban ${user.currentDepartment.name}${user.currentTermLabel ? ` (${user.currentTermLabel})` : ''}`
                      : user.department?.name
                      ? `Thành viên · Ban ${user.department.name}`
                      : '⚠️ Thành viên · Chưa có Ban'}
                  </span>
                  {user.chapterName && <span>• {user.chapterName}</span>}
                </div>
                <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                  Lộ trình học tập & phát triển BBE
                </h1>
                <p className="text-blue-100 text-xs md:text-sm max-w-xl leading-relaxed">
                  Hoàn thành các khóa học bắt buộc theo nhiệm kỳ để duy trì tư cách hoạt động và tích lũy Star danh dự.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-start md:items-center gap-3 shrink-0">
                {user.departmentHistory && user.departmentHistory.length > 0 && (
                  <button
                    onClick={() => setShowHistoryModal(true)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-bold backdrop-blur-md border border-white/25 transition shadow-xs"
                  >
                    <span>📜</span> Xem lịch sử phân ban
                  </button>
                )}
                <Link
                  href="/student/stars"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-amber-950 text-xs font-extrabold transition shadow-md"
                >
                  <span>⭐</span> {starBalance.toLocaleString('vi-VN')} Star
                </Link>
              </div>
            </div>
            <div className="absolute right-0 bottom-0 opacity-10 pointer-events-none text-9xl">📚</div>
          </div>

          {/* 3 KPI Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <Card className="p-6 border border-[#eff4ff] shadow-sm hover:shadow-md transition">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[#737686] uppercase tracking-wider">Khóa học hoàn thành</span>
                <span className="text-2xl">🎓</span>
              </div>
              <div className="text-2xl md:text-3xl font-extrabold text-[#172554] mb-1">
                {completedCoursesCount} / {totalCoursesCount} <span className="text-sm font-semibold text-[#737686]">khóa</span>
              </div>
              <p className="text-xs text-[#737686]">Hoàn thành 100% video và bài kiểm tra</p>
            </Card>

            <Card className="p-6 border border-[#eff4ff] shadow-sm hover:shadow-md transition">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[#737686] uppercase tracking-wider">Tiến độ bài học</span>
                <span className="text-2xl">📊</span>
              </div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-2xl md:text-3xl font-extrabold text-[#2563EB]">{overallProgress}%</span>
                <span className="text-xs font-bold text-[#737686]">({overallLessonsDone}/{overallLessonsTotal} bài)</span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mt-2">
                <div className="bg-[#2563EB] h-full rounded-full transition-all duration-500" style={{ width: `${overallProgress}%` }}></div>
              </div>
            </Card>

            <Card className="p-6 border border-[#eff4ff] shadow-sm hover:shadow-md transition">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[#737686] uppercase tracking-wider">Tổng Star tích lũy</span>
                <span className="text-2xl">⭐</span>
              </div>
              <div className="text-2xl md:text-3xl font-extrabold text-amber-600 mb-1">
                {starBalance.toLocaleString('vi-VN')} <span className="text-sm font-bold text-amber-700">Star</span>
              </div>
              <p className="text-xs text-[#737686]">Tích lũy từ video và quiz bài học</p>
            </Card>
          </div>

          {/* Countdown & Mandatory Deadline Banner (Item 7) */}
          {mandatoryCourses.length > 0 && msRemaining !== null && (
            <div className={`rounded-3xl p-6 border-2 transition-all shadow-sm ${urgencyLevel.bgColor} ${urgencyLevel.borderColor}`}>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold border ${urgencyLevel.textColor} ${urgencyLevel.borderColor} bg-white shadow-xs ${urgencyLevel.isPulse ? 'animate-pulse' : ''}`}>
                      {urgencyLevel.badgeText}
                    </span>
                    <span className="text-xs text-slate-500 font-medium">Hạn chót học tập bắt buộc</span>
                  </div>
                  <h3 className="text-lg md:text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                    Đồng hồ đếm ngược khóa học bắt buộc
                  </h3>
                  <p className="text-xs text-slate-600 max-w-xl">
                    Bạn còn <strong>{mandatoryCourses.length} khóa học bắt buộc</strong> cần hoàn tất trước hạn để duy trì quyền lợi thành viên và không bị giới hạn hoạt động.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-white px-5 py-4 rounded-2xl border border-slate-200 shadow-xs shrink-0">
                  <div className="text-center sm:text-left">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Thời gian còn lại</p>
                    <p className={`text-xl md:text-2xl font-mono font-extrabold tabular-nums ${urgencyLevel.textColor}`}>
                      {formatCountdown(msRemaining)}
                    </p>
                  </div>
                  <div className="h-8 w-px bg-slate-200 hidden sm:block"></div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Khóa bắt buộc</p>
                    <p className="text-sm font-bold text-[#172554]">
                      {enrichedCourses.filter((c) => c.isMandatory && c.isCompleted).length} / {enrichedCourses.filter((c) => c.isMandatory).length} hoàn thành
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Section 1: Mandatory Courses (Priority) */}
          {mandatoryCourses.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-[#172554] flex items-center gap-2" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                    <span>📌</span> Khóa học bắt buộc của bạn ({mandatoryCourses.length})
                  </h2>
                  <p className="text-xs text-[#737686] mt-0.5">Khóa học bắt buộc theo ban và chức vụ của bạn</p>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                {mandatoryCourses.map((c) => {
                  const remDays = c.dueAt ? Math.ceil((new Date(c.dueAt).getTime() - currentTime) / (1000 * 60 * 60 * 24)) : null;
                  const itemUrgency = getUrgencyLevel(remDays);
                  return (
                    <Link key={c.courseId} href={`/student/courses/${c.courseId}`} className="group">
                      <Card className="p-0 overflow-hidden border border-[#eff4ff] shadow-sm hover:shadow-md transition-all group-hover:-translate-y-1 h-full flex flex-col justify-between">
                        <div>
                          <div className="relative aspect-video w-full overflow-hidden bg-slate-100">
                            {c.coverUrl ? (
                              <img
                                src={c.coverUrl}
                                alt={`Ảnh bìa ${c.title}`}
                                className="aspect-video w-full object-cover transition-transform duration-500 group-hover:scale-105"
                              />
                            ) : (
                              <div className="grid aspect-video w-full place-items-center bg-gradient-to-br from-[#172554] via-blue-700 to-indigo-500 text-4xl">
                                📚
                              </div>
                            )}
                            <div className="absolute top-3 left-3">
                              <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold border shadow-xs bg-white ${itemUrgency.textColor} ${itemUrgency.borderColor} ${itemUrgency.isPulse ? 'animate-pulse' : ''}`}>
                                {itemUrgency.badgeText}
                              </span>
                            </div>
                          </div>

                          <div className="p-5 space-y-3">
                            <h3 className="font-bold text-base text-[#172554] group-hover:text-[#2563EB] transition line-clamp-2">
                              {c.title}
                            </h3>
                            <p className="text-xs text-[#737686] line-clamp-2 leading-relaxed">
                              {c.description || 'Chương trình đào tạo kỹ năng chuyên sâu BBE.'}
                            </p>

                            <div className="space-y-1 pt-1">
                              <div className="flex justify-between text-xs">
                                <span className="font-medium text-slate-500">Tiến độ</span>
                                <span className="font-bold text-[#2563EB]">{c.progressPercent}%</span>
                              </div>
                              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                <div className="bg-[#2563EB] h-full rounded-full transition-all" style={{ width: `${c.progressPercent}%` }}></div>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="px-5 py-3.5 bg-[#f8f9ff] border-t border-[#eff4ff] flex items-center justify-between text-xs">
                          <span className="text-[#737686]">🏛️ {c.sessionCount || 0} buổi học</span>
                          <span className="font-bold text-[#2563EB] group-hover:underline">
                            {c.isStarted ? 'Tiếp tục học →' : 'Bắt đầu học →'}
                          </span>
                        </div>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 2: All Courses with Filter */}
          <div className="space-y-5 pt-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#eff4ff] pb-4">
              <div>
                <h2 className="text-xl font-bold text-[#172554] flex items-center gap-2" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                  <span>📚</span> Tất cả khóa học ({enrichedCourses.length})
                </h2>
                <p className="text-xs text-[#737686] mt-0.5">Danh mục toàn bộ khóa học công khai và nội bộ</p>
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center gap-1.5 p-1 bg-[#f8f9ff] rounded-2xl border border-[#cbdbf5] self-start sm:self-auto">
                <button
                  onClick={() => setFilter('ALL')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                    filter === 'ALL'
                      ? 'bg-white text-[#2563EB] shadow-xs'
                      : 'text-[#737686] hover:text-[#172554]'
                  }`}
                >
                  Tất cả ({enrichedCourses.length})
                </button>
                <button
                  onClick={() => setFilter('IN_PROGRESS')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                    filter === 'IN_PROGRESS'
                      ? 'bg-white text-[#2563EB] shadow-xs'
                      : 'text-[#737686] hover:text-[#172554]'
                  }`}
                >
                  Đang học ({enrichedCourses.filter((c) => c.isStarted && !c.isCompleted).length})
                </button>
                <button
                  onClick={() => setFilter('NOT_STARTED')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                    filter === 'NOT_STARTED'
                      ? 'bg-white text-[#2563EB] shadow-xs'
                      : 'text-[#737686] hover:text-[#172554]'
                  }`}
                >
                  Chưa học ({enrichedCourses.filter((c) => !c.isStarted && !c.isCompleted).length})
                </button>
                <button
                  onClick={() => setFilter('COMPLETED')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                    filter === 'COMPLETED'
                      ? 'bg-white text-emerald-700 shadow-xs'
                      : 'text-[#737686] hover:text-[#172554]'
                  }`}
                >
                  Đã đạt ({enrichedCourses.filter((c) => c.isCompleted).length})
                </button>
              </div>
            </div>

            {loading && courses.length === 0 ? (
              <div className="grid md:grid-cols-2 gap-6 animate-pulse">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="h-60 bg-white rounded-3xl border border-[#eff4ff] p-6 space-y-4">
                    <div className="h-6 bg-slate-200 rounded-md w-3/4"></div>
                    <div className="h-4 bg-slate-100 rounded-md w-full"></div>
                    <div className="h-4 bg-slate-100 rounded-md w-1/2"></div>
                  </div>
                ))}
              </div>
            ) : filteredCourses.length === 0 ? (
              <Card className="text-center py-14 border border-[#eff4ff]">
                <p className="text-3xl mb-2">🔍</p>
                <p className="text-base font-bold text-[#172554] mb-1">Không có khóa học nào trong mục này</p>
                <p className="text-xs text-[#737686]">Hãy thử chọn bộ lọc khác hoặc quay lại xem tất cả khóa học.</p>
                <button
                  onClick={() => setFilter('ALL')}
                  className="mt-4 px-4 py-2 bg-blue-50 text-[#2563EB] text-xs font-bold rounded-xl hover:bg-blue-100 transition"
                >
                  Xem tất cả khóa học
                </button>
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 gap-6">
                {filteredCourses.map((c) => {
                  return (
                    <Link key={c.courseId} href={`/student/courses/${c.courseId}`} className="group">
                      <Card className="p-0 overflow-hidden border border-[#eff4ff] shadow-sm hover:shadow-md transition-all group-hover:-translate-y-1 h-full flex flex-col justify-between">
                        <div>
                          <div className="relative aspect-video w-full overflow-hidden bg-slate-100">
                            {c.coverUrl ? (
                              <img
                                src={c.coverUrl}
                                alt={`Ảnh bìa ${c.title}`}
                                className="aspect-video w-full object-cover transition-transform duration-500 group-hover:scale-105"
                              />
                            ) : (
                              <div className="grid aspect-video w-full place-items-center bg-gradient-to-br from-[#172554] via-blue-700 to-indigo-500 text-4xl">
                                📚
                              </div>
                            )}
                            <div className="absolute top-3 right-3 flex items-center gap-1.5">
                              {c.isCompleted && (
                                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-500 text-white shadow-xs">
                                  ✓ Đã hoàn thành
                                </span>
                              )}
                              <span
                                className={`inline-flex items-center text-xs font-bold px-2.5 py-0.5 rounded-full shadow-xs ${
                                  c.visibility === 'PUBLIC'
                                    ? 'bg-blue-100 text-blue-700'
                                    : 'bg-white/90 text-slate-700 backdrop-blur-xs'
                                }`}
                              >
                                {c.visibility === 'PUBLIC' ? '🌐 Public' : '🔒 Private'}
                              </span>
                            </div>
                          </div>

                          <div className="p-5 space-y-3">
                            <h3 className="font-bold text-base text-[#172554] group-hover:text-[#2563EB] transition line-clamp-2">
                              {c.title}
                            </h3>
                            <p className="text-xs text-[#737686] line-clamp-2 leading-relaxed">
                              {c.description || 'Chương trình đào tạo kỹ năng chuyên sâu BBE.'}
                            </p>

                            {/* Progress bar if started */}
                            {c.isStarted && (
                              <div className="space-y-1 pt-1">
                                <div className="flex justify-between text-xs">
                                  <span className="font-medium text-slate-500">Tiến độ</span>
                                  <span className={`font-bold ${c.isCompleted ? 'text-emerald-600' : 'text-[#2563EB]'}`}>
                                    {c.progressPercent}%
                                  </span>
                                </div>
                                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${c.isCompleted ? 'bg-emerald-500' : 'bg-[#2563EB]'}`}
                                    style={{ width: `${c.progressPercent}%` }}
                                  ></div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="px-5 py-3.5 bg-[#f8f9ff] border-t border-[#eff4ff] flex items-center justify-between text-xs">
                          <span className="text-[#737686]">🏛️ {c.sessionCount || 0} buổi học</span>
                          <span className="font-bold text-[#2563EB] group-hover:underline">
                            {c.isCompleted ? 'Xem lại bài học →' : c.isStarted ? 'Tiếp tục học →' : 'Vào học ngay →'}
                          </span>
                        </div>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Modal: Department Term History */}
          <Modal
            isOpen={showHistoryModal}
            onClose={() => setShowHistoryModal(false)}
            maxWidth="max-w-xl"
          >
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-[#eff4ff] pb-3">
                <div>
                  <h3 className="text-lg font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                    📜 Lịch sử phân ban qua các nhiệm kỳ
                  </h3>
                  <p className="text-xs text-[#737686]">Quá trình cống hiến và tham gia công tác tại Chapter của bạn</p>
                </div>
                <button
                  onClick={() => setShowHistoryModal(false)}
                  className="text-[#737686] hover:text-[#172554] text-xl font-bold p-1 rounded-lg hover:bg-slate-100 transition"
                >
                  ✕
                </button>
              </div>

              {!user.departmentHistory || user.departmentHistory.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">Chưa ghi nhận lịch sử phân ban nhiệm kỳ trước.</p>
              ) : (
                <div className="space-y-2.5 max-h-[60vh] overflow-y-auto">
                  {user.departmentHistory.map((item: any) => (
                    <div key={item.id} className="p-3.5 bg-[#f8f9ff] rounded-2xl flex items-center justify-between border border-[#eff4ff]">
                      <div>
                        <p className="font-bold text-sm text-[#172554]">
                          {item.termLabel || 'Nhiệm kỳ'} — {item.departmentName}
                        </p>
                        <p className="text-[11px] text-[#737686] mt-0.5">
                          Thời gian: {new Date(item.startsAt).toLocaleDateString('vi-VN')}
                          {item.endsAt && ` • ${new Date(item.endsAt).toLocaleDateString('vi-VN')}`}
                        </p>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                        item.status === 'ACTIVE'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}>
                        {item.status === 'ACTIVE' ? 'Đang công tác' : 'Hoàn thành'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <Button size="sm" onClick={() => setShowHistoryModal(false)}>
                  Đóng
                </Button>
              </div>
            </div>
          </Modal>
        </div>
      ) : (
        /* Guest View */
        <div className="flex flex-col flex-1">
          <header className="bg-white/95 backdrop-blur-md border-b border-[#e5eeff] px-6 py-3 sticky top-0 z-50">
            <div className="max-w-6xl mx-auto flex items-center justify-between">
              <Link href="/" className="flex items-center gap-3">
                <img
                  src="/images/logo-transparent.png"
                  alt="BBE Logo"
                  className="h-10 w-auto object-contain"
                />
              </Link>
              <div className="flex items-center gap-3">
                <Link href="/leaderboard" className="text-sm font-semibold text-[#172554] hover:text-[#2563EB] transition px-3 py-2">
                  Bảng xếp hạng
                </Link>
                <Link href="/login">
                  <Button size="sm">Đăng nhập</Button>
                </Link>
              </div>
            </div>
          </header>

          <main className="max-w-6xl mx-auto px-6 py-12 flex-1 w-full">
            <div className="mb-10 text-center max-w-2xl mx-auto">
              <h1 className="text-3xl md:text-4xl font-extrabold text-[#172554] mb-3" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                Khám phá các khóa học BBE
              </h1>
              <p className="text-[#737686] text-sm">
                Đăng nhập để xem đầy đủ các khóa học nội bộ và bài kiểm tra cấp chứng chỉ.
              </p>
            </div>

            {!mounted || (loading && courses.length === 0) ? (
              <div className="grid md:grid-cols-3 gap-6 animate-pulse">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="h-60 bg-white rounded-3xl border border-[#eff4ff] p-6 space-y-4">
                    <div className="h-6 bg-slate-200 rounded-md w-3/4"></div>
                    <div className="h-4 bg-slate-100 rounded-md w-full"></div>
                  </div>
                ))}
              </div>
            ) : courses.length === 0 ? (
              <Card className="text-center py-16">
                <p className="text-lg font-bold text-[#172554] mb-2">Chưa có khóa học công khai</p>
                <p className="text-sm text-[#737686]">Vui lòng quay lại sau.</p>
              </Card>
            ) : (
              <div className="grid md:grid-cols-3 gap-6">
                {courses
                  .filter((c) => c.visibility === 'PUBLIC')
                  .map((c) => (
                    <Link key={c.courseId || c.id} href={`/student/courses/${c.courseId || c.id}`}>
                      <Card className="hover:-translate-y-1 transition-all cursor-pointer group h-full overflow-hidden border border-[#eff4ff] p-0 shadow-sm hover:shadow-md">
                        <div className="aspect-video w-full overflow-hidden bg-slate-100">
                          {c.coverUrl ? (
                            <img
                              src={c.coverUrl}
                              alt={`Ảnh bìa ${c.title}`}
                              className="aspect-video w-full object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                          ) : (
                            <div className="grid aspect-video w-full place-items-center bg-gradient-to-br from-[#172554] via-blue-700 to-indigo-500 text-4xl">
                              📚
                            </div>
                          )}
                        </div>
                        <div className="p-6">
                          <h3 className="text-lg font-bold text-[#172554] group-hover:text-[#2563EB] transition-colors mb-2 line-clamp-2">
                            {c.title}
                          </h3>
                          <p className="text-sm text-[#737686] line-clamp-3 mb-4">
                            {c.description || 'Chương trình đào tạo kỹ năng chuyên sâu BBE.'}
                          </p>
                          <div className="flex items-center justify-between pt-4 border-t border-[#eff4ff] text-xs text-[#737686]">
                            <span>🏛️ {c.sessionCount || 0} buổi học</span>
                            <span className="font-bold text-[#2563EB] group-hover:underline">Chi tiết →</span>
                          </div>
                        </div>
                      </Card>
                    </Link>
                  ))}
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
