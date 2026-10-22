'use client';

import { useState } from 'react';
import Card from '@/components/ui/Card';

export interface LearnerProfileCourse {
  courseId: string;
  title: string;
  totalLessons: number;
  completedLessons: number;
  progressPercentage?: number;
  progressPercent?: number;
  isCompleted: boolean;
  allVideosDone?: boolean;
  hasAssessment?: boolean;
  latestAttempt?: {
    score: number | null;
    passed: boolean;
    submittedAt?: string | Date | null;
  } | null;
  state?: string;
}

export interface LearnerProfileViewProps {
  user: {
    userId?: string;
    id?: string;
    displayName?: string;
    email?: string;
    status?: string;
    role?: string;
    accountState?: string;
    chapterName?: string;
    chapter?: { id?: string; name?: string };
    departmentName?: string;
    department?: { id?: string; name?: string };
    isLead?: boolean;
    createdAt?: string | Date;
    effectivePositions?: any[];
    dna?: any;
    deactivatedByRole?: string;
  };
  progressData?: {
    summary?: {
      completedCourses?: number;
      totalCourses?: number;
      completedLessons?: number;
      totalLessons?: number;
      overallProgressPercent?: number;
      avgCourseProgressPercent?: number;
      avgProgress?: number;
      avgQuizScore?: number;
      starBalance?: number;
      stars?: number;
    } | null;
    courses?: LearnerProfileCourse[];
    learningDetail?: any[];
  } | null;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  headerActions?: React.ReactNode;
  children?: React.ReactNode;
}

export default function LearnerProfileView({
  user,
  progressData,
  loading = false,
  error = null,
  onRefresh,
  headerActions,
  children,
}: LearnerProfileViewProps) {
  const [tabFilter, setTabFilter] = useState<'ALL' | 'IN_PROGRESS' | 'NOT_STARTED' | 'COMPLETED'>('ALL');

  const rawCourses = progressData?.courses || [];
  const courses = rawCourses.map((c) => ({
    ...c,
    progressPercent: c.progressPercent ?? c.progressPercentage ?? 0,
  }));

  const completedCourses = courses.filter((c) => c.isCompleted);
  const inProgressCourses = courses.filter(
    (c) => !c.isCompleted && (c.completedLessons > 0 || c.latestAttempt)
  );
  const notStartedCourses = courses.filter(
    (c) => !c.isCompleted && c.completedLessons === 0 && !c.latestAttempt
  );

  const filteredCourses =
    tabFilter === 'COMPLETED'
      ? completedCourses
      : tabFilter === 'IN_PROGRESS'
      ? inProgressCourses
      : tabFilter === 'NOT_STARTED'
      ? notStartedCourses
      : courses;

  const summary = progressData?.summary;
  const totalCourses = summary?.totalCourses ?? courses.length;
  const completedCoursesCount = summary?.completedCourses ?? completedCourses.length;
  const totalLessons = summary?.totalLessons ?? courses.reduce((acc, c) => acc + (c.totalLessons || 0), 0);
  const completedLessons = summary?.completedLessons ?? courses.reduce((acc, c) => acc + (c.completedLessons || 0), 0);
  const avgProgress = summary?.overallProgressPercent ?? summary?.avgCourseProgressPercent ?? summary?.avgProgress ??
    (totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0);
  const avgScore = summary?.avgQuizScore ?? null;
  const starsCount = summary?.stars ?? summary?.starBalance ?? null;
  const learningDetail = progressData?.learningDetail || [];

  const isLead =
    user.isLead ||
    user.role === 'CHAPTER_LEADER' ||
    user.effectivePositions?.some((p: any) => p.code === 'DEPARTMENT_LEAD' || p.code === 'CHAPTER_PRESIDENT');

  const chapterDisplay = user.chapterName || user.chapter?.name || 'Chưa gán Chapter';
  const deptDisplay = user.departmentName || user.department?.name || 'Chưa phân ban';

  return (
    <div className="space-y-6">
      {/* 1. Header Profile Box */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-700 via-indigo-600 to-blue-500 text-white flex items-center justify-center font-extrabold text-2xl shadow-sm shrink-0">
            {(user.displayName || user.email || 'U').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-bold text-[#172554] truncate">
                {user.displayName || user.email?.split('@')[0]}
              </h2>
              {isLead ? (
                <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                  👑 Lãnh đạo / LT
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                  👤 Thành viên
                </span>
              )}
              {user.status === 'ACTIVE' ? (
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                  ✓ Hoạt động
                </span>
              ) : user.accountState === 'OVERDUE_LOCK' ? (
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-200">
                  🔒 Khóa quá hạn
                </span>
              ) : user.accountState === 'PASSWORD_LOCK' ? (
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                  🔒 Khóa mật khẩu
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-800 border border-slate-300">
                  ⛔ Vô hiệu hóa
                </span>
              )}
            </div>

            <p className="text-xs text-[#737686] truncate mt-0.5">{user.email}</p>

            <div className="flex items-center gap-3 text-xs text-slate-500 mt-2 flex-wrap">
              <span>🏛️ <strong>{chapterDisplay}</strong></span>
              <span>•</span>
              <span>🏢 <strong>Ban {deptDisplay}</strong></span>
              {user.createdAt && (
                <>
                  <span>•</span>
                  <span>📅 Tham gia: {new Date(user.createdAt).toLocaleDateString('vi-VN')}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Actions / Buttons */}
        <div className="flex items-center gap-2.5 shrink-0 self-end md:self-center">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="p-2.5 text-xs font-bold text-slate-600 hover:text-blue-600 rounded-xl bg-slate-100 hover:bg-slate-200 transition shadow-2xs"
              title="Làm mới dữ liệu"
            >
              🔄
            </button>
          )}
          {headerActions}
        </div>
      </div>

      {/* 2. KPI Summary Cards */}
      <div className={`grid grid-cols-2 ${starsCount !== null ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-4`}>
        <Card className="p-4.5 border border-slate-200 bg-white rounded-2xl shadow-2xs">
          <span className="text-[11px] font-bold text-[#737686] uppercase tracking-wider block mb-1">
            Khóa hoàn thành
          </span>
          <div className="text-xl font-extrabold text-[#172554]">
            {completedCoursesCount} / {totalCourses}
          </div>
          <span className="text-[11px] text-[#737686]">khóa học</span>
        </Card>

        <Card className="p-4.5 border border-slate-200 bg-white rounded-2xl shadow-2xs">
          <span className="text-[11px] font-bold text-[#737686] uppercase tracking-wider block mb-1">
            Bài học đã học
          </span>
          <div className="text-xl font-extrabold text-[#2563EB]">
            {completedLessons} / {totalLessons}
          </div>
          <span className="text-[11px] text-[#737686]">bài hoàn thành</span>
        </Card>

        <Card className="p-4.5 border border-slate-200 bg-white rounded-2xl shadow-2xs">
          <span className="text-[11px] font-bold text-[#737686] uppercase tracking-wider block mb-1">
            Tiến độ trung bình
          </span>
          <div className="text-xl font-extrabold text-indigo-600">
            {avgProgress}%
          </div>
          <div className="w-full bg-slate-100 h-1.5 rounded-full mt-1.5 overflow-hidden">
            <div className="bg-indigo-600 h-full rounded-full transition-all" style={{ width: `${avgProgress}%` }} />
          </div>
        </Card>

        <Card className="p-4.5 border border-slate-200 bg-white rounded-2xl shadow-2xs">
          <span className="text-[11px] font-bold text-[#737686] uppercase tracking-wider block mb-1">
            Điểm kiểm tra TB
          </span>
          <div className="text-xl font-extrabold text-emerald-600">
            {avgScore !== null ? `${avgScore}%` : 'Chưa thi'}
          </div>
          <span className="text-[11px] text-[#737686]">ngưỡng đạt: ≥85%</span>
        </Card>

        {starsCount !== null && (
          <Card className="p-4.5 border border-amber-200 bg-amber-50/40 rounded-2xl shadow-2xs col-span-2 lg:col-span-1">
            <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider block mb-1">
              ⭐ Sao tích lũy
            </span>
            <div className="text-xl font-extrabold text-amber-600">
              {starsCount} <span className="text-sm font-semibold text-amber-700">sao</span>
            </div>
            <span className="text-[11px] text-amber-800/80">Số dư khả dụng</span>
          </Card>
        )}
      </div>

      {/* 3. Danh Sách Khóa Học */}
      <Card className="border border-slate-200 bg-white rounded-3xl overflow-hidden shadow-xs">
        {/* Tab Filter Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
          <h3 className="font-bold text-sm text-[#172554]">
            Tiến độ chi tiết từng khóa học ({courses.length})
          </h3>

          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setTabFilter('ALL')}
              className={`px-3 py-1 rounded-xl transition ${
                tabFilter === 'ALL'
                  ? 'bg-blue-600 text-white font-bold shadow-2xs'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              Tất cả ({courses.length})
            </button>
            <button
              type="button"
              onClick={() => setTabFilter('IN_PROGRESS')}
              className={`px-3 py-1 rounded-xl transition ${
                tabFilter === 'IN_PROGRESS'
                  ? 'bg-blue-600 text-white font-bold shadow-2xs'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              Đang học ({inProgressCourses.length})
            </button>
            <button
              type="button"
              onClick={() => setTabFilter('COMPLETED')}
              className={`px-3 py-1 rounded-xl transition ${
                tabFilter === 'COMPLETED'
                  ? 'bg-blue-600 text-white font-bold shadow-2xs'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              Đã xong ({completedCourses.length})
            </button>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="p-8 text-center text-xs text-slate-400 animate-pulse">
            Đang tải tiến độ học tập chi tiết...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-xs text-red-600 font-semibold">
            {error}
          </div>
        ) : filteredCourses.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            Không có khóa học nào trong danh mục này.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredCourses.map((c) => {
              const isDone = c.isCompleted;
              const allVideosDone = c.allVideosDone;
              const hasAssessment = c.hasAssessment;
              const latestAttempt = c.latestAttempt;
              const testPassed = latestAttempt?.passed;

              return (
                <div key={c.courseId} className="px-6 py-4 hover:bg-slate-50/50 transition">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-sm text-[#172554] truncate">{c.title}</p>
                        {isDone ? (
                          <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                            ✓ Hoàn thành khóa
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                            Đang học
                          </span>
                        )}
                      </div>

                      {/* Thông tin video & quiz */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#737686] mt-1.5">
                        <span>
                          📚 Bài học:{' '}
                          <strong className="text-[#172554]">
                            {c.completedLessons}/{c.totalLessons} bài
                          </strong>
                        </span>
                        <span>•</span>
                        <span>
                          🎬 Video:{' '}
                          {allVideosDone ? (
                            <strong className="text-emerald-700">✓ Đã xem hết</strong>
                          ) : (
                            <span className="text-blue-700">Đang học ({c.progressPercent}%)</span>
                          )}
                        </span>
                        <span>•</span>
                        <span>
                          📝 Bài kiểm tra:{' '}
                          {!hasAssessment ? (
                            <span className="text-slate-400">Không có bài test</span>
                          ) : latestAttempt ? (
                            testPassed ? (
                              <strong className="text-emerald-700">✓ Đã đạt ({latestAttempt.score}%)</strong>
                            ) : (
                              <strong className="text-red-600">✗ Chưa đạt ({latestAttempt.score}%)</strong>
                            )
                          ) : (
                            <span className="text-amber-700 font-semibold">Chưa làm bài</span>
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-extrabold text-sm text-[#2563EB] w-12 text-right">
                        {c.progressPercent}%
                      </span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        isDone ? 'bg-emerald-500' : allVideosDone ? 'bg-amber-500' : 'bg-[#2563EB]'
                      }`}
                      style={{ width: `${c.progressPercent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 4. Chi Tiết Từng Module / Video / Quiz (nếu có learningDetail) */}
      {learningDetail && learningDetail.length > 0 && (
        <Card className="border border-slate-200 bg-white rounded-3xl overflow-hidden shadow-xs">
          <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <h3 className="font-bold text-sm text-[#172554]">
              Chi tiết bài giảng, video và bài kiểm tra
            </h3>
            <span className="text-xs text-slate-500 font-medium">
              {learningDetail.length} khóa học
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {learningDetail.map((course: any) => (
              <details key={course.courseId} className="group px-6 py-4">
                <summary className="cursor-pointer list-none flex items-center justify-between gap-3 font-bold text-sm text-[#172554] hover:text-blue-600 transition">
                  <span className="flex items-center gap-2">
                    <span className="text-blue-600 group-open:rotate-90 transition-transform">▶</span>
                    {course.title}
                  </span>
                  <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-lg group-open:hidden">
                    Chi tiết ↓
                  </span>
                </summary>

                <div className="mt-4 space-y-3.5 pl-4 border-l-2 border-blue-100">
                  {/* Bài thi cuối khóa (nếu có) */}
                  {course.finalAssessment && (
                    <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-[#172554]">
                          🎯 Bài thi cuối khóa: {course.finalAssessment.title}
                        </span>
                        {course.finalAssessment.stars ? (
                          <span className="font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full text-[11px]">
                            ⭐ {course.finalAssessment.stars} sao
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-2 text-[#596174] flex flex-wrap items-center gap-2">
                        {course.finalAssessment.latestAttempt ? (
                          <span
                            className={`font-semibold ${
                              course.finalAssessment.latestAttempt.passed
                                ? 'text-emerald-700'
                                : 'text-red-600'
                            }`}
                          >
                            {course.finalAssessment.latestAttempt.passed ? '✓ Đạt' : '✗ Chưa đạt'} (
                            {course.finalAssessment.latestAttempt.scorePercent ?? '—'}%) · Lần nộp:{' '}
                            {course.finalAssessment.latestAttempt.number}/
                            {course.finalAssessment.attemptCount}
                          </span>
                        ) : (
                          <span className="text-amber-700">Chưa nộp bài ({course.finalAssessment.attemptCount} lần)</span>
                        )}
                        {course.finalAssessment.latestAttempt?.submittedAt && (
                          <span className="text-slate-400">
                            • {new Date(course.finalAssessment.latestAttempt.submittedAt).toLocaleString('vi-VN')}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Danh sách Modules */}
                  {(course.modules || []).map((module: any) => (
                    <div key={module.moduleId} className="rounded-2xl border border-slate-200 p-3.5 bg-slate-50/40">
                      <p className="text-xs font-bold text-blue-700 mb-2">
                        Module {Number(module.order) + 1}: {module.title}
                      </p>

                      <div className="space-y-2">
                        {(module.lessons || []).map((lesson: any) => (
                          <div
                            key={lesson.lessonId}
                            className="p-2.5 rounded-xl bg-white border border-slate-100 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                          >
                            <span className="font-semibold text-[#172554] truncate max-w-sm">
                              {lesson.title}
                            </span>

                            <div className="flex items-center gap-3 shrink-0 flex-wrap">
                              {/* Video */}
                              <span
                                className={`text-[11px] font-medium ${
                                  lesson.video?.completed ? 'text-emerald-700 font-bold' : 'text-amber-700'
                                }`}
                              >
                                📹{' '}
                                {lesson.video
                                  ? `${lesson.video.watchedPercent}% ${lesson.video.completed ? '✓' : ''} · ⭐ ${
                                      lesson.video.stars || 0
                                    }`
                                  : 'Không video'}
                              </span>

                              {/* Quiz */}
                              {lesson.quiz ? (
                                <span
                                  className={`text-[11px] font-medium ${
                                    lesson.quiz.latestAttempt?.passed
                                      ? 'text-emerald-700 font-bold'
                                      : 'text-slate-500'
                                  }`}
                                >
                                  📝{' '}
                                  {lesson.quiz.latestAttempt
                                    ? `${lesson.quiz.latestAttempt.scorePercent ?? 0}% (${
                                        lesson.quiz.latestAttempt.passed ? 'Đạt' : 'Chưa đạt'
                                      })`
                                    : 'Chưa thi'}
                                </span>
                              ) : (
                                <span className="text-[11px] text-slate-400">Không quiz</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </Card>
      )}

      {/* 5. Custom Children Components */}
      {children}
    </div>
  );
}
