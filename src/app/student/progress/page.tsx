'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/layout/Sidebar';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { apiFetch } from '@/lib/api/client';

export default function StudentProgressPage() {
  const [user, setUser] = useState<any>(null);
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const u = localStorage.getItem('user');
    if (u) setUser(JSON.parse(u));
    loadProgress();
  }, []);

  async function loadProgress() {
    setLoading(true);
    const res = await apiFetch('/api/v1/members/me/courses');
    if (res.ok && res.data) {
      setCourses(res.data.items || []);
    }
    setLoading(false);
  }

  if (!user) return <div className="min-h-screen flex items-center justify-center text-[#737686]">Đang tải...</div>;

  const totalCourses = courses.length;
  const completedCourses = courses.filter((c) => (c.progressPercentage || 0) >= 100).length;

  return (
    <div className="min-h-screen bg-[#f8f9ff] flex">
      <Sidebar role={user.role} user={{ email: user.email, chapterName: user.chapterName }} />
      <main className="ml-64 flex-1 max-w-5xl mx-auto px-8 py-10">
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
              {completedCourses} / {totalCourses}
            </div>
            <div className="text-xs text-[#737686]">Đạt chuẩn hoàn thành chương trình</div>
          </Card>
          <Card shadow="md">
            <div className="text-sm font-semibold text-[#737686] mb-1">Tiến độ tổng thể</div>
            <div className="text-3xl font-bold text-[#2563EB] mb-1">
              {totalCourses > 0
                ? Math.round(courses.reduce((sum, c) => sum + (c.progressPercentage || 0), 0) / totalCourses)
                : 0}
              %
            </div>
            <div className="text-xs text-[#737686]">Trung bình các khóa học</div>
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
              const isDone = (c.progressPercentage || 0) >= 100;

              return (
                <Card key={courseId} className="p-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                    <div>
                      <Link
                        href={`/student/courses/${courseId}`}
                        className="text-lg font-bold text-[#172554] hover:text-[#2563EB] transition"
                      >
                        {c.title}
                      </Link>
                      <p className="text-xs text-[#737686] mt-1">
                        Đã học {c.completedLessons || 0} / {c.totalLessons || 0} bài giảng
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span
                        className={`text-xs font-bold px-3 py-1 rounded-full ${
                          isDone ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {isDone ? '✓ Hoàn thành' : 'Đang học'}
                      </span>
                      <Link href={`/student/courses/${courseId}`}>
                        <Button size="sm" variant={isDone ? 'outline' : 'primary'}>
                          {isDone ? 'Ôn tập lại' : 'Tiếp tục học →'}
                        </Button>
                      </Link>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-[#737686]">
                      <span>Tiến độ</span>
                      <span className="font-bold text-[#172554]">{c.progressPercentage || 0}%</span>
                    </div>
                    <div className="h-2.5 bg-[#eff4ff] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          isDone ? 'bg-green-500' : 'bg-[#2563EB]'
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
      </main>
    </div>
  );
}
