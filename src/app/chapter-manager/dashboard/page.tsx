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

    // Cache-first: hiện dữ liệu cache ngay trong khi revalidate nền
    if (!noCache) {
      const cachedMembers = getCachedApiData<any>(membersUrl);
      const cachedCourses = getCachedApiData<any>(coursesUrl);
      if (cachedMembers) setMembersData(cachedMembers);
      if (cachedCourses) setCoursesData(cachedCourses);
    } else {
      setLoading(true);
    }

    const [membersRes, coursesRes] = await Promise.all([
      apiFetch(membersUrl, { noCache }),
      apiFetch(coursesUrl, { noCache }),
    ]);

    if (membersRes.ok && membersRes.data) {
      setMembersData(membersRes.data);
    }
    if (coursesRes.ok && coursesRes.data) {
      setCoursesData(coursesRes.data);
    }
    setLoading(false);
  }

  const totalMembers = membersData?.totalItems ?? (loading ? '...' : 0);
  const totalCourses = coursesData?.totalItems ?? (loading ? '...' : 0);

  const memberList = membersData?.items || [];
  const avgProgress =
    memberList.length > 0
      ? Math.round(
          memberList.reduce((sum: number, m: any) => sum + (m.avgProgress || 0), 0) / memberList.length
        )
      : 0;

  return (
    <div>
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              Dashboard BĐHU — <span suppressHydrationWarning>{mounted && user?.chapterName ? user.chapterName : 'Chapter của bạn'}</span>
            </h1>
            <p className="text-[#737686] mt-1 text-sm">
              Theo dõi tiến độ học tập và quản lý học viên trong Chapter trực thuộc
            </p>
          </div>
          <button
            onClick={() => loadDashboard(user?.chapterId, true)}
            className="px-4 py-2 bg-white border border-[#cbdbf5] hover:bg-[#eff4ff] text-[#172554] text-sm font-medium rounded-xl shadow-sm transition flex items-center gap-2"
          >
            🔄 Làm mới
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card shadow="md" className="p-5 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-[#737686] mb-1">Thành viên Chapter</div>
            <div className="text-3xl font-bold text-[#172554] mb-1">{totalMembers}</div>
            <div className="text-xs text-[#737686]">Học viên trong Chapter</div>
          </Card>
          <Card shadow="md" className="p-5 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-[#737686] mb-1">Khóa học Published</div>
            <div className="text-3xl font-bold text-[#172554] mb-1">{totalCourses}</div>
            <div className="text-xs text-[#737686]">Chương trình đào tạo hiện có</div>
          </Card>
          <Card shadow="md" className="p-5 border border-[#eff4ff]">
            <div className="text-xs font-semibold text-blue-700 mb-1">Tiến độ TB Chapter</div>
            <div className="text-3xl font-bold text-[#2563EB] mb-1">{avgProgress}%</div>
            <div className="text-xs text-[#737686]">Tất cả các khóa học</div>
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
