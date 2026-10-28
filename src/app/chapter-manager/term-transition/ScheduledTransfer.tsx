'use client';

import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { formatTermBadge } from './term-format';
import TermTransitionCountdown from './TermTransitionCountdown';
import type { TermTransitionState } from './useTermTransition';

type Props = Pick<
  TermTransitionState,
  'applyingBatch'
  | 'cancelingBatch'
  | 'handleAutoApplyScheduled'
  | 'scheduledBatch'
  | 'setShowApplyBatchModal'
  | 'setShowCancelBatchModal'
>;

export default function ScheduledTransfer({
  applyingBatch,
  cancelingBatch,
  handleAutoApplyScheduled,
  scheduledBatch,
  setShowApplyBatchModal,
  setShowCancelBatchModal,
}: Props) {
  return (
    <>
          {scheduledBatch && (
            <Card className="p-5 border-2 border-blue-300 bg-gradient-to-r from-blue-50/50 via-white to-blue-50/30 rounded-2xl shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-blue-100 pb-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-100 text-[#2563EB] rounded-full text-xs font-bold">
                      <span>📅</span> Đợt chuyển giao {scheduledBatch.termNumber ? formatTermBadge(scheduledBatch.termNumber) : 'nhiệm kỳ tiếp theo'} (Đã lên lịch)
                    </span>
                    <TermTransitionCountdown
                      targetDate={scheduledBatch.effectiveAt}
                      onExpire={handleAutoApplyScheduled}
                    />
                  </div>
                  <h3 className="text-lg font-bold text-[#172554]">
                    Dự kiến hiệu lực lúc: {new Date(scheduledBatch.effectiveAt).toLocaleString('vi-VN')}
                  </h3>
                  <p className="text-xs text-[#737686] mt-0.5">
                    Tổng cộng <strong>{scheduledBatch.totalItems}</strong> thành viên được xếp vào 7 Ban. Hệ thống sẽ tự động chuyển giao khi đến giờ hẹn.
                  </p>
                  {scheduledBatch.lastError && <p role="alert" className="text-xs text-red-700">Chưa áp dụng thành công: {scheduledBatch.lastError}. Bản nhập vẫn được giữ; có thể thử áp dụng lại hoặc hủy lịch.</p>}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => setShowApplyBatchModal(true)}
                    loading={applyingBatch}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                  >
                    ⚡ Áp dụng ngay bây giờ
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowCancelBatchModal(true)}
                    loading={cancelingBatch}
                    className="text-red-600 border-red-200 hover:bg-red-50"
                  >
                    ✕ Hủy lịch này
                  </Button>
                </div>
              </div>

              {/* Sơ đồ 8 cột dự kiến */}
              <div className="overflow-x-auto pb-2">
                <div className="grid grid-cols-8 gap-3 min-w-[1900px]">
                  {scheduledBatch.newTerm?.map((col: any, cIdx: number) => {
                    const isPresidentBan = col.departmentName === 'Chủ Tịch';
                    return (
                      <div key={cIdx} className="bg-white border border-blue-200 rounded-xl p-3 text-xs min-w-[230px] shadow-2xs">
                        <div className="font-bold text-[#172554] border-b border-blue-100 pb-2 mb-2 flex justify-between items-center">
                          <span>{col.departmentName}</span>
                          <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                            {col.total}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {col.members.map((m: any, mIdx: number) => (
                            <div
                              key={mIdx}
                              className={`p-2.5 rounded-lg ${
                                isPresidentBan
                                  ? 'bg-amber-100 border border-amber-300 font-bold'
                                  : m.isLead
                                  ? 'bg-amber-50 border border-amber-200 font-semibold'
                                  : 'bg-slate-50 border border-slate-100'
                              }`}
                            >
                              {m.isLead && (
                                <div className="text-[9px] font-extrabold text-amber-800 uppercase mb-1">
                                  {isPresidentBan ? '⭐ Chủ tịch' : '👑 Trưởng ban'}
                                </div>
                              )}
                              <div className="truncate text-[#172554] font-semibold">{m.displayName}</div>
                              <div className="truncate text-[10px] text-[#737686]">{m.email}</div>
                            </div>
                          ))}
                          {col.members.length === 0 && (
                            <div className="text-center py-4 text-[11px] text-slate-400 italic">Trống</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Bảng thành viên Chapter không có tên trong nhiệm kỳ tiếp theo */}
              {scheduledBatch.unmatchedCurrentMembers && scheduledBatch.unmatchedCurrentMembers.length > 0 && (
                <div className="pt-4 border-t border-blue-200/80 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <h4 className="text-xs font-extrabold text-amber-900 uppercase tracking-wide flex items-center gap-1.5">
                      <span>⚠️</span> Thành viên Chapter không có tên trong nhiệm kỳ tiếp theo ({scheduledBatch.unmatchedCurrentMembers.length})
                    </h4>
                    <span className="text-[11px] text-[#737686]">
                      (Sau khi chuyển giao, các thành viên này sẽ chuyển về trạng thái Chưa phân Ban)
                    </span>
                  </div>

                  <div className="border border-amber-200 rounded-xl overflow-hidden bg-white max-h-56 overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 border-b-2 border-slate-300 text-slate-900 font-extrabold text-[11px] uppercase tracking-wider sticky top-0">
                        <tr>
                          <th className="py-2.5 px-4">Họ và tên</th>
                          <th className="py-2.5 px-4">Email</th>
                          <th className="py-2.5 px-4">Ban hiện tại</th>
                          <th className="py-2.5 px-4 text-right">Chi tiết</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-100/60">
                        {scheduledBatch.unmatchedCurrentMembers.map((m: any) => (
                          <tr key={m.userId} className="hover:bg-amber-50/20">
                            <td className="py-2 px-4 font-semibold text-[#172554]">
                              <Link
                                href={`/chapter-manager/members/${m.userId}`}
                                className="hover:text-[#2563EB]"
                              >
                                {m.displayName}
                              </Link>
                            </td>
                            <td className="py-2 px-4 text-[#737686]">{m.email}</td>
                            <td className="py-2 px-4 font-medium text-slate-700">{m.currentDepartmentName}</td>
                            <td className="py-2 px-4 text-right">
                              <Link
                                href={`/chapter-manager/members/${m.userId}`}
                                className="text-blue-600 hover:underline font-semibold"
                              >
                                Chi tiết →
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Card>
          )}

    </>
  );
}
