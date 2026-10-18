'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { apiFetch, getCachedApiData } from '@/lib/api/client';

export default function StudentLeaderboardPage() {
  const [user, setUser] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showExplainModal, setShowExplainModal] = useState(false);

  useEffect(() => {
    let currentUser: any = null;
    if (typeof window !== 'undefined') {
      const u = localStorage.getItem('user');
      if (u) {
        try {
          currentUser = JSON.parse(u);
          setUser(currentUser);
        } catch {}
      }
    }
    loadData(currentUser);
  }, []);

  async function loadData(currentUser?: any) {
    if (!currentUser?.chapterId) {
      // User might not have chapterId cached in localStorage, let's fetch /api/v1/users/me
      const meRes = await apiFetch<any>('/api/v1/users/me');
      if (meRes.ok && meRes.data) {
        currentUser = { ...currentUser, ...meRes.data };
        setUser(currentUser);
      }
    }

    if (currentUser?.chapterId) {
      const url = `/api/v1/leaderboard/chapters/${currentUser.chapterId}`;
      const cached = getCachedApiData<any>(url);
      if (cached?.items) {
        setMembers(cached.items);
        setLoading(false);
      }
      const res = await apiFetch<any>(url);
      if (res.ok && res.data) {
        setMembers(res.data.items || []);
      }
    }
    setLoading(false);
  }

  const getMedal = (index: number) => {
    if (index === 0) return '🥇';
    if (index === 1) return '🥈';
    if (index === 2) return '🥉';
    return `#${index + 1}`;
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[#2563EB] mb-1">Thi đua học tập</p>
          <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Bảng Xếp Hạng Chapter
          </h1>
          <p className="text-sm text-[#737686] mt-1">
            {user?.chapterName ? `Thứ hạng thi đua thành viên thuộc ${user.chapterName}` : 'Xếp hạng thành viên theo số Star tích lũy'}
          </p>
        </div>

        <button
          onClick={() => setShowExplainModal(true)}
          className="self-start md:self-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-50 text-[#2563EB] text-xs font-bold hover:bg-blue-100 transition shadow-2xs border border-blue-200"
        >
          <span>ℹ️</span> Thể lệ tính điểm & xếp hạng
        </button>
      </div>

      {loading ? (
        <Card className="p-12 text-center border border-[#eff4ff] shadow-sm">
          <div className="w-8 h-8 border-3 border-[#2563EB] border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-xs text-[#737686]">Đang tải bảng xếp hạng Chapter...</p>
        </Card>
      ) : !user?.chapterId ? (
        <Card className="p-12 text-center border border-[#eff4ff] shadow-sm">
          <div className="text-4xl mb-3">🏛️</div>
          <h3 className="text-base font-bold text-[#172554] mb-1">Chưa phân bổ Chapter</h3>
          <p className="text-xs text-[#737686] max-w-md mx-auto">
            Tài khoản của bạn hiện chưa được phân bổ vào Chapter nào. Vui lòng liên hệ Trưởng ban hoặc Quản trị viên để được gán vào Chapter.
          </p>
        </Card>
      ) : members.length === 0 ? (
        <Card className="p-12 text-center border border-[#eff4ff] shadow-sm">
          <div className="text-4xl mb-3">⭐</div>
          <h3 className="text-base font-bold text-[#172554] mb-1">Chưa có dữ liệu xếp hạng</h3>
          <p className="text-xs text-[#737686] max-w-md mx-auto">
            Hãy là người đầu tiên hoàn thành bài học và bài kiểm tra để ghi danh trên bảng xếp hạng!
          </p>
          <div className="mt-4">
            <Link href="/student/courses">
              <Button size="sm">Bắt đầu học ngay →</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0 border border-[#eff4ff] shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#eff4ff] bg-[#f8f9ff] text-[11px] font-bold text-[#737686] uppercase tracking-wider">
                  <th className="py-4 px-6 text-center w-16">Hạng</th>
                  <th className="py-4 px-6">Thành viên</th>
                  <th className="py-4 px-6 text-center">Tiến độ bài học</th>
                  <th className="py-4 px-6 text-center">Điểm Quiz TB</th>
                  <th className="py-4 px-6 text-right">Tổng Star</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eff4ff] text-sm">
                {members.map((m, idx) => {
                  const isCurrent = user?.email && m.email && user.email.toLowerCase() === m.email.toLowerCase();
                  return (
                    <tr
                      key={m.userId || idx}
                      className={`transition-colors ${
                        isCurrent
                          ? 'bg-blue-50/70 font-semibold text-[#172554]'
                          : 'hover:bg-[#f8f9ff] text-[#434655]'
                      }`}
                    >
                      <td className="py-4 px-6 text-center">
                        <span className={`inline-flex items-center justify-center font-bold ${
                          idx < 3 ? 'text-xl' : 'text-xs text-[#737686]'
                        }`}>
                          {getMedal(idx)}
                        </span>
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                            isCurrent
                              ? 'bg-[#2563EB] text-white shadow-xs'
                              : 'bg-[#eff4ff] text-[#2563EB]'
                          }`}>
                            {(m.displayName || m.email || 'U').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-[#172554] truncate">
                              {m.displayName || m.email}
                              {isCurrent && (
                                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#2563EB] text-white">
                                  Bạn
                                </span>
                              )}
                            </p>
                            {m.departmentName && (
                              <p className="text-[11px] text-[#737686] truncate">
                                {m.departmentName}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <span className="text-xs font-bold text-[#172554]">
                          {m.completedLessons || 0} / {m.totalLessons || 0} bài
                        </span>
                      </td>
                      <td className="py-4 px-6 text-center">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {m.avgScore ?? m.avgQuizScore ?? m.assessmentAverageScore ?? 0}%
                        </span>
                      </td>
                      <td className="py-4 px-6 text-right">
                        <span className="font-extrabold text-base text-amber-600">
                          {(m.stars || 0).toLocaleString('vi-VN')}
                        </span>
                        <span className="ml-1 text-xs text-amber-600 font-bold">⭐</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Explanation Modal */}
      <Modal
        isOpen={showExplainModal}
        onClose={() => setShowExplainModal(false)}
        maxWidth="max-w-xl"
      >
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-[#eff4ff] pb-3">
            <h3 className="text-lg font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              ℹ️ Thể lệ tích lũy Star & Xếp hạng
            </h3>
            <button
              onClick={() => setShowExplainModal(false)}
              className="text-[#737686] hover:text-[#172554] text-xl font-bold p-1 rounded-lg hover:bg-slate-100 transition"
            >
              ✕
            </button>
          </div>

          <div className="space-y-3 text-xs text-[#434655] leading-relaxed">
            <div className="p-3 bg-[#f8f9ff] rounded-xl border border-[#eff4ff] space-y-1">
              <p className="font-bold text-[#172554] flex items-center gap-1.5">
                <span>📹</span> Hoàn thành video bài giảng:
              </p>
              <p>Xem đủ 100% video (không tua trước) để nhận Star tích lũy tương ứng với thời lượng bài học.</p>
            </div>

            <div className="p-3 bg-[#f8f9ff] rounded-xl border border-[#eff4ff] space-y-1">
              <p className="font-bold text-[#172554] flex items-center gap-1.5">
                <span>📝</span> Đạt bài kiểm tra từng bài:
              </p>
              <p>Mỗi câu trả lời đúng được cộng 1 Star danh dự khi đạt từ 85% điểm trở lên.</p>
            </div>

            <div className="p-3 bg-[#f8f9ff] rounded-xl border border-[#eff4ff] space-y-1">
              <p className="font-bold text-[#172554] flex items-center gap-1.5">
                <span>🎓</span> Bài thi đánh giá cuối khóa:
              </p>
              <p>Được mở khi hoàn thành toàn bộ các bài học trong khóa. Đạt bài thi cuối khóa để hoàn tất khóa học và nhận thưởng lớn.</p>
            </div>

            <div className="p-3 bg-[#f8f9ff] rounded-xl border border-[#eff4ff] space-y-1">
              <p className="font-bold text-[#172554] flex items-center gap-1.5">
                <span>🏆</span> Tiêu chí xếp hạng Chapter:
              </p>
              <p>Ưu tiên xếp theo: 1) Tổng số Star tích lũy giảm dần, 2) Điểm trung bình Quiz, 3) Số bài học hoàn thành.</p>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <Button size="sm" onClick={() => setShowExplainModal(false)}>
              Đã hiểu
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
