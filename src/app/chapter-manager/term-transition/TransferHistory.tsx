'use client';

import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { ORDERED_CHAPTER_ROSTER } from '@/lib/departments';
import { formatTermBadge } from './term-format';
import type { TermTransitionState } from './useTermTransition';

type Props = Pick<
  TermTransitionState,
  'historyList'
  | 'historyLoading'
  | 'loadHistory'
  | 'notify'
  | 'selectedHistoryTerm'
  | 'setSelectedHistoryTerm'
  | 'user'
  | 'viewMode'
>;

function validDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** APPLIED rows show the business transfer time; scheduled rows show their effective time. */
function termMoment(term: any) {
  const effectiveAt = validDate(term.effectiveAt);
  const appliedAt = validDate(term.appliedAt);
  const actualAt = validDate(term.actualTransferAt) || (term.status === 'APPLIED' ? appliedAt : null);
  const isApplied = term.status === 'APPLIED';
  const shownAt = isApplied ? actualAt || effectiveAt : effectiveAt || appliedAt;
  const late = Boolean(isApplied && actualAt && appliedAt && appliedAt.getTime() - actualAt.getTime() > 60_000);
  return { effectiveAt, appliedAt, actualAt, isApplied, shownAt, late };
}

export default function TransferHistory({
  historyList,
  historyLoading,
  loadHistory,
  notify,
  selectedHistoryTerm,
  setSelectedHistoryTerm,
  user,
  viewMode,
}: Props) {
  return (
    <>
      {/* VIEW MODE: Lịch sử nhiệm kỳ */}
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
              onClick={() => {
                if (user?.chapterId) {
                  loadHistory(user.chapterId, true);
                  notify('success', 'Đang tải lại lịch sử chuyển giao nhiệm kỳ...');
                }
              }}
              loading={historyLoading}
              loadingText="Đang tải lại..."
              disabled={historyLoading}
            >
              🔄 Tải lại
            </Button>
          </div>

          {historyLoading ? (
            <div className="text-center py-12 text-[#737686]">Đang tải lịch sử nhiệm kỳ...</div>
          ) : historyList.length === 0 ? (
            <div className="text-center py-12 text-[#737686] italic">
              Chưa có lịch sử đợt chuyển giao nhiệm kỳ nào được lưu lại.
            </div>
          ) : (
            <div className="divide-y divide-[#eff4ff]">
              {historyList.map((term: any) => {
                const { appliedAt, actualAt, isApplied, shownAt, late } = termMoment(term);
                const dateStr = shownAt ? shownAt.toLocaleString('vi-VN') : 'Chưa xác định';
                const totalCount = term.itemCount ?? term.items?.length ?? 0;
                const termTitle = term.termNumber
                  ? `Sơ đồ 7 Ban ${formatTermBadge(term.termNumber)}`
                  : 'Sơ đồ 7 Ban nhiệm kỳ chuyển giao';

                return (
                  <div
                    key={term.id}
                    className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#f8f9ff] px-3 rounded-xl transition"
                  >
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-[#172554] text-sm">
                          {termTitle}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isApplied
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {isApplied ? 'Đã áp dụng' : 'Đã lên lịch'}
                        </span>
                      </div>
                      {term.last_error && <p role="alert" className="mt-2 text-xs text-red-700">Chưa áp dụng được (lần {term.apply_attempts}): {term.last_error}. Hệ thống sẽ retry; có thể bấm áp dụng lại.</p>}
                      <div className="text-xs text-[#737686] mt-1 space-y-0.5">
                        <p>
                          <span className="font-medium text-slate-700">
                            {isApplied ? 'Thời gian chuyển giao thực tế:' : 'Có hiệu lực:'}
                          </span>{' '}
                          {dateStr}
                        </p>
                        {isApplied && actualAt && appliedAt && (
                          <p>
                            <span className="font-medium text-slate-700">Thực tế áp dụng:</span> {appliedAt.toLocaleString('vi-VN')}
                            {late && <span className="text-amber-700"> · Hệ thống áp dụng trễ so với giờ hẹn</span>}
                          </p>
                        )}
                        <p>
                          <span className="font-medium text-slate-700">Tổng nhân sự phân ban:</span> <strong>{totalCount}</strong> thành viên
                          {term.sourceUrl && (
                            <span>
                              {' · '}
                              <a
                                href={term.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-600 underline"
                              >
                                Nguồn Google Sheet
                              </a>
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    <Button size="sm" variant="outline" onClick={() => setSelectedHistoryTerm(term)}>
                      👁️ Xem cơ cấu
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* MODAL CHI TIẾT LỊCH SỬ MỘT NHIỆM KỲ */}
      {selectedHistoryTerm && (
        <Modal
          isOpen={Boolean(selectedHistoryTerm)}
          onClose={() => setSelectedHistoryTerm(null)}
          maxWidth="max-w-6xl"
        >
          <div className="space-y-4 p-2">
            <div className="flex items-center justify-between border-b border-[#eff4ff] pb-3">
              <div>
                <h3 className="text-lg font-bold text-[#172554]">
                  {selectedHistoryTerm.termNumber
                    ? `Cơ cấu nhân sự ${formatTermBadge(selectedHistoryTerm.termNumber)}`
                    : 'Cơ cấu nhân sự nhiệm kỳ'}
                  {termMoment(selectedHistoryTerm).shownAt
                    ? ` (${termMoment(selectedHistoryTerm).shownAt!.toLocaleDateString('vi-VN')})`
                    : ''}
                </h3>
                <p className="text-xs text-[#737686]">
                  Tổng {selectedHistoryTerm.itemCount ?? selectedHistoryTerm.items?.length ?? 0} thành viên được phân bổ
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedHistoryTerm(null)}
                className="text-[#737686] hover:text-[#172554] text-lg font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>

            <div className="overflow-x-auto pb-4 max-h-[500px]">
              <div className="grid grid-cols-8 gap-3 min-w-[1900px]">
                {ORDERED_CHAPTER_ROSTER.map((banName) => {
                  const banItems = (selectedHistoryTerm.items || []).filter(
                    (it: any) => it.departmentName === banName
                  );
                  const isPresidentBan = banName === 'Chủ Tịch';

                  return (
                    <div key={banName} className="bg-slate-50 border border-[#e2e8f0] rounded-xl p-2.5 min-w-[230px]">
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
                              <div className="text-[9px] font-bold text-amber-800 uppercase">👑 Trưởng ban</div>
                            )}
                            {item.userId ? (
                              <Link
                                href={`/chapter-manager/members/${item.userId}`}
                                className="truncate text-[#172554] hover:text-[#2563EB] block font-semibold"
                              >
                                {item.displayName}
                              </Link>
                            ) : (
                              <div className="truncate text-[#172554]">{item.displayName}</div>
                            )}
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

    </>
  );
}
