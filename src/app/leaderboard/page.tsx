'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/layout/Sidebar';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { apiFetch, getCachedApiData } from '@/lib/api/client';

export default function LeaderboardPage() {
  const [user, setUser] = useState<any>(null);
  const [mounted, setMounted] = useState(false);

  const [activeTab, setActiveTab] = useState<'members' | 'chapters'>('members');
  const [members, setMembers] = useState<any[]>([]);
  const [chapters, setChapters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Chapter Drill-down Modal
  const [selectedChapter, setSelectedChapter] = useState<any | null>(null);
  const [chapterMembers, setChapterMembers] = useState<any[]>([]);
  const [chapterMembersLoading, setChapterMembersLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
    let parsed: any = null;
    if (typeof window !== 'undefined') {
      const u = localStorage.getItem('user');
      if (u) {
        try {
          parsed = JSON.parse(u);
          setUser(parsed);
        } catch {}
      }
    }
    loadData(parsed);
  }, []);

  async function loadData(currentUser?: any) {
    // BĐHU chỉ xem bảng xếp hạng thành viên chapter mình (bảng global dùng cho khách/member)
    if (currentUser?.role === 'CHAPTER_LEADER' && currentUser?.chapterId) {
      const res = await apiFetch(`/api/v1/leaderboard/chapters/${currentUser.chapterId}`);
      if (res.ok && res.data) {
        setMembers(res.data.items || []);
      }
      setLoading(false);
      return;
    }

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
  const isLeaderView = Boolean(mounted && user?.role === 'CHAPTER_LEADER');

  const content = (
    <div className="max-w-5xl mx-auto px-6 py-10 flex-1 w-full space-y-8">
      {/* Header */}
      <div className="text-center max-w-2xl mx-auto space-y-2">
        <span className="inline-block text-xs font-bold px-3 py-1 bg-[#2563EB]/10 text-[#2563EB] rounded-full">
          🏆 Vinh danh học tập BBE
        </span>
        <h1 className="text-3xl md:text-4xl font-extrabold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
          {isLeaderView ? 'Bảng Xếp Hạng Chapter' : 'Bảng Xếp Hạng'}
        </h1>
        <p className="text-sm text-[#737686]">
          {isLeaderView
            ? `Thành viên xuất sắc của ${user?.chapterName || 'chapter của bạn'} — theo tiến độ khóa học và điểm bài kiểm tra`
            : 'Ghi nhận nỗ lực học tập, tiến độ khóa học và điểm số bài kiểm tra của các thành viên BBE'}
        </p>
      </div>

      {/* Tabs Switcher (ẩn với BĐHU — chỉ hiện bảng xếp hạng chapter của mình) */}
      {!isLeaderView && (
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
      ) : activeTab === 'members' ? (
        <div className="space-y-8">
          {/* Top 3 Podium */}
          {topThree.length >= 3 && (
            <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto items-end pt-8 pb-4">
              {/* Rank 2 */}
              <Card className="text-center p-4 bg-gradient-to-b from-slate-50 to-slate-100 border-slate-200 order-1 shadow-sm">
                <div className="text-3xl mb-1">🥈</div>
                <div className="font-bold text-sm text-[#172554] truncate">{topThree[1].email?.split('@')[0]}</div>
                {!isLeaderView && (
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
                {!isLeaderView && (
                  <div className="text-xs text-[#737686] truncate mb-2">{topThree[0].chapterName || 'BBE Club'}</div>
                )}
                <div className="text-xl font-extrabold text-amber-600">{topThree[0].points || topThree[0].leaderboardPoint || 0} đ</div>
              </Card>

              {/* Rank 3 */}
              <Card className="text-center p-4 bg-gradient-to-b from-orange-50/50 to-orange-100/40 border-orange-200 order-3 shadow-sm">
                <div className="text-3xl mb-1">🥉</div>
                <div className="font-bold text-sm text-[#172554] truncate">{topThree[2].email?.split('@')[0]}</div>
                {!isLeaderView && (
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
                  {!isLeaderView && <th className="px-6 py-4">Chapter</th>}
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
                    {!isLeaderView && (
                      <td className="px-6 py-4 text-[#434655]">
                        {m.chapterName || '—'}
                      </td>
                    )}
                    <td className="px-6 py-4 text-center text-[#434655] font-medium">
                      {m.completedLessons || 0} bài
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
                          Đã hoàn thành: {m.completedLessons || 0} bài học • Điểm Quiz: {m.avgScore || 0}%
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
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f8f9ff] flex">
      {mounted && user ? (
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
