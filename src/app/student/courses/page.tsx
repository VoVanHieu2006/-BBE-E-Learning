'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { apiFetch, getCachedApiData } from '@/lib/api/client';

export default function StudentCoursesPage() {
  const [user, setUser] = useState<any>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  });

  const [courses, setCourses] = useState<any[]>(() => {
    const cached = getCachedApiData<any>('/api/v1/courses');
    return cached?.items || [];
  });

  const [loading, setLoading] = useState(() => courses.length === 0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      const u = localStorage.getItem('user');
      if (u) {
        try {
          setUser(JSON.parse(u));
        } catch {}
      }
    }
    loadCourses();
  }, []);

  async function loadCourses() {
    const res = await apiFetch('/api/v1/courses');
    if (res.ok && res.data) {
      setCourses(res.data.items || []);
    }
    setLoading(false);
  }

  return (
    <div className="w-full">
      {/* If logged in: content fits in StudentLayout */}
      {mounted && user ? (
        <div className="w-full">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              Danh mục khóa học
            </h1>
            <p className="text-[#737686] mt-1">Các khóa học được thiết kế dành cho thành viên BBE</p>
          </div>

            {!mounted || (loading && courses.length === 0) ? (
              <div className="grid md:grid-cols-2 gap-6 animate-pulse">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="h-44 bg-white rounded-3xl border border-[#eff4ff] p-6 space-y-4">
                    <div className="h-6 bg-slate-200 rounded-md w-3/4"></div>
                    <div className="h-4 bg-slate-100 rounded-md w-full"></div>
                    <div className="h-4 bg-slate-100 rounded-md w-1/2"></div>
                  </div>
                ))}
              </div>
            ) : courses.length === 0 ? (
              <Card className="text-center py-12 border border-[#eff4ff]">
                <p className="text-lg font-semibold text-[#172554] mb-2">Chưa có khóa học nào</p>
                <p className="text-sm text-[#737686]">Vui lòng quay lại sau hoặc liên hệ BĐHU để biết thêm chi tiết.</p>
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 gap-6">
                {courses.map((c) => (
                  <Link key={c.courseId || c.id} href={`/student/courses/${c.courseId || c.id}`}>
                    <Card className="hover:-translate-y-1 transition-all cursor-pointer group h-full flex flex-col justify-between border border-[#eff4ff] p-6 shadow-sm hover:shadow-md">
                      <div>
                        <div className="flex items-start justify-between mb-3">
                          <h3 className="text-xl font-bold text-[#172554] group-hover:text-[#2563EB] transition-colors">
                            {c.title}
                          </h3>
                          <span
                            className={`whitespace-nowrap inline-flex items-center text-xs font-bold px-2.5 py-0.5 rounded-full shrink-0 ${
                              c.visibility === 'PUBLIC'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {c.visibility === 'PUBLIC' ? '🌐 Public' : '🔒 Private'}
                          </span>
                        </div>
                        <p className="text-sm text-[#434655] mb-4 line-clamp-3">
                          {c.description || 'Chương trình đào tạo kỹ năng chuyên sâu BBE.'}
                        </p>
                      </div>
                      <div className="flex items-center justify-between pt-4 border-t border-[#eff4ff] text-xs text-[#737686]">
                        <span>🏛️ {c.sessionCount || 0} buổi học</span>
                        <span className="inline-flex items-center gap-1 text-[#2563EB] font-bold group-hover:underline">
                          Vào học ngay →
                        </span>
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
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
                  <div key={n} className="h-44 bg-white rounded-3xl border border-[#eff4ff] p-6 space-y-4">
                    <div className="h-6 bg-slate-200 rounded-md w-3/4"></div>
                    <div className="h-4 bg-slate-100 rounded-md w-full"></div>
                  </div>
                ))}
              </div>
            ) : courses.length === 0 ? (
              <Card className="text-center py-12 border border-[#eff4ff]">
                <p className="text-lg font-semibold text-[#172554] mb-2">Chưa có khóa học công khai nào</p>
                <p className="text-sm text-[#737686] mb-4">Vui lòng đăng nhập để xem các khóa học nội bộ.</p>
                <Link href="/login">
                  <Button>Đăng nhập ngay</Button>
                </Link>
              </Card>
            ) : (
              <div className="grid md:grid-cols-3 gap-6">
                {courses.map((c) => (
                  <Link key={c.courseId || c.id} href={`/student/courses/${c.courseId || c.id}`}>
                    <Card className="hover:-translate-y-1 transition-all cursor-pointer group h-full flex flex-col justify-between border border-[#eff4ff] p-6 shadow-sm hover:shadow-md">
                      <div>
                        <div className="flex items-start justify-between mb-3">
                          <h3 className="text-lg font-bold text-[#172554] group-hover:text-[#2563EB] transition-colors">
                            {c.title}
                          </h3>
                        </div>
                        <p className="text-sm text-[#434655] mb-4 line-clamp-3">
                          {c.description || 'Chương trình đào tạo kỹ năng chuyên sâu BBE.'}
                        </p>
                      </div>
                      <div className="flex items-center justify-between pt-4 border-t border-[#eff4ff] text-xs text-[#737686]">
                        <span>🏛️ {c.sessionCount || 0} buổi học</span>
                        <span className="inline-flex items-center gap-1 text-[#2563EB] font-bold group-hover:underline">
                          Chi tiết →
                        </span>
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
