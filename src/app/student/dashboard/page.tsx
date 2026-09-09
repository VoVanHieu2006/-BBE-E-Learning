'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { apiFetch, getCachedApiData } from '@/lib/api/client';
import { useRouter } from 'next/navigation';

export default function StudentDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [courses, setCourses] = useState<any[]>([]);
  const [streak, setStreak] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
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
      const cachedCourses = getCachedApiData<any>('/api/v1/members/me/courses');
      const cachedStreak = getCachedApiData<any>('/api/v1/streak');
      if (cachedCourses?.items) {
        setCourses(cachedCourses.items);
        setLoading(false);
      }
      if (cachedStreak) {
        setStreak(cachedStreak);
      }
    }
    loadData();
  }, [router]);

  async function loadData() {
    const [coursesRes, streakRes] = await Promise.all([
      apiFetch('/api/v1/members/me/courses'),
      apiFetch('/api/v1/streak'),
    ]);

    if (coursesRes.ok && coursesRes.data) {
      setCourses(coursesRes.data.items || []);
    }
    if (streakRes.ok && streakRes.data) {
      setStreak(streakRes.data);
    }
    setLoading(false);
  }

  const totalCourses = courses.length;
  const completedCourses = courses.filter((c) => {
    const allVideosDone =
      (c.totalLessons > 0 && (c.completedLessons || 0) >= c.totalLessons) ||
      (c.progressPercentage || 0) >= 100;
    return c.hasAssessment ? allVideosDone && c.latestAttempt?.passed : allVideosDone;
  }).length;
  const avgProgress = totalCourses > 0
    ? Math.round(courses.reduce((sum, c) => sum + (c.progressPercentage || 0), 0) / totalCourses)
    : 0;

  return (
    <div>
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-4xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Chào mừng, <span suppressHydrationWarning>{mounted && user?.email ? user.email.split('@')[0] : 'bạn'}</span>
          </h1>
          <p className="text-[#737686] mt-1">
            Chapter: <span suppressHydrationWarning className="font-semibold text-[#172554]">{mounted && user?.chapterName ? user.chapterName : 'BBE Core'}</span> • Tiếp tục học tập hôm nay
          </p>
        </div>
        <Link href="/student/courses">
          <Button>Khám phá khóa học</Button>
        </Link>
      </div>

        {/* Stats Grid */}
        <div className="grid md:grid-cols-3 gap-6 mb-10">
          <Card shadow="md">
            <div className="text-sm font-semibold text-[#737686] mb-1">Khóa học của bạn</div>
            <div className="text-3xl font-bold text-[#172554] mb-1">
              {completedCourses} / {totalCourses}
            </div>
            <div className="text-xs text-[#737686]">Khóa đã hoàn thành 100%</div>
          </Card>
          <Card shadow="md">
            <div className="text-sm font-semibold text-[#737686] mb-1">Tiến độ trung bình</div>
            <div className="text-3xl font-bold text-[#2563EB] mb-1">{avgProgress}%</div>
            <div className="text-xs text-[#737686]">Trên tất cả các khóa học</div>
          </Card>
          <Card shadow="md">
            <div className="text-sm font-semibold text-[#737686] mb-1">🔥 Chuỗi học tập (Streak)</div>
            <div className="text-3xl font-bold text-[#F97316] mb-1">
              {streak?.currentStreak || 0} ngày
            </div>
            <div className="text-xs text-[#737686]">Kỷ lục cao nhất: {streak?.longestStreak || 0} ngày</div>
          </Card>
        </div>

        {/* Courses Section */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Khóa học đang học
          </h2>
          <Link href="/student/courses" className="text-sm text-[#2563EB] hover:underline font-semibold">
            Xem tất cả →
          </Link>
        </div>

        {loading ? (
          <div className="text-center py-10 text-[#737686]">Đang tải danh sách khóa học...</div>
        ) : courses.length === 0 ? (
          <Card className="text-center py-10">
            <p className="text-lg font-semibold text-[#172554] mb-2">Chưa có khóa học nào</p>
            <p className="text-sm text-[#737686] mb-4">Hãy chọn khóa học trong danh mục để bắt đầu.</p>
            <Link href="/student/courses">
              <Button>Khám phá khóa học ngay</Button>
            </Link>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {courses.map((c: any) => (
              <Link key={c.courseId || c.id} href={`/student/courses/${c.courseId || c.id}`}>
                <Card className="hover:-translate-y-1 transition-transform cursor-pointer group border border-[#eff4ff]">
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-lg font-bold text-[#172554] group-hover:text-[#2563EB] transition-colors">
                      {c.title}
                    </h3>
                    <span className="bg-[#eff4ff] text-[#2563EB] text-xs font-bold px-2.5 py-1 rounded-full shrink-0">
                      {c.progressPercentage || 0}%
                    </span>
                  </div>
                  <p className="text-sm text-[#434655] mb-4 line-clamp-2">
                    {c.description || 'Chương trình đào tạo nội bộ BBE.'}
                  </p>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-[#737686]">
                      <span>Đã học {c.completedLessons || 0} / {c.totalLessons || 0} bài</span>
                      <span className="font-medium">
                        {c.hasAssessment
                          ? c.latestAttempt?.passed
                            ? '✓ Hoàn thành'
                            : (c.completedLessons >= c.totalLessons || c.progressPercentage >= 100)
                            ? c.latestAttempt
                              ? 'Chưa pass test'
                              : 'Cần làm test'
                            : 'Đang học'
                          : c.progressPercentage >= 100
                          ? '✓ Hoàn thành'
                          : 'Đang học'}
                      </span>
                    </div>
                    <div className="h-2 bg-[#eff4ff] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#2563EB] rounded-full transition-all"
                        style={{ width: `${c.progressPercentage || 0}%` }}
                      />
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
    </div>
  );
}
