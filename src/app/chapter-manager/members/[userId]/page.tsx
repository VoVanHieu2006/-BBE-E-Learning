'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { apiFetch, getCachedApiData, clearApiCache } from '@/lib/api/client';

const STATE_META: Record<string, { label: string; badge: string; bar: string }> = {
  COMPLETED: { label: '✓ Hoàn thành', badge: 'bg-green-100 text-green-700', bar: 'bg-green-500' },
  IN_PROGRESS: { label: 'Đang học', badge: 'bg-blue-100 text-blue-700', bar: 'bg-[#2563EB]' },
  NOT_STARTED: { label: 'Chưa học', badge: 'bg-slate-100 text-slate-600', bar: 'bg-slate-300' },
};

export default function MemberDetailPage({ params }: { params: { userId: string } }) {
  const [user, setUser] = useState<any>(null);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const canManageMembers = user?.role === 'CHAPTER_LEADER' || user?.role === 'ADMIN' || user?.canManageMembers === true;

  const handleToggleUserStatus = async () => {
    if (!data?.user?.userId) return;
    setActionLoading(true);
    const nextStatus = data.user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const res = await apiFetch(`/api/v1/users/${data.user.userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus, chapterId: user?.chapterId }),
    });
    setActionLoading(false);
    setShowConfirmModal(false);
    if (res.ok) {
      setData((prev: any) => ({
        ...prev,
        user: { ...prev.user, status: nextStatus },
      }));
      clearApiCache('/api/v1/chapters');
      clearApiCache('/api/v1/users');
    }
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      let parsed: any = null;
      const u = localStorage.getItem('user');
      if (u) {
        try {
          parsed = JSON.parse(u);
          setUser(parsed);
        } catch {}
      }
      loadMemberDetail(parsed?.role === 'ADMIN' ? 'all' : parsed?.chapterId);
    }
  }, [params.userId]);

  async function loadMemberDetail(chapterId?: string) {
    setLoading(true);
    setError(null);
    const targetChapter = chapterId || 'me';
    const url = `/api/v1/chapters/${targetChapter}/members/${params.userId}/course-progress`;

    const cached = getCachedApiData<any>(url);
    if (cached) {
      setData(cached);
      setLoading(false);
    }

    const res = await apiFetch(url);
    if (res.ok && res.data) {
      setData(res.data);
      setError(null);
    } else if (!cached) {
      setError(res.error?.message || 'Không tải được tiến độ của thành viên này');
    }
    setLoading(false);
  }

  const courses: any[] = data?.courses || [];
  const completedCourses = courses.filter((c) => c.isCompleted);
  const inProgressCourses = courses.filter(
    (c) => !c.isCompleted && (c.completedLessons > 0 || c.latestAttempt)
  );
  const notStartedCourses = courses.filter(
    (c) => !c.isCompleted && c.completedLessons === 0 && !c.latestAttempt
  );

  const renderCourseRow = (c: any) => {
    const isCompleted = c.isCompleted;
    const allVideosDone = c.allVideosDone;
    const hasAssessment = c.hasAssessment;
    const latestAttempt = c.latestAttempt;
    const testPassed = latestAttempt?.passed;

    return (
      <div key={c.courseId} className="px-5 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-[#172554] truncate">{c.title}</p>
              {isCompleted ? (
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-green-100 text-green-700">
                  ✓ Hoàn thành khóa
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  Chưa hoàn thành
                </span>
              )}
            </div>

            {/* Chi tiết 4 trạng thái theo nghiệp vụ */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#737686] mt-1.5">
              <span>
                📚 Bài học: <strong className="text-[#172554]">{c.completedLessons}/{c.totalLessons} bài</strong>
              </span>
              <span>•</span>
              <span>
                🎬 Video:{' '}
                {allVideosDone ? (
                  <strong className="text-green-700">✓ Đã học xong video</strong>
                ) : (
                  <span className="text-amber-700">Đang học ({c.progressPercent}%)</span>
                )}
              </span>
              <span>•</span>
              <span>
                📝 Kiểm tra:{' '}
                {!hasAssessment ? (
                  <span className="text-slate-500">Không có bài test</span>
                ) : latestAttempt ? (
                  testPassed ? (
                    <strong className="text-green-700">✓ Đã đạt ({latestAttempt.score}%)</strong>
                  ) : (
                    <strong className="text-red-600">✗ Chưa đạt ({latestAttempt.score}%)</strong>
                  )
                ) : (
                  <span className="text-amber-700 font-medium">Chưa làm bài test</span>
                )}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="font-bold text-[#2563EB] w-12 text-right">{c.progressPercent}%</span>
          </div>
        </div>

        <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              isCompleted ? 'bg-green-500' : allVideosDone ? 'bg-amber-500' : 'bg-[#2563EB]'
            }`}
            style={{ width: `${c.progressPercent}%` }}
          />
        </div>
      </div>
    );
  };

  const renderSection = (title: string, list: any[], emptyText: string) => (
    <Card className="border border-[#eff4ff] shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-[#eff4ff] bg-[#f8f9ff]">
        <h2 className="font-bold text-[#172554] text-sm">
          {title} <span className="text-[#737686] font-semibold">({list.length})</span>
        </h2>
      </div>
      {list.length === 0 ? (
        <p className="px-5 py-4 text-sm text-[#737686]">{emptyText}</p>
      ) : (
        <div className="divide-y divide-[#eff4ff]">{list.map(renderCourseRow)}</div>
      )}
    </Card>
  );

  return (
    <div className="min-h-screen bg-[#f8f9ff]">
      <main className="px-8 py-10 w-full min-w-0 max-w-5xl">
        <div className="mb-6">
          <Link
            href="/chapter-manager/members"
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white border border-[#cbdbf5] text-xs font-bold text-[#172554] hover:bg-[#eff4ff] hover:text-[#2563EB] hover:border-[#2563EB] shadow-xs transition-all"
          >
            ← Quay lại danh sách thành viên
          </Link>
        </div>

        {loading && !data ? (
          <div className="text-center py-12 text-[#737686]">Đang tải thông tin học viên...</div>
        ) : error && !data ? (
          <Card className="text-center py-10 border border-[#eff4ff]">
            <p className="text-lg font-semibold text-[#172554] mb-2">Không tìm thấy thông tin học viên</p>
            <p className="text-sm text-[#737686]">{error}</p>
          </Card>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                  {data?.user?.displayName ? data.user.displayName : data?.user?.email}
                </h1>
                <p className="text-[#737686] mt-0.5 text-sm font-medium">
                  {data?.user?.email}
                </p>
                <p className="text-[#737686] mt-1 text-xs" suppressHydrationWarning>
                  Ngày tham gia:{' '}
                  {data?.user?.joinedAt ? new Date(data.user.joinedAt).toLocaleDateString('vi-VN') : 'Mới tham gia'}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span
                  className={`text-xs font-bold px-3 py-1 rounded-full ${
                    data?.user?.status === 'ACTIVE'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  {data?.user?.status === 'ACTIVE' ? '✓ Đang hoạt động' : 'Đã vô hiệu hóa'}
                </span>

                {canManageMembers && (
                  <Button
                    variant="outline"
                    size="sm"
                    className={
                      data?.user?.status === 'ACTIVE'
                        ? 'bg-red-50 text-red-700 border-red-300 hover:bg-red-100 font-bold text-xs'
                        : 'bg-green-50 text-green-700 border-green-300 hover:bg-green-100 font-bold text-xs'
                    }
                    onClick={() => setShowConfirmModal(true)}
                    loading={actionLoading}
                  >
                    {data?.user?.status === 'ACTIVE' ? '⛔ Vô hiệu hóa tài khoản' : '✓ Kích hoạt lại'}
                  </Button>
                )}
              </div>
            </div>

            {/* Modal xác nhận vô hiệu hóa */}
            {showConfirmModal && (
              <Modal
                isOpen={showConfirmModal}
                onClose={() => setShowConfirmModal(false)}
                maxWidth="max-w-md"
              >
                <div className="space-y-4 p-2">
                  <div className="flex items-center justify-between pb-2 border-b border-[#eff4ff]">
                    <h3 className="text-base font-bold text-red-700">
                      {data?.user?.status === 'ACTIVE'
                        ? 'Xác nhận vô hiệu hóa tài khoản'
                        : 'Xác nhận kích hoạt tài khoản'}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowConfirmModal(false)}
                      className="text-[#737686] hover:text-[#172554] text-base font-bold px-2 py-1"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="text-xs text-[#596174] leading-relaxed">
                    {data?.user?.status === 'ACTIVE'
                      ? `Bạn có chắc muốn vô hiệu hóa tài khoản ${data?.user?.email}? Tài khoản này sẽ không thể đăng nhập học tập và không tính vào các báo cáo nhiệm kỳ mới.`
                      : `Bạn có chắc muốn kích hoạt lại tài khoản ${data?.user?.email}?`}
                  </p>
                  <div className="flex justify-end gap-2 pt-2 border-t border-[#eff4ff]">
                    <Button variant="outline" size="sm" onClick={() => setShowConfirmModal(false)}>
                      Hủy
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      className={data?.user?.status === 'ACTIVE' ? 'bg-red-600 hover:bg-red-700 text-white font-bold' : 'bg-green-600 hover:bg-green-700 text-white font-bold'}
                      loading={actionLoading}
                      onClick={handleToggleUserStatus}
                    >
                      {data?.user?.status === 'ACTIVE' ? 'Xác nhận vô hiệu hóa' : 'Kích hoạt lại'}
                    </Button>
                  </div>
                </div>
              </Modal>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card shadow="md" className="border border-[#eff4ff]">
                <div className="text-xs font-semibold text-[#737686] mb-1">Khóa học hoàn thành</div>
                <div className="text-2xl font-bold text-[#172554]">
                  {data?.summary?.completedCourses || 0} / {data?.summary?.totalCourses || 0}{' '}
                  <span className="text-sm font-normal text-[#737686]">khóa</span>
                </div>
                <div className="text-[11px] text-[#737686] mt-1">Đạt chuẩn học 100% video & pass bài test</div>
              </Card>

              <Card shadow="md" className="border border-[#eff4ff]">
                <div className="text-xs font-semibold text-blue-700 mb-1">Tiến độ bài học toàn hệ thống</div>
                <div className="text-2xl font-bold text-[#2563EB]">
                  {data?.summary?.avgProgress || 0}%
                </div>
                <div className="text-[11px] font-semibold text-[#172554] mt-1">
                  Đã học {data?.summary?.completedLessons || 0} / {data?.summary?.totalLessons || 0} bài giảng
                </div>
              </Card>

              <Card shadow="md" className="border border-[#eff4ff]">
                <div className="text-xs font-semibold text-amber-700 mb-1">⭐ Tổng sao đã nhận</div>
                <div className="text-2xl font-bold text-amber-600">
                  {data?.summary?.stars || 0} <span className="text-sm font-normal text-[#737686]">⭐</span>
                </div>
                <div className="text-[11px] text-[#737686] mt-1">
                  Tiến độ khóa học: {data?.summary?.avgProgress || 0}%
                </div>
              </Card>
            </div>

            {Array.isArray(data?.learningDetail) && data.learningDetail.length > 0 && (
              <Card className="border border-[#eff4ff] shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-[#eff4ff] bg-[#f8f9ff]">
                  <h2 className="font-bold text-[#172554] text-sm">Chi tiết bài học, video và bài kiểm tra</h2>
                </div>
                <div className="divide-y divide-[#eff4ff]">
                  {data.learningDetail.map((course: any) => (
                    <details key={course.courseId} className="group px-5 py-3">
                      <summary className="cursor-pointer list-none flex items-center justify-between gap-3 font-semibold text-[#172554]">
                        <span>{course.title}</span>
                        <span className="text-xs text-[#2563EB] group-open:hidden">Xem chi tiết ↓</span>
                      </summary>
                      <div className="mt-4 space-y-3">
                        {course.finalAssessment && (
                          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs">
                            <p className="font-semibold text-[#172554]">Bài thi cuối khóa: {course.finalAssessment.title}</p>
                            <p className="mt-1 text-[#596174]">
                              {course.finalAssessment.latestAttempt
                                ? `Lần ${course.finalAssessment.latestAttempt.number}/${course.finalAssessment.attemptCount} · ${course.finalAssessment.latestAttempt.scorePercent ?? '—'}% · ${course.finalAssessment.latestAttempt.passed ? 'Đạt' : 'Chưa đạt'} · ${course.finalAssessment.latestAttempt.status}`
                                : `Chưa nộp bài (${course.finalAssessment.attemptCount} lần)`}
                              {' · '}⭐ {course.finalAssessment.stars || 0}
                            </p>
                            {course.finalAssessment.latestAttempt?.submittedAt && <p className="mt-1 text-[11px] text-[#737686]">Nộp lúc {new Date(course.finalAssessment.latestAttempt.submittedAt).toLocaleString('vi-VN')}</p>}
                          </div>
                        )}
                        {(course.modules || []).map((module: any) => (
                          <div key={module.moduleId} className="rounded-xl border border-[#eff4ff] p-3">
                            <p className="text-xs font-bold text-[#2563EB]">Module {Number(module.order) + 1}: {module.title}</p>
                            {(module.lessons || []).map((lesson: any) => (
                              <div key={lesson.lessonId} className="mt-2 grid grid-cols-1 gap-1 border-t border-[#f1f5f9] pt-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-3">
                                <span className="font-medium text-[#172554]">{lesson.title}</span>
                                <span className={lesson.video?.completed ? 'text-emerald-700' : 'text-amber-700'}>
                                  📹 {lesson.video ? `${lesson.video.watchedPercent}% ${lesson.video.completed ? '✓' : ''} · ⭐ ${lesson.video.stars || 0}` : 'Không có video'}
                                </span>
                                {lesson.quiz ? (
                                  <span className={lesson.quiz.latestAttempt?.passed ? 'text-emerald-700' : 'text-[#737686]'}>
                                    📝 {lesson.quiz.latestAttempt
                                      ? `Lần ${lesson.quiz.latestAttempt.number}/${lesson.quiz.attemptCount} · ${lesson.quiz.latestAttempt.scorePercent ?? 0}% · ${lesson.quiz.latestAttempt.passed ? 'Đạt' : 'Chưa đạt'} · ⭐ ${lesson.quiz.stars || 0}`
                                      : `Chưa làm (${lesson.quiz.attemptCount} lần) · ⭐ ${lesson.quiz.stars || 0}`}
                                  </span>
                                ) : <span className="text-[#737686]">Không có quiz</span>}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              </Card>
            )}

            {courses.length === 0 ? (
              <Card className="text-center py-10 border border-[#eff4ff]">
                <p className="text-[#737686] text-sm">Chưa có khóa học nào đã xuất bản để theo dõi tiến độ.</p>
              </Card>
            ) : (
              <div className="space-y-4">
                {renderSection('✅ Khóa đã hoàn thành', completedCourses, 'Chưa hoàn thành khóa nào.')}

                {renderSection('🔄 Khóa đang học', inProgressCourses, 'Không có khóa nào đang học.')}

                {renderSection('⬜ Khóa chưa học', notStartedCourses, 'Đã bắt đầu tất cả các khóa.')}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
