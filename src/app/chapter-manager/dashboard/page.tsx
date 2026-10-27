'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import { apiFetch, getCachedApiData } from '@/lib/api/client';

export default function ChapterManagerDashboard() {
  const [user, setUser] = useState<any>(null);
  const [membersData, setMembersData] = useState<any>(null);
  const [coursesData, setCoursesData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    let currentChapter = 'me';
    if (typeof window !== 'undefined') {
      const u = localStorage.getItem('user');
      if (u) {
        try {
          const parsed = JSON.parse(u);
          setUser(parsed);
          currentChapter = parsed.chapterId || 'me';
        } catch {}
      }

      // Read cache immediately on client mount
      const cachedMembers = getCachedApiData<any>(`/api/v1/chapters/${currentChapter}/dashboard/members`) ||
                            getCachedApiData<any>('/api/v1/chapters/me/dashboard/members');
      const cachedCourses = getCachedApiData<any>(`/api/v1/chapters/${currentChapter}/dashboard/courses`) ||
                            getCachedApiData<any>('/api/v1/chapters/me/dashboard/courses');
      if (cachedMembers) setMembersData(cachedMembers);
      if (cachedCourses) setCoursesData(cachedCourses);
      if (cachedMembers || cachedCourses) setLoading(false);
    }
    loadDashboard(currentChapter);
  }, []);

  async function loadDashboard(chapterId?: string, noCache = false) {
    const targetChapter = chapterId || user?.chapterId || 'me';
    const membersUrl = `/api/v1/chapters/${targetChapter}/dashboard/members`;
    const coursesUrl = `/api/v1/chapters/${targetChapter}/dashboard/courses`;

    if (noCache) {
      setRefreshing(true);
    } else {
      const cachedMembers = getCachedApiData<any>(membersUrl);
      const cachedCourses = getCachedApiData<any>(coursesUrl);
      if (cachedMembers) setMembersData(cachedMembers);
      if (cachedCourses) setCoursesData(cachedCourses);
      if (cachedMembers && cachedCourses) {
        setLoading(false);
        return;
      }
      if (!cachedMembers && !cachedCourses) {
        setLoading(true);
      }
    }

    try {
      const [membersRes, coursesRes] = await Promise.all([
        apiFetch(membersUrl, { noCache, tabCache: true }),
        apiFetch(coursesUrl, { noCache, tabCache: true }),
      ]);

      if (membersRes.ok && membersRes.data) {
        setMembersData(membersRes.data);
      }
      if (coursesRes.ok && coursesRes.data) {
        setCoursesData(coursesRes.data);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const summary = membersData?.summary;
  const totalMembers = summary?.totalMembers ?? membersData?.totalItems ?? (loading ? '...' : 0);
  const totalCourses = coursesData?.totalItems ?? (loading ? '...' : 0);
  const avgProgress = summary?.avgChapterProgress ?? 0;
  const totalStars = summary?.totalStars ?? (loading ? '...' : 0);
  const membersOver70 = summary?.membersOver70 ?? 0;

  return (
    <div>
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              Dashboard Lead Chapter — <span suppressHydrationWarning>{mounted && user?.chapterName ? user.chapterName : 'Chapter của bạn'}</span>
            </h1>
            <p className="text-[#737686] mt-1 text-sm">
              Theo dõi tiến độ học tập và quản lý học viên trong Chapter trực thuộc
            </p>
          </div>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => loadDashboard(user?.chapterId, true)}
            className="px-4 py-2 bg-white border border-[#cbdbf5] hover:bg-[#eff4ff] active:scale-95 text-[#172554] text-sm font-semibold rounded-xl shadow-xs transition flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            title="Làm mới chỉ số và số liệu học viên mới nhất"
          >
            <span className={refreshing ? 'animate-spin inline-block' : ''}>🔄</span>
            <span>{refreshing ? 'Đang làm mới...' : 'Làm mới'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <Card shadow="md" className="p-4 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-[#737686] mb-1">Thành viên Chapter</div>
            <div className="text-2xl font-bold text-[#172554] mb-0.5">{totalMembers}</div>
            <div className="text-[11px] text-[#737686]">Toàn bộ Chapter</div>
          </Card>
          <Card shadow="md" className="p-4 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-[#737686] mb-1">Khóa học Published</div>
            <div className="text-2xl font-bold text-[#172554] mb-0.5">{totalCourses}</div>
            <div className="text-[11px] text-[#737686]">Chương trình đào tạo</div>
          </Card>
          <Card shadow="md" className="p-4 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-blue-700 mb-1">Tiến độ TB Chapter</div>
            <div className="text-2xl font-bold text-[#2563EB] mb-0.5">{avgProgress}%</div>
            <div className="text-[11px] text-[#737686]">Tất cả các khóa học</div>
          </Card>
          <Card shadow="md" className="p-4 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-amber-700 mb-1">Tổng ⭐ Star Chapter</div>
            <div className="text-2xl font-bold text-amber-600 mb-0.5">⭐ {totalStars}</div>
            <div className="text-[11px] text-[#737686]">Học tập & Quiz tích lũy</div>
          </Card>
          <Card shadow="md" className="p-4 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-emerald-700 mb-1">Đạt tiến độ ≥ 70%</div>
            <div className="text-2xl font-bold text-emerald-600 mb-0.5">
              {membersOver70} <span className="text-xs font-normal text-[#737686]">/ {totalMembers}</span>
            </div>
            <div className="text-[11px] text-[#737686]">
              {Number(totalMembers) > 0 ? Math.round((Number(membersOver70) / Number(totalMembers)) * 100) : 0}% thành viên
            </div>
          </Card>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <Link href="/chapter-manager/members">
            <Card className="hover:-translate-y-1 transition-transform cursor-pointer group border border-[#eff4ff] p-6 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xl font-bold text-[#172554] group-hover:text-[#2563EB] transition-colors flex items-center gap-2">
                  <span>👥</span> Quản lý thành viên & Tiến trình
                </h3>
                <span className="text-[#2563EB] text-sm font-semibold">Xem chi tiết →</span>
              </div>
              <p className="text-sm text-[#434655]">
                Mời thành viên mới vào Chapter, theo dõi tiến độ từng học viên, khóa hoặc mở khóa tài khoản.
              </p>
            </Card>
          </Link>
          <Link href="/chapter-manager/courses">
            <Card className="hover:-translate-y-1 transition-transform cursor-pointer group border border-[#eff4ff] p-6 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xl font-bold text-[#172554] group-hover:text-[#2563EB] transition-colors flex items-center gap-2">
                  <span>📚</span> Thống kê khóa học
                </h3>
                <span className="text-[#2563EB] text-sm font-semibold">Xem chi tiết →</span>
              </div>
              <p className="text-sm text-[#434655]">
                Xem tỷ lệ hoàn thành từng khóa học của các học viên trong chapter.
              </p>
            </Card>
          </Link>
        </div>
    </div>
  );
}
