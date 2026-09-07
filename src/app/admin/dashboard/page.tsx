'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import { apiFetch, getCachedApiData } from '@/lib/api/client';
import { useAdmin } from '../AdminContext';

export default function AdminDashboard() {
  const { mounted } = useAdmin();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // SWR: grab cached data immediately on mount if available
    const cached = getCachedApiData<any>('/api/v1/admin/overview');
    if (cached) {
      setData(cached);
      setLoading(false);
    }
    loadOverview();
  }, []);

  async function loadOverview() {
    const res = await apiFetch('/api/v1/admin/overview');
    if (res.ok && res.data) {
      setData(res.data);
    }
    setLoading(false);
  }

  const isDataReady = mounted && !loading && Boolean(data);

  const statItems = [
    {
      label: 'Chapter hoạt động',
      value: isDataReady ? data?.chapterCount ?? 0 : '...',
      sub: 'Tổng số chapter',
      icon: '🏛️',
      href: '/admin/chapters',
    },
    {
      label: 'Tài khoản Active',
      value: isDataReady ? data?.accountStats?.active ?? 0 : '...',
      sub: `Tổng ${data?.accountStats?.total ?? 0} tài khoản`,
      icon: '👤',
      href: '/admin/users',
    },
    {
      label: 'Khóa học Published',
      value: isDataReady ? data?.courseStats?.published ?? 0 : '...',
      sub: `Bản nháp: ${data?.courseStats?.draft ?? 0}`,
      icon: '📖',
      href: '/admin/courses',
    },
    {
      label: 'Tỷ lệ hoàn thành TB',
      value: isDataReady ? `${Math.round((data?.avgCompletionRate || 0) * 100)}%` : '...',
      sub: `${data?.totalLessons ?? 0} bài học`,
      icon: '📈',
      href: '/admin/chapters',
    },
  ];

  return (
    <>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Tổng quan Admin
          </h1>
          <p className="text-[#737686] mt-1 text-sm">BBE E-Learning Platform Management</p>
        </div>
        <button
          onClick={() => {
            setLoading(true);
            loadOverview();
          }}
          className="px-4 py-2 bg-white border border-[#cbdbf5] hover:bg-[#eff4ff] text-[#172554] text-sm font-medium rounded-xl shadow-sm transition flex items-center gap-2"
        >
          🔄 Làm mới
        </button>
      </div>

      {/* 4 Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statItems.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card shadow="md" className="hover:-translate-y-1 transition-transform cursor-pointer border border-[#eff4ff] h-full p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-[#737686]">{s.label}</span>
                <span className="text-lg">{s.icon}</span>
              </div>
              <div className="text-3xl font-bold text-[#172554] mb-1">
                {!isDataReady ? <span className="animate-pulse text-slate-300">...</span> : s.value}
              </div>
              <div className="text-xs text-[#737686]">{s.sub}</div>
            </Card>
          </Link>
        ))}
      </div>

      {/* Action Modules */}
      <div className="grid md:grid-cols-2 gap-6">
        <Link href="/admin/courses">
          <Card className="hover:-translate-y-1 transition-transform cursor-pointer group border border-[#eff4ff] p-6 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xl font-bold text-[#172554] group-hover:text-[#2563EB] transition-colors flex items-center gap-2">
                <span>📚</span> Quản lý khóa học
              </h3>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#eff4ff] group-hover:bg-[#2563EB] text-[#2563EB] group-hover:text-white text-xs font-bold transition-all shadow-xs">
                Xem chi tiết →
              </span>
            </div>
            <p className="text-sm text-[#434655]">
              Tạo, chỉnh sửa, tự động nhận diện video YouTube, quản lý tài liệu và bài kiểm tra.
            </p>
          </Card>
        </Link>

        <Link href="/admin/invitations">
          <Card className="hover:-translate-y-1 transition-transform cursor-pointer group border border-[#eff4ff] p-6 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xl font-bold text-[#172554] group-hover:text-[#2563EB] transition-colors flex items-center gap-2">
                <span>✉️</span> Quản lý lời mời (BĐHU)
              </h3>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#eff4ff] group-hover:bg-[#2563EB] text-[#2563EB] group-hover:text-white text-xs font-bold transition-all shadow-xs">
                Xem chi tiết →
              </span>
            </div>
            <p className="text-sm text-[#434655]">
              Mời Trưởng Chapter (BĐHU), khởi tạo chapter mới và theo dõi trạng thái lời mời.
            </p>
          </Card>
        </Link>

        <Link href="/admin/chapters">
          <Card className="hover:-translate-y-1 transition-transform cursor-pointer group border border-[#eff4ff] p-6 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xl font-bold text-[#172554] group-hover:text-[#2563EB] transition-colors flex items-center gap-2">
                <span>🏆</span> Xếp hạng & Tiến trình Chapter
              </h3>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#eff4ff] group-hover:bg-[#2563EB] text-[#2563EB] group-hover:text-white text-xs font-bold transition-all shadow-xs">
                Xem chi tiết →
              </span>
            </div>
            <p className="text-sm text-[#434655]">
              Theo dõi bảng xếp hạng chapter, bấm vào từng chapter để xem chi tiết tiến độ từng thành viên.
            </p>
          </Card>
        </Link>

        <Link href="/admin/users">
          <Card className="hover:-translate-y-1 transition-transform cursor-pointer group border border-[#eff4ff] p-6 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xl font-bold text-[#172554] group-hover:text-[#2563EB] transition-colors flex items-center gap-2">
                <span>👥</span> Quản lý tài khoản
              </h3>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#eff4ff] group-hover:bg-[#2563EB] text-[#2563EB] group-hover:text-white text-xs font-bold transition-all shadow-xs">
                Xem chi tiết →
              </span>
            </div>
            <p className="text-sm text-[#434655]">
              Xem danh sách tài khoản học viên và BĐHU, kích hoạt hoặc vô hiệu hóa (Active / Inactive).
            </p>
          </Card>
        </Link>
      </div>
    </>
  );
}
