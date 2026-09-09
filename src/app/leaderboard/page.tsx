'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/layout/Sidebar';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { apiFetch, getCachedApiData } from '@/lib/api/client';

export default function LeaderboardPage() {
  const [user, setUser] = useState<any>(() => {
    if (typeof window !== 'undefined') {
      try {
        const u = localStorage.getItem('user');
        return u ? JSON.parse(u) : null;
      } catch {
        return null;
      }
    }
    return null;
  });
  const [mounted, setMounted] = useState(false);

  const [activeTab, setActiveTab] = useState<'members' | 'chapters'>('members');

  const [members, setMembers] = useState<any[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const u = localStorage.getItem('user');
        const parsed = u ? JSON.parse(u) : null;
        const isScopedRole = parsed?.role === 'CHAPTER_LEADER' || parsed?.role === 'MEMBER';
        if (isScopedRole && parsed?.chapterId) {
          const cached = getCachedApiData<any>(`/api/v1/leaderboard/chapters/${parsed.chapterId}`);
          return cached?.items || [];
        }
        if (parsed?.role !== 'MEMBER') {
          const cached = getCachedApiData<any>('/api/v1/leaderboard');
          return cached?.items || [];
        }
      } catch {}
    }
    return [];
  });

  const [chapters, setChapters] = useState<any[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const u = localStorage.getItem('user');
        const parsed = u ? JSON.parse(u) : null;
        if (parsed?.role === 'ADMIN' || parsed?.role === 'SUPER_ADMIN') {
          const cached = getCachedApiData<any>('/api/v1/leaderboard/chapters');
          return cached?.items || [];
        }
      } catch {}
    }
    return [];
  });

  const [loading, setLoading] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const u = localStorage.getItem('user');
        const parsed = u ? JSON.parse(u) : null;
        const isScopedRole = parsed?.role === 'CHAPTER_LEADER' || parsed?.role === 'MEMBER';
        if (isScopedRole && parsed?.chapterId) {
          const cached = getCachedApiData<any>(`/api/v1/leaderboard/chapters/${parsed.chapterId}`);
          return !cached?.items;
        }
        if (parsed?.role === 'MEMBER' && !parsed?.chapterId) {
          return false;
        }
        const cached = getCachedApiData<any>('/api/v1/leaderboard');
        return !cached?.items;
      } catch {}
    }
    return true;
  });

  // Chapter Drill-down Modal
  const [selectedChapter, setSelectedChapter] = useState<any | null>(null);
  const [chapterMembers, setChapterMembers] = useState<any[]>([]);
  const [chapterMembersLoading, setChapterMembersLoading] = useState(false);
  const [showExplainModal, setShowExplainModal] = useState(false);

  useEffect(() => {
    setMounted(true);
    let currentUser = user;
    if (!currentUser && typeof window !== 'undefined') {
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
    // BĐHU & Thành viên chỉ xem bảng xếp hạng thành viên trong chapter của mình (không global)
    const isScopedRole = currentUser?.role === 'CHAPTER_LEADER' || currentUser?.role === 'MEMBER';
    if (isScopedRole && currentUser?.chapterId) {
      const url = `/api/v1/leaderboard/chapters/${currentUser.chapterId}`;
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
      return;
    }

    // Thành viên chưa có chapter: không hiện bảng global, chỉ hiện hướng dẫn
    if (currentUser?.role === 'MEMBER') {
      setLoading(false);
      return;
    }

    const cachedMembers = getCachedApiData<any>('/api/v1/leaderboard');
    const cachedChapters = getCachedApiData<any>('/api/v1/leaderboard/chapters');
    if (cachedMembers?.items) setMembers(cachedMembers.items);
    if (cachedChapters?.items) setChapters(cachedChapters.items);
    if (cachedMembers?.items && cachedChapters?.items) setLoading(false);

    const [membersRes, chaptersRes] = await Promise.all([
      apiFetch('/api/v1/leaderboard'),
      apiFetch('/api/v1/leaderboard/chapters'),
    ]);

    if (membersRes.ok && membersRes.data) {
      setMembers(membersRes.data.items || []);
    }
    if (chaptersRes.ok && chaptersRes.data) {
      setChapters(chaptersRes.data.items || []);
    }
    setLoading(false);
  }

  async function handleOpenChapterDrillDown(chapter: any) {
    setSelectedChapter(chapter);
    setChapterMembersLoading(true);
    const cId = chapter.chapterId || chapter.id;
    const res = await apiFetch(`/api/v1/leaderboard/chapters/${cId}`);
    if (res.ok && res.data) {
      setChapterMembers(res.data.items || res.data.members || []);
    } else {
      setChapterMembers([]);
    }
    setChapterMembersLoading(false);
  }

  const getMedal = (rank: number) => {
    if (rank === 0) return '🥇';
    if (rank === 1) return '🥈';
    if (rank === 2) return '🥉';
    return `#${rank + 1}`;
  };

  const topThree = members.slice(0, 3);
  const isScopedView = Boolean(mounted && (user?.role === 'CHAPTER_LEADER' || user?.role === 'MEMBER'));
  const memberWithoutChapter = Boolean(mounted && user?.role === 'MEMBER' && !user?.chapterId);

  const content = (
    <div className="max-w-5xl mx-auto px-6 py-10 flex-1 w-full space-y-8">
      {/* Header */}
      <div className="text-center max-w-2xl mx-auto space-y-2">
        <span className="inline-block text-xs font-bold px-3 py-1 bg-[#2563EB]/10 text-[#2563EB] rounded-full">
          🏆 Vinh danh học tập BBE
        </span>
        <h1 className="text-3xl md:text-4xl font-extrabold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
          {isScopedView ? 'Bảng Xếp Hạng Chapter' : 'Bảng Xếp Hạng'}
        </h1>
        <p className="text-sm text-[#737686]">
          {isScopedView
            ? `Thành viên xuất sắc của ${user?.chapterName || 'chapter của bạn'} — theo tiến độ khóa học và điểm bài kiểm tra`
            : 'Ghi nhận nỗ lực học tập, tiến độ khóa học và điểm số bài kiểm tra của các thành viên BBE'}
        </p>
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowExplainModal(true)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2563EB] bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-full transition cursor-pointer"
          >
            <span>💡</span> Điểm thi đua được tính như thế nào?
          </button>
        </div>
      </div>

      {/* Tabs Switcher (ẩn với BĐHU — chỉ hiện bảng xếp hạng chapter của mình) */}
      {!isScopedView && (
        <div className="flex justify-center">
          <div className="bg-[#eff4ff] p-1.5 rounded-2xl flex gap-1 border border-[#cbdbf5]">
            <button
              onClick={() => setActiveTab('members')}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition flex items-center gap-2 ${
                activeTab === 'members'
                  ? 'bg-[#2563EB] text-white shadow-md'
                  : 'text-[#434655] hover:text-[#172554]'
              }`}
            >
              <span>👤</span> Thành viên xuất sắc
            </button>
            <button
              onClick={() => setActiveTab('chapters')}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition flex items-center gap-2 ${
                activeTab === 'chapters'
                  ? 'bg-[#2563EB] text-white shadow-md'
                  : 'text-[#434655] hover:text-[#172554]'
              }`}
            >
              <span>🏛️</span> Xếp hạng Chapter
            </button>
          </div>
        </div>
      )}

      {!mounted || (loading && members.length === 0) ? (
        <div className="text-center py-20 text-[#737686]">Đang tải bảng xếp hạng...</div>
      ) : memberWithoutChapter ? (
        <Card className="p-10 text-center space-y-2">
          <div className="text-4xl mb-2">🏛️</div>
          <p className="text-base font-bold text-[#172554]">Bạn chưa được thêm vào chapter nào</p>
          <p className="text-sm text-[#737686]">Vui lòng liên hệ Ban Điều Hành để được thêm vào chapter và tham gia bảng xếp hạng.</p>
        </Card>
      ) : activeTab === 'members' ? (
        members.length === 0 ? (
          <Card className="p-10 text-center text-sm text-[#737686]">Chưa có dữ liệu xếp hạng trong chapter của bạn</Card>
        ) : (
        <div className="space-y-8">
          {/* Top 3 Podium */}
          {topThree.length >= 3 && (
            <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto items-end pt-8 pb-4">
              {/* Rank 2 */}
              <Card className="text-center p-4 bg-gradient-to-b from-slate-50 to-slate-100 border-slate-200 order-1 shadow-sm">
                <div className="text-3xl mb-1">🥈</div>
                <div className="font-bold text-sm text-[#172554] truncate">{topThree[1].email?.split('@')[0]}</div>
                {!isScopedView && (
                  <div className="text-[11px] text-[#737686] truncate mb-2">{topThree[1].chapterName || 'BBE Club'}</div>
                )}
                <div className="text-base font-extrabold text-[#2563EB]">{topThree[1].points || topThree[1].leaderboardPoint || 0} đ</div>
              </Card>

              {/* Rank 1 */}
              <Card className="text-center p-6 bg-gradient-to-b from-amber-50 to-amber-100/60 border-amber-300 order-2 -translate-y-4 shadow-md relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-amber-950 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow-sm">
                  Quán quân
                </div>
                <div className="text-4xl mb-1">👑</div>
                <div className="font-bold text-base text-[#172554] truncate">{topThree[0].email?.split('@')[0]}</div>
                {!isScopedView && (
                  <div className="text-xs text-[#737686] truncate mb-2">{topThree[0].chapterName || 'BBE Club'}</div>
                )}
                <div className="text-xl font-extrabold text-amber-600">{topThree[0].points || topThree[0].leaderboardPoint || 0} đ</div>
              </Card>

              {/* Rank 3 */}
              <Card className="text-center p-4 bg-gradient-to-b from-orange-50/50 to-orange-100/40 border-orange-200 order-3 shadow-sm">
                <div className="text-3xl mb-1">🥉</div>
                <div className="font-bold text-sm text-[#172554] truncate">{topThree[2].email?.split('@')[0]}</div>
                {!isScopedView && (
                  <div className="text-[11px] text-[#737686] truncate mb-2">{topThree[2].chapterName || 'BBE Club'}</div>
                )}
                <div className="text-base font-extrabold text-[#2563EB]">{topThree[2].points || topThree[2].leaderboardPoint || 0} đ</div>
              </Card>
            </div>
          )}

          {/* Members Table */}
          <Card className="p-0 overflow-hidden border border-[#eff4ff]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f8f9ff] text-[#434655] font-semibold border-b border-[#eff4ff]">
                <tr>
                  <th className="px-6 py-4 w-16 text-center">Hạng</th>
                  <th className="px-6 py-4">Thành viên</th>
                  {!isScopedView && <th className="px-6 py-4">Chapter</th>}
                  <th className="px-6 py-4 text-center">Bài học</th>
                  <th className="px-6 py-4 text-center">Điểm Quiz TB</th>
                  <th className="px-6 py-4 text-right">Điểm thi đua</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#eff4ff]">
                {members.map((m, idx) => (
                  <tr key={m.userId || idx} className="hover:bg-[#f8f9ff] transition">
                    <td className="px-6 py-4 text-center font-bold text-base">
                      {getMedal(idx)}
                    </td>
                    <td className="px-6 py-4 font-semibold text-[#172554]">
                      {m.email}
                    </td>
                    {!isScopedView && (
                      <td className="px-6 py-4 text-[#434655]">
                        {m.chapterName || '—'}
                      </td>
                    )}
                    <td className="px-6 py-4 text-center text-[#434655] font-medium">
                      {m.completedLessons || 0} / {m.totalLessons || 0} bài
                    </td>
                    <td className="px-6 py-4 text-center font-semibold text-[#172554]">
                      {m.avgScore ? `${m.avgScore}%` : '—'}
                    </td>
                    <td className="px-6 py-4 text-right font-extrabold text-[#2563EB] text-base">
                      {m.points || m.leaderboardPoint || 0} điểm
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
        )
      ) : (
        /* Chapter Standings Table */
        <Card className="p-0 overflow-hidden border border-[#eff4ff]">
          {chapters.length === 0 ? (
            <div className="text-center py-16 text-[#737686]">Chưa có dữ liệu xếp hạng Chapter</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#f8f9ff] text-[#434655] font-semibold border-b border-[#eff4ff]">
                  <tr>
                    <th className="px-6 py-4 w-16 text-center">Hạng</th>
                    <th className="px-6 py-4">Chapter</th>
                    <th className="px-6 py-4 text-center">Thành viên</th>
                    <th className="px-6 py-4 text-center">Bài học hoàn thành</th>
                    <th className="px-6 py-4 text-right">Điểm TB Chapter</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eff4ff]">
                  {chapters.map((ch, idx) => (
                    <tr
                      key={ch.chapterId || ch.id || idx}
                      onClick={() => handleOpenChapterDrillDown(ch)}
                      className="hover:bg-[#f8f9ff] transition cursor-pointer group"
                    >
                      <td className="px-6 py-4 text-center font-bold text-base">
                        {getMedal(idx)}
                      </td>
                      <td className="px-6 py-4 font-bold text-[#172554]">
                        <div className="group-hover:text-[#2563EB] transition-colors">{ch.name}</div>
                        {ch.description && (
                          <p className="text-xs text-[#737686] font-normal mt-0.5">{ch.description}</p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center text-[#434655] font-medium">
                        <span className="inline-block px-2.5 py-0.5 rounded-full bg-blue-50 text-[#2563EB] text-xs font-bold">
                          {ch.memberCount} thành viên
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center text-[#172554] font-semibold">
                        {ch.totalCompletedLessons} bài
                      </td>
                      <td className="px-6 py-4 text-right font-extrabold text-[#2563EB] text-base">
                        {ch.avgPoints} điểm
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Modal: Chapter Member Standings Drill-down */}
      <Modal
        isOpen={Boolean(selectedChapter)}
        onClose={() => setSelectedChapter(null)}
        maxWidth="max-w-2xl"
      >
        {selectedChapter && (
          <div className="p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-[#eff4ff] pb-3">
              <div>
                <h3 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                  🏛️ {selectedChapter.name}
                </h3>
                <p className="text-xs text-[#737686]">Thành viên xuất sắc đóng góp vào điểm số Chapter</p>
              </div>
              <button
                onClick={() => setSelectedChapter(null)}
                className="text-[#737686] hover:text-[#172554] text-xl font-bold p-1 rounded-lg hover:bg-slate-100 transition"
              >
                ✕
              </button>
            </div>

            {chapterMembersLoading ? (
              <div className="py-12 text-center text-[#737686]">Đang tải thành viên chapter...</div>
            ) : chapterMembers.length === 0 ? (
              <div className="text-center py-10 text-[#737686]">Chưa có dữ liệu thành viên chapter này</div>
            ) : (
              <div className="space-y-2">
                {chapterMembers.map((m, idx) => (
                  <div
                    key={m.userId || idx}
                    className="p-3 bg-[#f8f9ff] rounded-xl flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-base w-6 text-center">{getMedal(idx)}</span>
                      <div>
                        <div className="font-semibold text-[#172554]">{m.email}</div>
                        <div className="text-xs text-[#737686]">
                          Đã học: {m.completedLessons || 0} / {m.totalLessons || 0} bài • Điểm Quiz: {m.avgScore || 0}%
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-bold text-[#2563EB] text-base">{m.leaderboardPoint || 0}</span>
                      <span className="text-xs text-[#737686] ml-1">điểm</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={() => setSelectedChapter(null)}>
                Đóng
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Giải thích cách tính điểm thi đua */}
      <Modal
        isOpen={showExplainModal}
        onClose={() => setShowExplainModal(false)}
        maxWidth="max-w-lg"
      >
        <div className="p-6 space-y-4">
          <div className="flex justify-between items-center border-b border-[#eff4ff] pb-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">💡</span>
              <h3 className="text-lg font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                Cách tính điểm thi đua BBE
              </h3>
            </div>
            <button
              onClick={() => setShowExplainModal(false)}
              className="text-[#737686] hover:text-[#172554] text-xl font-bold p-1 rounded-lg hover:bg-slate-100 transition"
            >
              ✕
            </button>
          </div>

          <div className="space-y-3 text-sm text-[#434655]">
            <p className="leading-relaxed">
              Điểm thi đua được tính dựa trên 2 yếu tố: <strong>Tiến độ hoàn thành bài học</strong> và <strong>Kết quả làm bài kiểm tra</strong>.
            </p>

            <div className="p-3.5 sm:p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl space-y-2">
              <div className="font-bold text-[#2563EB] text-xs uppercase tracking-wide">Công thức chuẩn hóa:</div>
              <div className="text-xs sm:text-sm md:text-base font-extrabold text-[#172554] bg-white p-3 sm:p-3.5 rounded-xl border border-blue-200 text-center leading-relaxed break-words shadow-xs">
                Điểm thi đua = (Tiến độ bài học × 40%) + (Điểm Quiz TB × 60%)
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex gap-2">
                <span className="font-bold text-[#2563EB] shrink-0">1. Tiến độ bài học (40% trọng số):</span>
                <span>Tỷ lệ số bài học bạn đã xem xong trên tổng số bài học hiện có trong toàn bộ khóa học công khai của hệ thống (Ví dụ: 9 / 23 bài = 39%).</span>
              </div>
              <div className="flex gap-2">
                <span className="font-bold text-[#2563EB] shrink-0">2. Điểm Quiz TB (60% trọng số):</span>
                <span>Điểm số cao nhất bạn đạt được trong các bài kiểm tra đánh giá của các khóa học đã tham gia.</span>
              </div>
              <div className="flex gap-2">
                <span className="font-bold text-[#2563EB] shrink-0">3. Điểm Chapter:</span>
                <span>Điểm trung bình cộng điểm thi đua của tất cả thành viên trong Chapter đó.</span>
              </div>
            </div>

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900">
              📌 <strong>Quy tắc hoàn thành khóa học:</strong> Khóa học chỉ được tính là &quot;Hoàn thành&quot; khi thành viên xem đủ 100% video bài giảng VÀ đạt bài kiểm tra.
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-[#eff4ff]">
            <Button onClick={() => setShowExplainModal(false)}>Đã hiểu</Button>
          </div>
        </div>
      </Modal>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f8f9ff] flex">
      {user ? (
        <>
          <Sidebar role={user.role} user={{ email: user.email, chapterName: user.chapterName }} />
          <main className="ml-64 flex-1 flex flex-col">{content}</main>
        </>
      ) : (
        <div className="flex flex-col flex-1">
          <header className="bg-white/95 backdrop-blur-md border-b border-[#e5eeff] px-6 py-3 sticky top-0 z-50">
            <div className="max-w-5xl mx-auto flex items-center justify-between">
              <Link href="/" className="flex items-center gap-3">
                <img
                  src="/images/logo-transparent.png"
                  alt="BBE Logo"
                  className="h-10 w-auto object-contain"
                />
              </Link>
              <Link href="/login">
                <Button size="sm">Đăng nhập</Button>
              </Link>
            </div>
          </header>
          {content}
        </div>
      )}
    </div>
  );
}
