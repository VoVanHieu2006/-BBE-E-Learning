'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { apiFetch, getCachedApiData } from '@/lib/api/client';
import { useRouter } from 'next/navigation';

export default function StudentProgressPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [courses, setCourses] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('accessToken');
      const u = localStorage.getItem('user');
      if (!token || !u) {
        router.replace('/login?callbackUrl=' + encodeURIComponent(window.location.pathname));
        return;
      }
      try {
        setUser(JSON.parse(u));
      } catch {}

      // Read cache immediately on client mount
      const cached = getCachedApiData<any>('/api/v1/members/me/courses');
      if (cached?.items) {
        setCourses(cached.items);
        setSummary(cached.summary || null);
        setLoading(false);
      }
    }
    loadProgress();
  }, [router]);

  async function loadProgress() {
    const res = await apiFetch('/api/v1/members/me/courses');
    if (res.ok && res.data) {
      setCourses(res.data.items || []);
      setSummary(res.data.summary || null);
    }
    setLoading(false);
  }

  const totalCourses = summary?.totalCourses ?? courses.length;
  // Khóa học chỉ tính hoàn thành khi: nếu có bài kiểm tra thì phải học xong video VÀ đã pass bài test
  const completedCourses = summary?.completedCourses ?? courses.filter((c) => {
    const allVideosDone =
      (c.totalLessons > 0 && (c.completedLessons || 0) >= c.totalLessons) ||
      (c.progressPercentage || 0) >= 100;
    return c.hasAssessment ? allVideosDone && c.latestAttempt?.passed : allVideosDone;
  }).length;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
          Tiến độ học tập của bạn
        </h1>
        <p className="text-[#737686] mt-1">Theo dõi tiến độ hoàn thành các khóa học và bài giảng</p>
      </div>

        {/* Overall Summary */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <Card shadow="md">
            <div className="text-sm font-semibold text-[#737686] mb-1">Khóa học đã hoàn thành</div>
            <div className="text-3xl font-bold text-[#172554] mb-1">
              {completedCourses} / {totalCourses} <span className="text-base font-normal text-[#737686]">khóa</span>
            </div>
            <div className="text-xs text-[#737686]">Đạt chuẩn học 100% bài học & vượt qua bài kiểm tra</div>
          </Card>
          <Card shadow="md">
            <div className="text-sm font-semibold text-[#737686] mb-1">Tiến độ bài học toàn hệ thống</div>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-3xl font-bold text-[#2563EB]">{summary?.overallProgressPercent ?? 0}%</span>
              <span className="text-sm font-bold text-[#172554]">
                (Đã học {summary?.completedLessons ?? 0} / {summary?.totalLessons ?? 0} bài)
              </span>
            </div>
            <div className="text-xs text-[#737686]">
              Tổng hợp từ tất cả các khóa học đã phát hành
            </div>
          </Card>
        </div>

        {/* Course Progress List */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Chi tiết từng khóa học
          </h2>

          {loading ? (
            <div className="text-center py-12 text-[#737686]">Đang tải tiến độ...</div>
          ) : courses.length === 0 ? (
            <Card className="text-center py-12">
              <p className="text-lg font-semibold text-[#172554] mb-2">Chưa có khóa học nào</p>
              <p className="text-sm text-[#737686] mb-4">Hãy đăng ký khóa học để bắt đầu theo dõi tiến độ.</p>
              <Link href="/student/courses">
                <Button>Khám phá khóa học</Button>
              </Link>
            </Card>
          ) : (
            courses.map((c) => {
              const courseId = c.courseId || c.id;
              const allVideosDone =
                (c.totalLessons > 0 && (c.completedLessons || 0) >= c.totalLessons) ||
                (c.progressPercentage || 0) >= 100;
              const hasAssessment = Boolean(c.hasAssessment);
              const latestAttempt = c.latestAttempt;
              const isPassed = Boolean(latestAttempt?.passed);
              const isFullyDone = hasAssessment ? allVideosDone && isPassed : allVideosDone;

              return (
                <Card key={courseId} className="p-6 transition-all hover:shadow-md border border-[#eff4ff]">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                    <div className="space-y-1">
                      <Link
                        href={`/student/courses/${courseId}`}
                        className="text-lg font-bold text-[#172554] hover:text-[#2563EB] transition"
                      >
                        {c.title}
                      </Link>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#737686]">
                        <span>
                          Đã học {c.completedLessons || 0} / {c.totalLessons || 0} bài giảng
                        </span>
                        {allVideosDone && hasAssessment && (
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                            ✓ Đã học xong video
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Status Badge & Action Buttons */}
                    <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                      {/* Badge trạng thái */}
                      {!allVideosDone ? (
                        <span className="text-xs font-bold px-3 py-1 rounded-full bg-blue-100 text-blue-700">
                          Đang học
                        </span>
                      ) : !hasAssessment ? (
                        <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                          ✓ Hoàn thành
                        </span>
                      ) : !latestAttempt ? (
                        <span className="text-xs font-bold px-3 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                          📝 Cần làm bài kiểm tra
                        </span>
                      ) : isPassed ? (
                        <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                          ✓ Hoàn thành (Đã pass)
                        </span>
                      ) : (
                        <span className="text-xs font-bold px-3 py-1 rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                          ❌ Chưa pass (&lt; 85%)
                        </span>
                      )}

                      {/* Các nút bấm hành động theo yêu cầu */}
                      {!allVideosDone ? (
                        <Link href={`/student/courses/${courseId}`}>
                          <Button size="sm">Tiếp tục học →</Button>
                        </Link>
                      ) : !hasAssessment ? (
                        <Link href={`/student/courses/${courseId}`}>
                          <Button size="sm" variant="outline">
                            Ôn tập lại
                          </Button>
                        </Link>
                      ) : !latestAttempt ? (
                        // Học xong video nhưng CHƯA LÀM bài kiểm tra -> Nút "Làm bài kiểm tra"
                        <div className="flex items-center gap-2">
                          <Link href={`/student/courses/${courseId}/quiz${c.assessmentId ? `?assessmentId=${c.assessmentId}` : ''}`}>
                            <Button size="sm" className="bg-[#F97316] hover:bg-[#ea580c] text-white shadow-sm font-bold">
                              📝 Làm bài kiểm tra
                            </Button>
                          </Link>
                          <Link href={`/student/courses/${courseId}`}>
                            <Button size="sm" variant="outline">
                              Ôn tập lại
                            </Button>
                          </Link>
                        </div>
                      ) : (
                        // ĐÃ LÀM bài kiểm tra -> Nút "Làm lại bài kiểm tra" + "Ôn tập lại"
                        <div className="flex items-center gap-2">
                          <Link href={`/student/courses/${courseId}/quiz${c.assessmentId ? `?assessmentId=${c.assessmentId}` : ''}`}>
                            <Button
                              size="sm"
                              variant={isPassed ? 'secondary' : 'primary'}
                              className="font-bold shadow-sm"
                            >
                              🔄 Làm lại bài kiểm tra
                            </Button>
                          </Link>
                          <Link href={`/student/courses/${courseId}`}>
                            <Button size="sm" variant={isPassed ? 'outline' : 'outline'}>
                              Ôn tập lại
                            </Button>
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Thanh tiến độ và Điểm lần cuối cùng + Pass/Chưa pass */}
                  <div className="space-y-2 pt-3 border-t border-slate-100">
                    <div className="flex flex-wrap justify-between items-center gap-2 text-xs">
                      <div className="flex items-center gap-2 text-[#737686]">
                        <span>Tiến độ bài học:</span>
                        <span className="font-bold text-[#172554]">{c.progressPercentage || 0}%</span>
                      </div>

                      {/* Hiển thị điểm số lần cuối cùng + pass/chưa pass */}
                      {allVideosDone && hasAssessment && latestAttempt && (
                        <div className="flex items-center gap-2 text-xs font-semibold">
                          <span className="text-[#737686]">Điểm lần cuối cùng:</span>
                          <span
                            className={`px-2.5 py-0.5 rounded-full font-bold ${
                              isPassed
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                            }`}
                          >
                            {latestAttempt.score ?? 0}% • {isPassed ? 'Đạt (Pass)' : 'Chưa đạt (Chưa pass)'}
                          </span>
                        </div>
                      )}

                      {/* Thông báo nếu chưa làm bài kiểm tra */}
                      {allVideosDone && hasAssessment && !latestAttempt && (
                        <span className="text-xs text-amber-700 font-medium italic">
                          * Cần làm bài kiểm tra (đạt ≥ 85%) để được đánh dấu hoàn thành khóa học
                        </span>
                      )}
                    </div>

                    <div className="h-2.5 bg-[#eff4ff] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          isFullyDone
                            ? 'bg-emerald-500'
                            : allVideosDone && hasAssessment && !isPassed
                            ? 'bg-[#F97316]'
                            : 'bg-[#2563EB]'
                        }`}
                        style={{ width: `${c.progressPercentage || 0}%` }}
                      />
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>
    </div>
  );
}
