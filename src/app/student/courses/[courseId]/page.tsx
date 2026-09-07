'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/layout/Sidebar';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { apiFetch } from '@/lib/api/client';

export default function CourseDetailPage({ params }: { params: { courseId: string } }) {
  const [user, setUser] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const [course, setCourse] = useState<any>(null);
  const [progressData, setProgressData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setMounted(true);
    let token = '';
    if (typeof window !== 'undefined') {
      token = localStorage.getItem('accessToken') || '';
      const u = localStorage.getItem('user');
      if (u) {
        try {
          setUser(JSON.parse(u));
        } catch {}
      }
    }
    loadCourseAndProgress(token);
  }, [params.courseId]);

  async function loadCourseAndProgress(token?: string) {
    setLoading(true);
    const courseRes = await apiFetch(`/api/v1/courses/${params.courseId}`);
    if (courseRes.ok && courseRes.data) {
      setCourse(courseRes.data);
    }

    if (token || (typeof window !== 'undefined' && localStorage.getItem('accessToken'))) {
      const progressRes = await apiFetch(`/api/v1/courses/${params.courseId}/my-progress`);
      if (progressRes.ok && progressRes.data) {
        setProgressData(progressRes.data);
      }
    }

    setLoading(false);
  }

  const isLeaderOrAdmin = user?.role === 'ADMIN' || user?.role === 'CHAPTER_LEADER';
  const totalLessons =
    progressData?.totalLessons ??
    (course?.sessions?.reduce((acc: number, s: any) => acc + (s.lessons?.length || 0), 0) || 0);
  const completedLessons = isLeaderOrAdmin ? totalLessons : progressData?.completedLessons ?? 0;
  const progressPercentage = isLeaderOrAdmin ? 100 : progressData?.progressPercentage ?? 0;
  const allLessonsDone = totalLessons > 0 && completedLessons >= totalLessons;

  const content = (
    <div className="max-w-5xl mx-auto px-6 py-10 flex-1 w-full space-y-8">
      <div className="mb-2">
        <Link
          href="/student/courses"
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white border border-[#cbdbf5] text-xs font-bold text-[#172554] hover:bg-[#eff4ff] hover:text-[#2563EB] hover:border-[#2563EB] shadow-xs transition-all"
        >
          ← Quay lại danh mục khóa học
        </Link>
      </div>

      {loading ? (
        <div className="text-center py-20 text-[#737686]">Đang tải thông tin khóa học...</div>
      ) : !course ? (
        <Card className="text-center py-16 space-y-4">
          <p className="text-xl font-bold text-[#172554]">Khóa học không tồn tại hoặc đã bị ẩn</p>
          <p className="text-sm text-[#737686]">Vui lòng kiểm tra lại đường dẫn hoặc đăng nhập tài khoản thành viên.</p>
          <div className="pt-2">
            <Link href="/student/courses">
              <Button variant="secondary">Xem các khóa học khác</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="space-y-8">
          {/* Header Card */}
          <div className="bg-white rounded-3xl p-8 border border-[#eff4ff] shadow-md">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-2 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                      course.visibility === 'PUBLIC'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {course.visibility === 'PUBLIC' ? '🌐 Khóa học Công khai' : '🔒 Khóa học Nội bộ'}
                  </span>
                </div>
                <h1 className="text-3xl font-extrabold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                  {course.title}
                </h1>
                <p className="text-[#434655] leading-relaxed text-sm md:text-base">
                  {course.description || 'Chương trình đào tạo kỹ năng chuyên sâu BBE.'}
                </p>
                <div className="flex items-center gap-3 pt-2 text-xs text-[#737686]">
                  <span>🏛️ {course.sessions?.length || 0} buổi học</span>
                  <span>• 📚 {totalLessons} bài học</span>
                </div>
              </div>

              {/* Progress Box (if logged in or guest) */}
              {user ? (
                <div className="bg-[#f8f9ff] p-6 rounded-2xl border border-[#cbdbf5] min-w-[220px] text-center shrink-0">
                  <div className="text-3xl font-bold text-[#2563EB] mb-1">{progressPercentage}%</div>
                  <div className="text-xs text-[#737686] mb-3">
                    {isLeaderOrAdmin ? 'Quyền quản trị / BĐHU' : 'Tiến độ hoàn thành'}
                  </div>
                  <div className="h-2.5 bg-[#eff4ff] rounded-full overflow-hidden mb-2">
                    <div className="h-full bg-[#2563EB] rounded-full transition-all" style={{ width: `${progressPercentage}%` }} />
                  </div>
                  <div className="text-xs text-[#434655]">
                    Đã học {completedLessons} / {totalLessons} bài
                  </div>
                </div>
              ) : (
                <div className="bg-[#eff4ff] p-6 rounded-2xl border border-[#cbdbf5] min-w-[220px] text-center shrink-0 space-y-3">
                  <p className="text-xs font-semibold text-[#172554]">Khóa học công khai miễn phí</p>
                  <Link href="/login" className="block">
                    <Button size="sm" className="w-full">Đăng nhập để lưu tiến độ</Button>
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* Sessions & Lessons */}
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              Nội dung chương trình học
            </h2>

            {course.sessions?.map((session: any, sIdx: number) => {
              const progSession = progressData?.sessions?.find((ps: any) => ps.sessionId === (session.sessionId || session.id));
              return (
                <div key={session.sessionId || session.id} className="bg-white rounded-2xl border border-[#eff4ff] shadow-sm p-6 space-y-4">
                  <div className="flex items-center gap-3 border-b border-[#eff4ff] pb-4">
                    <span className="w-8 h-8 bg-[#eff4ff] text-[#2563EB] rounded-lg font-bold flex items-center justify-center text-sm">
                      {sIdx + 1}
                    </span>
                    <div>
                      <h3 className="text-lg font-bold text-[#172554]">{session.title}</h3>
                      {session.description && <p className="text-xs text-[#737686]">{session.description}</p>}
                    </div>
                  </div>

                  <div className="space-y-3">
                    {session.lessons?.map((lesson: any, lIdx: number) => {
                      const lessonProg = progSession?.lessons?.find((pl: any) => pl.lessonId === (lesson.lessonId || lesson.id));
                      const isCompleted = isLeaderOrAdmin || lessonProg?.completed;

                      return (
                        <Link
                          key={lesson.lessonId || lesson.id}
                          href={`/student/learning/${lesson.lessonId || lesson.id}`}
                          className="block p-4 bg-[#f8f9ff] hover:bg-[#eef4ff] rounded-xl border border-[#eff4ff] transition group"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-bold text-[#737686] group-hover:text-[#2563EB]">
                                {sIdx + 1}.{lIdx + 1}
                              </span>
                              <div>
                                <h4 className="font-semibold text-sm text-[#172554] group-hover:text-[#2563EB] transition">
                                  {lesson.title}
                                </h4>
                                <div className="flex items-center gap-3 text-xs text-[#737686] mt-0.5">
                                  <span>📹 Video bài giảng</span>
                                  {lesson.documents?.length > 0 && (
                                    <span>• 📄 {lesson.documents.length} tài liệu</span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {isCompleted ? (
                                <span className="text-xs font-bold text-green-700 bg-green-50 px-2.5 py-1 rounded-full border border-green-200">
                                  ✓ Đã hoàn thành
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#eff4ff] group-hover:bg-[#2563EB] text-[#2563EB] group-hover:text-white text-xs font-bold transition-all shadow-xs">
                                  Học bài này →
                                </span>
                              )}
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Final Quiz Section */}
          <div className="bg-white rounded-3xl p-8 border border-[#eff4ff] shadow-md flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="space-y-1 text-center md:text-left">
              <h3 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                Bài kiểm tra đánh giá cuối khóa
              </h3>
              <p className="text-sm text-[#737686]">
                Yêu cầu: Hoàn thành tất cả các bài học và đạt tối thiểu 85% điểm số để được cấp chứng nhận.
              </p>
            </div>

            <div>
              {user ? (
                allLessonsDone || isLeaderOrAdmin ? (
                  <Link href={`/student/courses/${params.courseId}/quiz`}>
                    <Button size="lg" className="shadow-lg whitespace-nowrap">
                      📝 Bắt đầu làm bài kiểm tra
                    </Button>
                  </Link>
                ) : (
                  <Button size="lg" disabled className="opacity-50 cursor-not-allowed whitespace-nowrap">
                    🔒 Cần hoàn thành đủ bài học
                  </Button>
                )
              ) : (
                <Link href="/login">
                  <Button size="lg" variant="secondary" className="whitespace-nowrap">
                    Đăng nhập để làm Quiz
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f8f9ff] flex">
      {mounted && user && <Sidebar role={user.role} user={{ email: user.email }} />}
      <main className={`${mounted && user ? 'ml-64' : ''} flex-1 flex flex-col`}>
        {content}
      </main>
    </div>
  );
}
