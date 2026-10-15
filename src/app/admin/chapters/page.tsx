'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import { apiFetch, getCachedApiData } from '@/lib/api/client';
import { useAdmin } from '../AdminContext';

export default function AdminChaptersProgressPage() {
  const { mounted } = useAdmin();

  const [chapters, setChapters] = useState<any[]>([]);
  const [excludedChapters, setExcludedChapters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChapter, setSelectedChapter] = useState<any | null>(null);
  const [chapterMembers, setChapterMembers] = useState<any[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [kpiHistory, setKpiHistory] = useState<any[]>([]);
  const [kpiForm, setKpiForm] = useState({ month: new Date().toISOString().slice(0, 7), status: 'YELLOW', note: '' });
  const [kpiSaving, setKpiSaving] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
  };

  useEffect(() => {
    const cached = getCachedApiData<any>('/api/v1/leaderboard/chapters');
    if (cached?.items) {
      setChapters(cached.items);
      setLoading(false);
    }
    loadChapters();
  }, []);

  async function loadChapters() {
    const res = await apiFetch('/api/v1/leaderboard/chapters');
    if (res.ok && res.data) {
      setChapters(res.data.items || []);
      setExcludedChapters(res.data.excluded || []);
    }
    setLoading(false);
  }

  async function handleOpenChapterDrillDown(chapter: any) {
    setSelectedChapter(chapter);
    setMembersLoading(true);
    const chapterId = chapter.chapterId || chapter.id;
    const [res, kpiRes] = await Promise.all([
      apiFetch(`/api/v1/chapters/${chapterId}/dashboard/members`, { noCache: true }),
      apiFetch(`/api/v1/chapters/${chapterId}/kpi`, { noCache: true }),
    ]);
    if (kpiRes.ok) setKpiHistory(kpiRes.data?.items || []);
    if (res.ok && res.data) {
      const items = (res.data.items || []).filter(
        (m: any) => m.role === 'MEMBER' || (!m.role && m.role !== 'CHAPTER_LEADER')
      );
      setChapterMembers(items);
    } else {
      setChapterMembers([]);
      showToast('error', 'Không thể tải danh sách thành viên chapter.');
    }
    setMembersLoading(false);
  }

  async function saveKpi() {
    if (!selectedChapter) return;
    setKpiSaving(true);
    const chapterId = selectedChapter.chapterId || selectedChapter.id;
    const res = await apiFetch(`/api/v1/chapters/${chapterId}/kpi`, { method: 'PUT', body: JSON.stringify({ month: kpiForm.month, status: kpiForm.status, note: kpiForm.note.trim() }) });
    if (res.ok) {
      showToast('success', 'Đã cập nhật KPI tháng.');
      const history = await apiFetch(`/api/v1/chapters/${chapterId}/kpi`, { noCache: true });
      if (history.ok) setKpiHistory(history.data?.items || []);
      loadChapters();
    } else showToast('error', res.error?.message || 'Không cập nhật được KPI.');
    setKpiSaving(false);
  }

  const getMedal = (rank: number) => {
    if (rank === 0) return '🥇';
    if (rank === 1) return '🥈';
    if (rank === 2) return '🥉';
    return `#${rank + 1}`;
  };

  const totalMembersAll = chapters.reduce((sum, ch) => sum + (ch.memberCount || 0), 0);
  const averageChapterCompletion = chapters.length
    ? Math.round(chapters.reduce((sum, chapter) => sum + (chapter.completion?.averagePercent || 0), 0) / chapters.length)
    : 0;
  const averageStarsPerMember = totalMembersAll
    ? Math.round(chapters.reduce((sum, chapter) => sum + (chapter.stars?.averagePerMember || 0) * (chapter.memberCount || 0), 0) / totalMembersAll * 10) / 10
    : 0;

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Bảng xếp hạng Chapter
          </h1>
          <p className="text-[#737686] mt-1 text-sm">
            Xếp hạng theo độ đồng đều học tập, ⭐ bình quân/thành viên, KPI và quy mô Chapter
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/admin/users">
            <Button variant="secondary">👥 Quản lý tài khoản</Button>
          </Link>
          <Link href="/admin/invitations">
            <Button>✉️ Mời Lead</Button>
          </Link>
        </div>
      </div>

      <Card className="mb-6 border border-blue-200 bg-blue-50/60 p-5">
        <h2 className="font-bold text-[#172554]">Nhập KPI và cách tính điểm</h2>
        <p className="mt-2 text-sm text-[#434655]">Bấm “KPI & lịch sử” tại bất kỳ Chapter nào, kể cả Chapter chưa đủ điều kiện, để nhập KPI Đen, Đỏ, Vàng hoặc Xanh và xem các tháng trước.</p>
        <p className="mt-2 text-xs leading-6 text-[#737686]">Điều kiện vào bảng: ít nhất 20 thành viên, ít nhất 50% thành viên đạt ≥70% lộ trình bắt buộc, KPI không Đen/Đỏ. Điểm = hoàn thành trung bình × 30% + điểm Star tương đối × 30% + điểm quy mô × 20% + 20 điểm nếu KPI Xanh. Điểm quy mô = min(100, số thành viên / 51 × 100); KPI Vàng cộng 0.</p>
      </Card>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <Card shadow="md" className="p-4 border border-[#eff4ff]">
          <div className="text-xs font-semibold text-[#737686]">Chapter đủ điều kiện BXH</div>
          <div className="text-2xl font-bold text-[#172554] mt-1">{chapters.length}</div>
          <div className="text-[11px] text-[#737686] mt-0.5">Chapter đỏ/thiếu điều kiện bị loại</div>
        </Card>
        <Card shadow="md" className="p-4 border border-[#eff4ff]">
          <div className="text-xs font-semibold text-blue-700">Tổng thành viên</div>
          <div className="text-2xl font-bold text-[#2563EB] mt-1">{totalMembersAll}</div>
          <div className="text-[11px] text-[#737686] mt-0.5">Học viên tham gia</div>
        </Card>
        <Card shadow="md" className="p-4 border border-[#eff4ff]">
          <div className="text-xs font-semibold text-green-700">Completion TB Chapter</div>
          <div className="text-2xl font-bold text-green-700 mt-1">{averageChapterCompletion}%</div>
          <div className="text-[11px] text-[#737686] mt-0.5">Trung bình các Chapter đủ điều kiện</div>
        </Card>
        <Card shadow="md" className="p-4 border border-[#eff4ff]">
          <div className="text-xs font-semibold text-amber-700">⭐ Bình quân / thành viên</div>
          <div className="text-2xl font-bold text-amber-600 mt-1">{averageStarsPerMember} ⭐</div>
          <div className="text-[11px] text-[#737686] mt-0.5">Không dùng tổng Star để so quy mô</div>
        </Card>
        <Card shadow="md" className="p-4 border border-[#eff4ff]">
          <div className="text-xs font-semibold text-amber-700">Chapter dẫn đầu</div>
          <div
            className="text-base lg:text-lg font-bold text-amber-600 mt-1 line-clamp-1 break-words"
            title={chapters[0]?.name || 'Chưa có'}
          >
            {chapters[0]?.name || '—'}
          </div>
          <div className="text-[11px] text-[#737686] mt-0.5">Điểm BXH: {chapters[0]?.score || 0} / 100</div>
        </Card>
      </div>

      {/* Chapter Rankings Table */}
      <Card className="p-0 overflow-hidden border border-[#eff4ff] shadow-sm">
        {!mounted || (loading && chapters.length === 0) ? (
          <div className="p-8 space-y-4 animate-pulse">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-16 bg-slate-100 rounded-xl"></div>
            ))}
          </div>
        ) : chapters.length === 0 ? (
          <div className="text-center py-16 text-[#737686]">
            <p className="text-lg font-semibold text-[#172554] mb-1">Chưa có dữ liệu Chapter</p>
            <p className="text-sm text-[#737686]">Vui lòng tạo chapter hoặc mời Trưởng Chapter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f8f9ff] text-[#434655] font-semibold border-b border-[#eff4ff]">
                <tr>
                  <th className="px-6 py-4 w-16 text-center">Hạng</th>
                  <th className="px-6 py-4">Tên Chapter</th>
                  <th className="px-6 py-4 text-center">Thành viên</th>
                  <th className="px-6 py-4 text-center">Completion bình quân / trung vị</th>
                  <th className="px-6 py-4 text-center">⭐ / thành viên</th>
                  <th className="px-6 py-4 text-center">KPI tháng</th>
                  <th className="px-6 py-4 text-center">Điểm BXH</th>
                  <th className="px-6 py-4 text-right">Chi tiết</th>
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
                        <p className="text-xs text-[#737686] font-normal mt-0.5 line-clamp-1">{ch.description}</p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center font-medium text-[#434655]">
                      <span className="whitespace-nowrap inline-flex items-center px-2.5 py-0.5 rounded-full bg-blue-50 text-[#2563EB] text-xs font-bold">
                        {ch.memberCount} học viên
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center text-[#172554] font-semibold">
                      <div>{ch.completion?.averagePercent || 0}% / {ch.completion?.medianPercent || 0}%</div>
                      <div className="text-[11px] text-[#737686]">≥70%: {ch.completion?.atLeast70Percent || 0}% thành viên</div>
                    </td>
                    <td className="px-6 py-4 text-center font-extrabold text-[#2563EB] text-base">
                      {ch.stars?.averagePerMember || 0} ⭐
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${ch.kpi?.status === 'GREEN' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>
                        {ch.kpi?.status === 'GREEN' ? 'Xanh +20' : 'Vàng +0'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center font-extrabold text-[#172554] text-base">
                      {ch.score} <span className="text-xs font-normal text-[#737686]">/ 100</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenChapterDrillDown(ch);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#eff4ff] hover:bg-[#2563EB] text-[#2563EB] hover:text-white text-xs font-bold transition-all shadow-xs"
                      >
                        KPI & lịch sử →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {excludedChapters.length > 0 && (
        <Card className="mt-6 border border-amber-200 bg-amber-50/50 shadow-sm">
          <h2 className="font-bold text-[#172554]">Chưa đủ điều kiện tham gia BXH</h2>
          <p className="mt-1 text-xs text-[#737686]">Admin có thể dùng danh sách này để theo dõi Chapter cần hỗ trợ.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {excludedChapters.map((chapter) => <button key={chapter.chapterId} onClick={() => handleOpenChapterDrillDown(chapter)} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-left text-xs text-[#434655] hover:border-blue-300">
              <strong>{chapter.name}</strong>
              <span className="mt-1 block">{(chapter.reasons || []).map((reason: string) => reason === 'MINIMUM_MEMBERS' ? `Chưa đủ 20 thành viên (${chapter.memberCount})` : reason === 'COMPLETION_THRESHOLD' ? `Chưa đạt 50% thành viên ≥70% (${chapter.atLeast70Percent}% đã đạt)` : reason === 'KPI_RED' ? 'KPI Đỏ' : 'KPI Đen').join(' · ')}</span>
              <span className="mt-1 block font-semibold text-blue-700">KPI & lịch sử →</span>
            </button>)}
          </div>
        </Card>
      )}

      {/* Modal / Drill-down: Chapter Members & Individual Progress */}
      <Modal
        isOpen={Boolean(selectedChapter)}
        onClose={() => setSelectedChapter(null)}
        maxWidth="max-w-3xl"
      >
        {selectedChapter && (
          <div className="p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-[#eff4ff] pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="whitespace-nowrap inline-flex items-center text-xs font-bold px-2.5 py-0.5 bg-blue-100 text-[#2563EB] rounded-full">
                    🏛️ Chapter
                  </span>
                  <h3 className="text-2xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                    {selectedChapter.name}
                  </h3>
                </div>
                <p className="text-xs text-[#737686] mt-1">
                  Theo dõi tiến độ học tập và bài học hoàn thành của từng học viên trong Chapter
                </p>
              </div>
              <button
                onClick={() => setSelectedChapter(null)}
                className="text-[#737686] hover:text-[#172554] text-xl font-bold p-1 rounded-lg hover:bg-slate-100 transition"
              >
                ✕
              </button>
            </div>

            <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 space-y-3">
              <h4 className="font-bold text-[#172554]">Nhập KPI Chapter theo tháng</h4>
              <div className="grid gap-2 sm:grid-cols-3">
                <input type="month" value={kpiForm.month} onChange={(e) => setKpiForm({ ...kpiForm, month: e.target.value })} className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm" />
                <select value={kpiForm.status} onChange={(e) => setKpiForm({ ...kpiForm, status: e.target.value })} className="rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"><option value="BLACK">Đen</option><option value="RED">Đỏ</option><option value="YELLOW">Vàng</option><option value="GREEN">Xanh</option></select>
                <Button loading={kpiSaving} onClick={saveKpi}>Lưu KPI</Button>
              </div>
              <input value={kpiForm.note} onChange={(e) => setKpiForm({ ...kpiForm, note: e.target.value })} placeholder="Ghi chú KPI" className="w-full rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm" />
              <h5 className="text-xs font-bold uppercase tracking-wide text-[#737686]">Lịch sử các tháng</h5>
              <div className="max-h-40 overflow-auto divide-y divide-blue-100 text-xs">{kpiHistory.map((item, index) => <div key={`${item.month}-${index}`} className="grid grid-cols-3 gap-2 py-2"><span>{new Date(item.month).toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric' })}</span><strong>{item.status}</strong><span>{item.note || 'Không ghi chú'}</span></div>)}{!kpiHistory.length && <p className="py-2 text-[#737686]">Chưa có KPI tháng nào.</p>}</div>
            </div>

            {membersLoading ? (
              <div className="py-12 text-center text-[#737686]">Đang tải thành viên...</div>
            ) : chapterMembers.length === 0 ? (
              <div className="py-12 text-center text-[#737686]">
                <p className="font-semibold text-[#172554] mb-1">Chapter này chưa có học viên</p>
                <p className="text-xs">Chưa có học viên nào tham gia chapter này.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-xs font-bold text-[#737686] uppercase tracking-wider">
                  Tổng số: {chapterMembers.length} thành viên
                </div>

                <div className="divide-y divide-[#eff4ff] border border-[#eff4ff] rounded-2xl overflow-hidden">
                  {chapterMembers.map((m) => {
                    const mId = m.userId || m.id;
                    const isActive = m.status === 'ACTIVE';

                    return (
                      <div key={mId} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-[#f8f9ff] transition">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[#172554] text-sm">{m.email}</span>
                            <span
                              className={`whitespace-nowrap inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {isActive ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          <div className="text-xs text-[#737686] flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span>Khóa học: <strong className="text-[#172554]">{m.completedCourses || 0} / {m.totalCourses || 0}</strong></span>
                            <span>•</span>
                            <span>⭐ <strong className="text-amber-600">{m.stars || 0}</strong></span>
                            <span>•</span>
                            <span>Bài học: <strong className="text-[#2563EB]">{m.completedLessons || 0} / {m.totalLessons || 0}</strong> bài</span>
                            <span>•</span>
                            <span suppressHydrationWarning>Tham gia: {m.joinedAt ? new Date(m.joinedAt).toLocaleDateString('vi-VN') : 'Mới'}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <Link href={`/chapter-manager/members/${mId}`} className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50">
                            Lộ trình học
                          </Link>
                          {/* Progress bar */}
                          <div className="text-right shrink-0">
                            <div className="text-xs font-bold text-[#2563EB]">{m.avgProgress || 0}%</div>
                            <div className="w-24 bg-slate-100 h-1.5 rounded-full mt-1 overflow-hidden">
                              <div
                                className="bg-[#2563EB] h-full rounded-full"
                                style={{ width: `${m.avgProgress || 0}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-3 border-t border-[#eff4ff]">
              <Button variant="secondary" onClick={() => setSelectedChapter(null)}>
                Đóng
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
