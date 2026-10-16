'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import { apiFetch, getCachedApiData } from '@/lib/api/client';

export default function ChapterManagerLeaderboardPage() {
  const [user, setUser] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setMounted(true);
    let currentUser: any = null;
    if (typeof window !== 'undefined') {
      try {
        const u = localStorage.getItem('user');
        if (u) {
          currentUser = JSON.parse(u);
          setUser(currentUser);
        }
      } catch {}
    }
    loadData(currentUser);
  }, []);

  async function loadData(currentUser?: any) {
    const chapterId = currentUser?.chapterId;
    if (!chapterId) {
      setLoading(false);
      return;
    }

    const url = `/api/v1/leaderboard/chapters/${chapterId}`;
    const cached = getCachedApiData<any>(url);
    if (cached?.items) {
      setMembers(cached.items);
      setLoading(false);
    }

    const res = await apiFetch(url);
    if (res.ok && res.data) {
      setMembers(res.data.items || []);
    }
    setLoading(false);
  }

  const getMedal = (rank: number) => {
    if (rank === 0) return '🥇';
    if (rank === 1) return '🥈';
    if (rank === 2) return '🥉';
    return `#${rank + 1}`;
  };

  const topThree = members.slice(0, 3);

  return (
    <div className="space-y-8 max-w-6xl pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="inline-block text-xs font-bold px-3 py-1 bg-[#2563EB]/10 text-[#2563EB] rounded-full mb-2">
            🏆 Vinh danh học tập Chapter
          </span>
          <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Bảng Xếp Hạng Chapter
          </h1>
          <p className="text-sm text-[#737686] mt-1">
            Chapter: <span className="font-semibold text-[#172554]">{mounted && user?.chapterName ? user.chapterName : 'Chapter của bạn'}</span> • Xếp hạng thành viên theo tổng ⭐ Star đã tích lũy
          </p>
        </div>
      </div>

      {!mounted || (loading && members.length === 0) ? (
        <Card className="p-16 text-center text-[#737686] font-medium">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent mb-3" />
          <p>Đang tải dữ liệu bảng xếp hạng Chapter...</p>
        </Card>
      ) : members.length === 0 ? (
        <Card className="p-16 text-center text-[#737686]">
          <div className="text-4xl mb-3">⭐</div>
          <p className="font-semibold text-[#172554]">Chưa có dữ liệu xếp hạng trong chapter của bạn</p>
          <p className="text-sm mt-1">Các thành viên cần hoàn thành bài học hoặc quiz để tích lũy Star vinh danh.</p>
        </Card>
      ) : (
        <>
          {/* Top 3 Podium (Huy chương) */}
          {topThree.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 items-end">
              {/* Hạng 2 */}
              {topThree[1] && (
                <Card className="p-6 text-center border-t-4 border-t-slate-400 bg-gradient-to-b from-slate-50/50 to-white hover:shadow-md transition">
                  <div className="text-4xl mb-2">🥈</div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Hạng 2</div>
                  <Link
                    href={`/chapter-manager/members/${topThree[1].userId || topThree[1].id}`}
                    className="text-base font-bold text-[#172554] hover:text-[#2563EB] truncate block transition"
                  >
                    {topThree[1].displayName || topThree[1].email?.split('@')[0]}
                  </Link>
                  <p className="text-xs text-[#737686] truncate mb-3">{topThree[1].email}</p>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-800 rounded-full text-sm font-extrabold border border-amber-200">
                    <span>⭐</span> {topThree[1].stars?.toLocaleString('vi-VN') || 0}
                  </div>
                  {topThree[1].department && (
                    <div className="mt-2 text-xs text-blue-700 font-semibold">
                      {topThree[1].department.name || topThree[1].department}
                    </div>
                  )}
                </Card>
              )}

              {/* Hạng 1 */}
              {topThree[0] && (
                <Card className="p-8 text-center border-t-4 border-t-amber-400 bg-gradient-to-b from-amber-50/40 to-white shadow-lg relative -mt-4">
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-500 text-white text-[11px] font-extrabold px-3 py-0.5 rounded-full shadow-sm">
                    TOP 1
                  </div>
                  <div className="text-5xl mb-2">🥇</div>
                  <div className="text-xs font-bold uppercase tracking-wider text-amber-700 mb-1">Quán quân</div>
                  <Link
                    href={`/chapter-manager/members/${topThree[0].userId || topThree[0].id}`}
                    className="text-lg font-bold text-[#172554] hover:text-[#2563EB] truncate block transition"
                  >
                    {topThree[0].displayName || topThree[0].email?.split('@')[0]}
                  </Link>
                  <p className="text-xs text-[#737686] truncate mb-3">{topThree[0].email}</p>
                  <div className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-amber-100 text-amber-900 rounded-full text-base font-black border border-amber-300 shadow-inner">
                    <span>⭐</span> {topThree[0].stars?.toLocaleString('vi-VN') || 0}
                  </div>
                  {topThree[0].department && (
                    <div className="mt-2 text-xs text-blue-700 font-bold">
                      {topThree[0].department.name || topThree[0].department}
                    </div>
                  )}
                </Card>
              )}

              {/* Hạng 3 */}
              {topThree[2] && (
                <Card className="p-6 text-center border-t-4 border-t-amber-700/60 bg-gradient-to-b from-amber-50/20 to-white hover:shadow-md transition">
                  <div className="text-4xl mb-2">🥉</div>
                  <div className="text-xs font-bold uppercase tracking-wider text-amber-800 mb-1">Hạng 3</div>
                  <Link
                    href={`/chapter-manager/members/${topThree[2].userId || topThree[2].id}`}
                    className="text-base font-bold text-[#172554] hover:text-[#2563EB] truncate block transition"
                  >
                    {topThree[2].displayName || topThree[2].email?.split('@')[0]}
                  </Link>
                  <p className="text-xs text-[#737686] truncate mb-3">{topThree[2].email}</p>
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-800 rounded-full text-sm font-extrabold border border-amber-200">
                    <span>⭐</span> {topThree[2].stars?.toLocaleString('vi-VN') || 0}
                  </div>
                  {topThree[2].department && (
                    <div className="mt-2 text-xs text-blue-700 font-semibold">
                      {topThree[2].department.name || topThree[2].department}
                    </div>
                  )}
                </Card>
              )}
            </div>
          )}

          {/* Toàn bộ bảng xếp hạng */}
          <Card shadow="sm" className="overflow-hidden border border-[#eff4ff]">
            <div className="px-6 py-4 border-b border-[#eff4ff] bg-slate-50/50 flex justify-between items-center">
              <h2 className="text-sm font-bold text-[#172554]">
                Toàn bộ thành viên ({members.length})
              </h2>
              <span className="text-xs text-[#737686]">Sắp xếp theo tổng Star tích lũy</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[#eff4ff] bg-slate-50/80 text-xs font-semibold text-[#737686]">
                    <th className="py-3 px-6 text-center w-20">Hạng</th>
                    <th className="py-3 px-6">Thành viên</th>
                    <th className="py-3 px-6">Ban</th>
                    <th className="py-3 px-6 text-right">Tổng ⭐ Star</th>
                    <th className="py-3 px-6 text-center">Khóa hoàn thành</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eff4ff]">
                  {members.map((m: any, index: number) => {
                    const isTopThree = index < 3;
                    const deptName = typeof m.department === 'string' ? m.department : (m.department?.name || 'Chưa phân ban');
                    const mId = m.userId || m.id;
                    return (
                      <tr
                        key={mId || index}
                        className={`hover:bg-blue-50/40 transition ${
                          isTopThree ? 'bg-amber-50/15 font-medium' : ''
                        }`}
                      >
                        <td className="py-3.5 px-6 text-center font-bold text-[#172554]">
                          <span
                            className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm ${
                              index === 0
                                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                : index === 1
                                ? 'bg-slate-200 text-slate-800'
                                : index === 2
                                ? 'bg-amber-700/20 text-amber-900'
                                : 'text-[#737686]'
                            }`}
                          >
                            {getMedal(index)}
                          </span>
                        </td>
                        <td className="py-3.5 px-6">
                          <Link
                            href={`/chapter-manager/members/${mId}`}
                            className="font-semibold text-[#172554] hover:text-[#2563EB] transition block"
                          >
                            {m.displayName || m.email?.split('@')[0]}
                          </Link>
                          <div className="text-xs text-[#737686]">{m.email}</div>
                        </td>
                        <td className="py-3.5 px-6">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            deptName === 'Chưa phân ban'
                              ? 'bg-slate-100 text-slate-600 border border-slate-200'
                              : 'bg-blue-50 text-blue-700 border border-blue-100'
                          }`}>
                            {deptName}
                          </span>
                        </td>
                        <td className="py-3.5 px-6 text-right">
                          <span className="inline-flex items-center gap-1 font-extrabold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                            ⭐ {(m.stars || 0).toLocaleString('vi-VN')}
                          </span>
                        </td>
                        <td className="py-3.5 px-6 text-center text-xs font-semibold text-[#434655]">
                          {m.completedCourses ?? 0} khóa
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
