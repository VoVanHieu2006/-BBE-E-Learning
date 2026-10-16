'use client';

import { useState, useEffect, FormEvent } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { apiFetch } from '@/lib/api/client';

const SAMPLE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1MA9pJ1E8oHEZe8d1g6j0Ns6JqLoOCdhSVSgOflO0JBI/edit?gid=0#gid=0';

export default function ChapterManagerTermTransitionPage() {
  const [user, setUser] = useState<any>(null);
  const [mounted, setMounted] = useState(false);

  // Chế độ xem: 'current' (Nhiệm kỳ hiện tại) | 'history' (Lịch sử)
  const [viewMode, setViewMode] = useState<'current' | 'history'>('current');

  // Dữ liệu sơ đồ hiện tại
  const [rosterData, setRosterData] = useState<any[]>([]);
  const [rosterLoading, setRosterLoading] = useState(true);

  // Modal Chuyển giao nhiệm kỳ
  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [rosterUrl, setRosterUrl] = useState(SAMPLE_SHEET_URL);
  const [effectiveAt, setEffectiveAt] = useState(() => {
    const now = new Date();
    // Default to start of next month or now
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  });
  const [parsing, setParsing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [parsedResult, setParsedResult] = useState<any | null>(null);

  // Modal xác nhận vô hiệu hóa tất cả
  const [showConfirmDeactivate, setShowConfirmDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  // Lịch sử nhiệm kỳ
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistoryTerm, setSelectedHistoryTerm] = useState<any | null>(null);

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
    if (currentUser?.chapterId) {
      loadCurrentRoster(currentUser.chapterId);
    }
  }, []);

  async function loadCurrentRoster(chapterId: string) {
    setRosterLoading(true);
    const res = await apiFetch(`/api/v1/chapters/${chapterId}/current-roster`);
    if (res.ok && res.data) {
      setRosterData(res.data.roster || []);
    }
    setRosterLoading(false);
  }

  async function loadHistory(chapterId: string) {
    setHistoryLoading(true);
    const res = await apiFetch(`/api/v1/chapters/${chapterId}/reorganizations`);
    if (res.ok && res.data) {
      setHistoryList(res.data.items || []);
    }
    setHistoryLoading(false);
  }

  const handleOpenHistory = () => {
    setViewMode('history');
    if (user?.chapterId) {
      loadHistory(user.chapterId);
    }
  };

  const handleOpenCurrent = () => {
    setViewMode('current');
    if (user?.chapterId) {
      loadCurrentRoster(user.chapterId);
    }
  };

  // Đọc và phân tích sheet
  const handleParseSheet = async (e: FormEvent) => {
    e.preventDefault();
    if (!user?.chapterId || !rosterUrl.trim()) return;
    setParsing(true);
    setMessage(null);

    const res = await apiFetch(`/api/v1/chapters/${user.chapterId}/reorganizations/parse-sheet`, {
      method: 'POST',
      body: JSON.stringify({ url: rosterUrl.trim() }),
    });

    setParsing(false);
    if (!res.ok) {
      setMessage({ type: 'error', text: res.error?.message || 'Không thể đọc dữ liệu từ Google Sheet.' });
      setParsedResult(null);
      return;
    }

    setParsedResult(res.data);
  };

  // Vô hiệu hóa tất cả thành viên không có trong sheet
  const handleBulkDeactivate = async () => {
    if (!user?.chapterId || !parsedResult?.unmatchedCurrentMembers?.length) return;
    setDeactivating(true);

    const userIds = parsedResult.unmatchedCurrentMembers.map((m: any) => m.userId);
    const res = await apiFetch(`/api/v1/chapters/${user.chapterId}/members/bulk-deactivate`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    });

    setDeactivating(false);
    setShowConfirmDeactivate(false);

    if (!res.ok) {
      setMessage({ type: 'error', text: res.error?.message || 'Không thể vô hiệu hóa thành viên.' });
      return;
    }

    setMessage({
      type: 'success',
      text: `Đã vô hiệu hóa thành công ${userIds.length} thành viên không có trong nhiệm kỳ mới!`,
    });

    // Cập nhật lại danh sách unmatched
    setParsedResult((prev: any) => ({
      ...prev,
      unmatchedCurrentMembers: [],
    }));

    loadCurrentRoster(user.chapterId);
  };

  // Xác nhận chuyển giao nhiệm kỳ
  const handleConfirmTransition = async () => {
    if (!user?.chapterId || !parsedResult?.items || !effectiveAt) return;
    setScheduling(true);
    setMessage(null);

    const res = await apiFetch(`/api/v1/chapters/${user.chapterId}/reorganizations`, {
      method: 'POST',
      body: JSON.stringify({
        sourceUrl: rosterUrl,
        effectiveAt: new Date(effectiveAt).toISOString(),
        items: parsedResult.items.map((item: any) => ({
          userId: item.userId,
          displayName: item.displayName,
          departmentUnitId: item.departmentUnitId,
          positionId: item.positionId,
          isPrimary: item.isLead,
        })),
      }),
    });

    setScheduling(false);
    if (!res.ok) {
      setMessage({ type: 'error', text: res.error?.message || 'Không thể lưu đợt chuyển giao nhiệm kỳ.' });
      return;
    }

    setShowTransitionModal(false);
    setMessage({
      type: 'success',
      text: res.data?.appliedImmediately
        ? 'Chuyển giao nhiệm kỳ thành công! Hệ thống đã cập nhật Ban và LT ngay lập tức.'
        : 'Đã lên lịch chuyển giao nhiệm kỳ thành công. Hệ thống sẽ tự động áp dụng đúng ngày hiệu lực.',
    });

    loadCurrentRoster(user.chapterId);
  };

  return (
    <div className="space-y-6 max-w-7xl pb-16">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="inline-block text-xs font-bold px-3 py-1 bg-[#2563EB]/10 text-[#2563EB] rounded-full mb-1">
            🔄 Quản trị nhân sự & Nhiệm kỳ Chapter
          </span>
          <h1 className="text-3xl font-extrabold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            Chuyển Giao Nhiệm Kỳ Chapter
          </h1>
          <p className="text-sm text-[#737686] mt-0.5">
            Chapter: <span className="font-semibold text-[#172554]">{mounted && user?.chapterName ? user.chapterName : 'Chapter Demo'}</span> • Cơ cấu 7 Ban chuẩn và sơ đồ lãnh đạo LT
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant={viewMode === 'current' ? 'primary' : 'outline'}
            onClick={handleOpenCurrent}
            size="sm"
          >
            🏛️ Nhiệm kỳ hiện tại
          </Button>
          <Button
            variant={viewMode === 'history' ? 'primary' : 'outline'}
            onClick={handleOpenHistory}
            size="sm"
          >
            📜 Lịch sử nhiệm kỳ
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setShowTransitionModal(true);
              setParsedResult(null);
            }}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
          >
            ✨ Chuyển giao nhiệm kỳ mới
          </Button>
        </div>
      </div>

      {message && (
        <div
          role="status"
          className={`rounded-2xl border px-5 py-3.5 text-sm font-medium flex items-center justify-between shadow-xs ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-red-50 text-red-800 border-red-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <span>{message.type === 'success' ? '✓' : '⚠️'}</span>
            <span>{message.text}</span>
          </div>
          <button
            onClick={() => setMessage(null)}
            className="text-xs font-bold hover:underline opacity-70 hover:opacity-100"
          >
            Đóng
          </button>
        </div>
      )}

      {/* VIEW MODE: Nhiệm kỳ hiện tại (7 Cột) */}
      {viewMode === 'current' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-[#172554] flex items-center gap-2">
              <span>Sơ đồ 7 Ban nhiệm kỳ hiện tại</span>
              <span className="text-xs font-normal text-[#737686]">
                (Người đứng đầu mỗi ban là LT Ban được đánh dấu vương miện; Chủ tịch có 1 người duy nhất)
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => user?.chapterId && loadCurrentRoster(user.chapterId)}
              loading={rosterLoading}
            >
              🔄 Tải lại
            </Button>
          </div>

          {rosterLoading ? (
            <Card className="p-16 text-center text-[#737686]">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent mb-3" />
              <p className="font-semibold">Đang tải sơ đồ phân ban của Chapter...</p>
            </Card>
          ) : (
            <div className="overflow-x-auto pb-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4 min-w-[1050px]">
                {rosterData.map((ban, idx) => {
                  const isPresidentBan = ban.name === 'Chủ tịch';
                  return (
                    <div
                      key={ban.id || ban.name || idx}
                      className="bg-slate-50/70 border border-[#e2e8f0] rounded-2xl p-3 flex flex-col h-full shadow-xs"
                    >
                      {/* Cột Header */}
                      <div className="pb-3 mb-3 border-b border-[#e2e8f0] flex items-center justify-between">
                        <div className="font-bold text-xs text-[#172554] truncate" title={ban.name}>
                          {ban.name}
                        </div>
                        <span
                          className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full ${
                            isPresidentBan
                              ? 'bg-amber-100 text-amber-900 border border-amber-300'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {ban.total}
                        </span>
                      </div>

                      {/* Danh sách thành viên trong Ban */}
                      <div className="space-y-2.5 flex-1 overflow-y-auto max-h-[560px] pr-0.5">
                        {ban.members.map((member: any, mIdx: number) => {
                          const isLead = member.isLead;

                          return (
                            <div
                              key={member.userId || mIdx}
                              className={`rounded-xl p-2.5 text-xs transition relative ${
                                isPresidentBan
                                  ? 'bg-gradient-to-b from-amber-50 to-white border-2 border-amber-400 shadow-sm'
                                  : isLead
                                  ? 'bg-gradient-to-b from-amber-50/80 to-white border-2 border-amber-300 shadow-xs'
                                  : 'bg-white border border-[#eff4ff] hover:border-blue-200'
                              }`}
                            >
                              {/* Badge LT / Chủ tịch in màu khác */}
                              {isPresidentBan ? (
                                <div className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-amber-900 bg-amber-200/80 px-2 py-0.5 rounded-md mb-1.5 shadow-2xs">
                                  <span>⭐</span> Chủ tịch Chapter
                                </div>
                              ) : isLead ? (
                                <div className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md mb-1.5 border border-amber-200">
                                  <span>👑</span> Trưởng ban LT
                                </div>
                              ) : null}

                              <div className="font-bold text-[#172554] truncate text-[13px]">
                                {member.displayName}
                              </div>
                              <div className="text-[11px] text-[#737686] truncate mt-0.5" title={member.email}>
                                {member.email}
                              </div>
                            </div>
                          );
                        })}

                        {ban.members.length === 0 && (
                          <div className="text-center py-6 text-xs text-[#94a3b8] italic">
                            Chưa có thành viên
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW MODE: Lịch sử nhiệm kỳ (Yêu cầu 3c) */}
      {viewMode === 'history' && (
        <Card className="p-6 border border-[#eff4ff] space-y-6">
          <div className="flex items-center justify-between border-b border-[#eff4ff] pb-4">
            <div>
              <h2 className="text-lg font-bold text-[#172554]">Lịch sử các đợt chuyển giao nhiệm kỳ</h2>
              <p className="text-xs text-[#737686] mt-0.5">
                Xem lại danh sách nhân sự và cơ cấu Ban của các nhiệm kỳ trước
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => user?.chapterId && loadHistory(user.chapterId)}
              loading={historyLoading}
            >
              🔄 Tải lại
            </Button>
          </div>

          {historyLoading ? (
            <div className="text-center py-12 text-[#737686] font-medium">Đang tải lịch sử chuyển giao...</div>
          ) : historyList.length === 0 ? (
            <div className="text-center py-12 text-[#737686]">
              <div className="text-4xl mb-2">📜</div>
              <p className="font-semibold text-[#172554]">Chưa có lịch sử chuyển giao nào được ghi nhận</p>
              <p className="text-xs mt-1">Khi bạn thực hiện chuyển giao nhiệm kỳ mới, snapshot sẽ được lưu lại tại đây.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="divide-y divide-[#eff4ff] border border-[#eff4ff] rounded-2xl overflow-hidden">
                {historyList.map((batch: any, index: number) => {
                  const effectiveDate = new Date(batch.effective_at).toLocaleString('vi-VN');
                  const confirmedDate = batch.confirmed_at ? new Date(batch.confirmed_at).toLocaleString('vi-VN') : '—';
                  const isApplied = batch.status === 'APPLIED';

                  return (
                    <div
                      key={batch.id || index}
                      className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/70 transition"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                              isApplied
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                : 'bg-blue-100 text-blue-800 border border-blue-200'
                            }`}
                          >
                            {isApplied ? 'Đã áp dụng' : 'Đang lên lịch'}
                          </span>
                          <span className="font-bold text-sm text-[#172554]">
                            Nhiệm kỳ hiệu lực: {effectiveDate}
                          </span>
                        </div>
                        <p className="text-xs text-[#737686]">
                          Xác nhận ngày: {confirmedDate} • Quy mô: {batch.items?.length || 0} thành viên
                        </p>
                        {batch.source_url && (
                          <a
                            href={batch.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-blue-600 hover:underline block truncate max-w-lg"
                          >
                            Sheet nguồn: {batch.source_url}
                          </a>
                        )}
                      </div>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedHistoryTerm(batch)}
                      >
                        🔍 Xem snapshot 7 cột
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* MODAL: Xem snapshot 7 cột của nhiệm kỳ lịch sử */}
      {selectedHistoryTerm && (
        <Modal
          isOpen={Boolean(selectedHistoryTerm)}
          onClose={() => setSelectedHistoryTerm(null)}
          maxWidth="max-w-5xl"
        >
          <div className="space-y-4 p-2">
            <div className="flex items-center justify-between pb-3 border-b border-[#eff4ff]">
              <h2 className="text-lg font-bold text-[#172554]">
                Snapshot Phân Ban - Nhiệm kỳ {selectedHistoryTerm ? new Date(selectedHistoryTerm.effective_at).toLocaleDateString('vi-VN') : ''}
              </h2>
              <button
                type="button"
                onClick={() => setSelectedHistoryTerm(null)}
                className="text-[#737686] hover:text-[#172554] text-lg font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-[#737686]">
              Cơ cấu 7 ban đã được áp dụng trong đợt chuyển giao này ({selectedHistoryTerm.items?.length || 0} thành viên):
            </p>

            <div className="overflow-x-auto pb-4 max-h-[500px]">
              <div className="grid grid-cols-1 md:grid-cols-7 gap-3 min-w-[950px]">
                {[
                  'Chủ tịch',
                  'Ban Thành viên',
                  'Ban Thư ký',
                  'Ban khách mời',
                  'Ban TT&SK',
                  'Ban nội dung',
                  'Ban chất lượng',
                ].map((banName) => {
                  const banItems = (selectedHistoryTerm.items || []).filter(
                    (it: any) => it.departmentName === banName
                  );
                  const isPresidentBan = banName === 'Chủ tịch';

                  return (
                    <div key={banName} className="bg-slate-50 border border-[#e2e8f0] rounded-xl p-2.5">
                      <div className="font-bold text-xs text-[#172554] border-b border-[#e2e8f0] pb-1.5 mb-2 flex justify-between">
                        <span className="truncate">{banName}</span>
                        <span className="text-[11px] font-bold text-blue-700">{banItems.length}</span>
                      </div>
                      <div className="space-y-1.5">
                        {banItems.map((item: any, iIdx: number) => (
                          <div
                            key={item.id || iIdx}
                            className={`p-2 rounded-lg text-xs ${
                              isPresidentBan
                                ? 'bg-amber-100 border border-amber-300 font-bold'
                                : item.isLead
                                ? 'bg-amber-50 border border-amber-200 font-semibold'
                                : 'bg-white border border-[#eff4ff]'
                            }`}
                          >
                            {item.isLead && !isPresidentBan && (
                              <div className="text-[9px] font-bold text-amber-800 uppercase">👑 LT Ban</div>
                            )}
                            <div className="truncate text-[#172554]">{item.displayName}</div>
                            <div className="truncate text-[10px] text-[#737686]">{item.email}</div>
                          </div>
                        ))}
                        {banItems.length === 0 && (
                          <div className="text-center py-4 text-[11px] text-[#94a3b8] italic">Không có</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end pt-3 border-t border-[#eff4ff]">
              <Button onClick={() => setSelectedHistoryTerm(null)}>Đóng</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL: Chuyển giao nhiệm kỳ mới (Yêu cầu 3b) */}
      {showTransitionModal && (
        <Modal
          isOpen={showTransitionModal}
          onClose={() => setShowTransitionModal(false)}
          maxWidth="max-w-6xl"
        >
          <div className="space-y-6 p-2">
            <div className="flex items-center justify-between pb-3 border-b border-[#eff4ff]">
              <h2 className="text-xl font-bold text-[#172554]">
                Chuyển Giao Nhiệm Kỳ Mới từ Google Sheet
              </h2>
              <button
                type="button"
                onClick={() => setShowTransitionModal(false)}
                className="text-[#737686] hover:text-[#172554] text-lg font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>
            {/* Box hướng dẫn & Link mẫu */}
            <div className="p-4 bg-blue-50/60 rounded-2xl border border-blue-100 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-bold text-blue-900">
                  📋 Mẫu thành viên Google Sheet chuẩn:
                </span>
                <a
                  href={SAMPLE_SHEET_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-extrabold text-blue-600 hover:text-blue-800 underline inline-flex items-center gap-1"
                >
                  Mẫu thành viên chapter sau chuyển giao ↗
                </a>
              </div>
              <p className="text-xs text-[#596174] leading-relaxed">
                Google Sheet gồm đúng 7 cột: <strong>Chủ tịch, Ban thành viên, Ban thư ký, Ban khách mời, Ban TT&SK, Ban nội dung, Ban chất lượng</strong>.
                Người đứng đầu mỗi cột là <strong>LT của ban đó</strong> (Chủ tịch có 1 người duy nhất).
                Định dạng mỗi ô: <strong>Họ tên (email@gmail.com)</strong>.
              </p>
            </div>

            {/* Form nhập Sheet & ngày hiệu lực */}
            <form onSubmit={handleParseSheet} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#172554] mb-1">
                    Link Google Sheet danh sách nhiệm kỳ mới:
                  </label>
                  <input
                    required
                    type="url"
                    value={rosterUrl}
                    onChange={(e) => setRosterUrl(e.target.value)}
                    placeholder="Dán link Google Sheet..."
                    className="w-full rounded-xl border border-[#cbdbf5] px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  />
                </div>
                <div className="flex items-end">
                  <Button type="submit" loading={parsing} loadingText="Đang phân tích...">
                    🔍 Đọc và phân tích sheet
                  </Button>
                </div>
              </div>

              <div className="max-w-xs">
                <label className="block text-xs font-bold text-[#172554] mb-1">
                  Thời gian bắt đầu có hiệu lực *
                </label>
                <input
                  required
                  type="datetime-local"
                  value={effectiveAt}
                  onChange={(e) => setEffectiveAt(e.target.value)}
                  className="w-full rounded-xl border border-[#cbdbf5] px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
              </div>
            </form>

            {/* KẾT QUẢ PHÂN TÍCH */}
            {parsedResult && (
              <div className="space-y-6 pt-4 border-t border-[#eff4ff]">
                {/* Tóm tắt */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                    <div className="text-xl font-extrabold text-emerald-800">
                      {parsedResult.summary?.matchedInChapter || 0}
                    </div>
                    <div className="text-xs text-emerald-700 font-semibold mt-0.5">
                      Thành viên khớp Chapter
                    </div>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
                    <div className="text-xl font-extrabold text-blue-800">
                      {parsedResult.summary?.unmatchedSheetCount || 0}
                    </div>
                    <div className="text-xs text-blue-700 font-semibold mt-0.5">
                      Người trong sheet chưa có trong Chapter (Edge 1)
                    </div>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                    <div className="text-xl font-extrabold text-amber-800">
                      {parsedResult.summary?.unmatchedCurrentCount || 0}
                    </div>
                    <div className="text-xs text-amber-700 font-semibold mt-0.5">
                      Thành viên hiện tại thiếu trong sheet (Edge 2)
                    </div>
                  </div>
                </div>

                {/* 1. 7 Cột Nhiệm kỳ mới */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-[#172554] flex items-center gap-1.5">
                      <span>🏛️ 7 Cột Nhiệm kỳ mới</span>
                      <span className="text-xs font-normal text-[#737686]">
                        (Phân bổ theo sheet, người đầu in màu nổi bật là LT)
                      </span>
                    </h3>
                  </div>

                  <div className="overflow-x-auto pb-2">
                    <div className="grid grid-cols-1 md:grid-cols-7 gap-2.5 min-w-[900px]">
                      {parsedResult.matchedNewTerm?.map((col: any, cIdx: number) => {
                        const isPresidentBan = col.departmentName === 'Chủ tịch';
                        return (
                          <div key={cIdx} className="bg-slate-50 border border-[#e2e8f0] rounded-xl p-2.5 text-xs">
                            <div className="font-bold text-[#172554] border-b border-[#e2e8f0] pb-1.5 mb-2 flex justify-between items-center">
                              <span className="truncate">{col.departmentName}</span>
                              <span className="text-[10px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.2 rounded-full">
                                {col.total}
                              </span>
                            </div>

                            <div className="space-y-1.5">
                              {col.members.map((m: any, mIdx: number) => {
                                const isLead = m.isLead;
                                return (
                                  <div
                                    key={mIdx}
                                    className={`p-2 rounded-lg ${
                                      isPresidentBan
                                        ? 'bg-amber-100 border border-amber-300 font-bold'
                                        : isLead
                                        ? 'bg-amber-50 border border-amber-200 font-semibold'
                                        : 'bg-white border border-[#eff4ff]'
                                    }`}
                                  >
                                    {isLead && (
                                      <div className="text-[9px] font-bold text-amber-800 uppercase mb-0.5">
                                        {isPresidentBan ? '⭐ Chủ tịch' : '👑 LT Ban'}
                                      </div>
                                    )}
                                    <div className="truncate text-[#172554] font-medium">{m.displayName}</div>
                                    <div className="truncate text-[10px] text-[#737686]">{m.email}</div>
                                  </div>
                                );
                              })}

                              {col.members.length === 0 && (
                                <div className="text-center py-4 text-[10px] text-[#94a3b8] italic">
                                  Trống
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* 2. EDGE CASE 1: Người trong sheet chưa có trong Chapter */}
                {parsedResult.unmatchedSheetMembers?.length > 0 && (
                  <div className="space-y-2.5 border-t border-[#eff4ff] pt-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-blue-900 flex items-center gap-1.5">
                        <span>ℹ️ Thành viên có trong Sheet nhưng chưa thuộc Chapter ({parsedResult.unmatchedSheetMembers.length})</span>
                      </h3>
                      <span className="text-xs text-[#737686]">Cần mời hoặc tạo tài khoản bổ sung</span>
                    </div>

                    <div className="border border-blue-200 rounded-xl overflow-hidden bg-white max-h-56 overflow-y-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-blue-50/80 border-b border-blue-200 text-blue-900 font-bold sticky top-0">
                          <tr>
                            <th className="py-2.5 px-4">Họ và tên</th>
                            <th className="py-2.5 px-4">Gmail</th>
                            <th className="py-2.5 px-4">Ban trong sheet</th>
                            <th className="py-2.5 px-4 text-center">Vai trò dự kiến</th>
                            <th className="py-2.5 px-4 text-center">Trạng thái</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#eff4ff]">
                          {parsedResult.unmatchedSheetMembers.map((item: any, idx: number) => (
                            <tr key={idx} className="hover:bg-blue-50/30">
                              <td className="py-2 px-4 font-semibold text-[#172554]">{item.displayName}</td>
                              <td className="py-2 px-4 text-[#737686]">{item.email}</td>
                              <td className="py-2 px-4 font-medium text-blue-700">{item.departmentName}</td>
                              <td className="py-2 px-4 text-center">
                                {item.isLead ? (
                                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold text-[10px]">
                                    👑 LT
                                  </span>
                                ) : (
                                  <span className="text-[#737686]">Thành viên</span>
                                )}
                              </td>
                              <td className="py-2 px-4 text-center">
                                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium text-[10px]">
                                  Chưa có trong Chapter
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 3. EDGE CASE 2: Thành viên Chapter hiện tại không có trong sheet */}
                {parsedResult.unmatchedCurrentMembers?.length > 0 && (
                  <div className="space-y-2.5 border-t border-[#eff4ff] pt-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-red-700 flex items-center gap-1.5">
                          <span>⚠️ Thành viên Chapter không có tên trong sheet ({parsedResult.unmatchedCurrentMembers.length})</span>
                        </h3>
                        <p className="text-xs text-[#737686]">
                          Những người này có thể không tiếp tục đồng hành trong nhiệm kỳ mới
                        </p>
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="bg-red-50 text-red-700 border-red-300 hover:bg-red-100 font-bold"
                        onClick={() => setShowConfirmDeactivate(true)}
                      >
                        ⛔ Vô hiệu hóa tất cả ({parsedResult.unmatchedCurrentMembers.length})
                      </Button>
                    </div>

                    <div className="border border-red-200 rounded-xl overflow-hidden bg-white max-h-56 overflow-y-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-red-50/70 border-b border-red-200 text-red-900 font-bold sticky top-0">
                          <tr>
                            <th className="py-2.5 px-4">Thành viên</th>
                            <th className="py-2.5 px-4">Email</th>
                            <th className="py-2.5 px-4">Ban hiện tại</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#eff4ff]">
                          {parsedResult.unmatchedCurrentMembers.map((item: any, idx: number) => (
                            <tr key={idx} className="hover:bg-red-50/20">
                              <td className="py-2 px-4 font-semibold text-[#172554]">{item.displayName}</td>
                              <td className="py-2 px-4 text-[#737686]">{item.email}</td>
                              <td className="py-2 px-4 font-medium text-slate-700">{item.currentDepartmentName}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Nút hành động Xác nhận chuyển giao */}
                <div className="flex justify-between items-center pt-4 border-t border-[#eff4ff]">
                  <Button variant="outline" onClick={() => setShowTransitionModal(false)}>
                    Hủy bỏ
                  </Button>
                  <Button
                    loading={scheduling}
                    loadingText="Đang xử lý..."
                    onClick={handleConfirmTransition}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                  >
                    🚀 Xác nhận chuyển giao nhiệm kỳ
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* MODAL CẢNH BÁO XÁC NHẬN VÔ HIỆU HÓA TẤT CẢ (Edge case 2) */}
      {showConfirmDeactivate && (
        <Modal
          isOpen={showConfirmDeactivate}
          onClose={() => setShowConfirmDeactivate(false)}
          maxWidth="max-w-md"
        >
          <div className="space-y-4 p-2">
            <div className="flex items-center justify-between pb-2 border-b border-[#eff4ff]">
              <h2 className="text-base font-bold text-red-700">
                Xác nhận vô hiệu hóa tất cả
              </h2>
              <button
                type="button"
                onClick={() => setShowConfirmDeactivate(false)}
                className="text-[#737686] hover:text-[#172554] text-base font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>
            <div className="p-3 bg-red-50 text-red-900 rounded-xl border border-red-200 text-xs leading-relaxed">
              ⚠️ <strong>Cảnh báo:</strong> Thao tác này sẽ chuyển trạng thái của{' '}
              <strong>{parsedResult?.unmatchedCurrentMembers?.length || 0} thành viên</strong> sang{' '}
              <strong>Ngưng hoạt động (INACTIVE)</strong> và kết thúc tư cách Ban của họ trong Chapter này.
            </div>
            <p className="text-xs text-[#596174]">
              Họ sẽ không tham gia vào các phép tính hoàn thành khóa học và xếp hạng của nhiệm kỳ mới. Bạn có chắc chắn muốn thực hiện?
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-[#eff4ff]">
              <Button variant="outline" onClick={() => setShowConfirmDeactivate(false)}>
                Hủy
              </Button>
              <Button
                variant="primary"
                loading={deactivating}
                loadingText="Đang vô hiệu hóa..."
                className="bg-red-600 hover:bg-red-700 text-white font-bold"
                onClick={handleBulkDeactivate}
              >
                Vô hiệu hóa tất cả
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
