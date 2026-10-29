'use client';

import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { describeWindow, formatVietnamDate, windowOf } from '@/lib/transfer-windows';
import { formatTermBadge, SAMPLE_SHEET_URL } from './term-format';
import type { TermTransitionState } from './useTermTransition';

type Props = Pick<
  TermTransitionState,
  'currentTermNumber'
  | 'deactivatingUserId'
  | 'effectiveAt'
  | 'handleConfirmTransition'
  | 'handleParseSheet'
  | 'importSectionRef'
  | 'message'
  | 'parsedResult'
  | 'parsing'
  | 'rosterUrl'
  | 'scheduledBatch'
  | 'scheduling'
  | 'selectedTermNumber'
  | 'setDeactivateText'
  | 'setEffectiveAt'
  | 'setMessage'
  | 'setParsedResult'
  | 'setRosterUrl'
  | 'setSelectedTermNumber'
  | 'setShowConfirmDeactivate'
  | 'setSingleDeactivateModal'
  | 'termOptions'
  | 'user'
>;

function transferWindowPreview(value: string) {
  if (!value) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  const window = windowOf(at);
  return {
    label: describeWindow(window),
    anchor: formatVietnamDate(window.anchor),
  };
}

export default function TransferDraft({
  currentTermNumber,
  deactivatingUserId,
  effectiveAt,
  handleConfirmTransition,
  handleParseSheet,
  importSectionRef,
  message,
  parsedResult,
  parsing,
  rosterUrl,
  scheduledBatch,
  scheduling,
  selectedTermNumber,
  setDeactivateText,
  setEffectiveAt,
  setMessage,
  setParsedResult,
  setRosterUrl,
  setSelectedTermNumber,
  setShowConfirmDeactivate,
  setSingleDeactivateModal,
  termOptions,
  user,
}: Props) {
  const windowPreview = transferWindowPreview(effectiveAt);

  return (
    <>
          {!scheduledBatch && (
            <div
              id="import-sheet-section"
              ref={importSectionRef}
              className="pt-8 border-t-2 border-slate-200 space-y-6"
            >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-md border border-blue-100">
                  Bước chuẩn bị chuyển giao
                </span>
                <h2 className="text-xl font-bold text-[#172554] mt-1">
                  📥 Nhập Dữ Liệu Nhiệm Kỳ Mới từ Google Sheet
                </h2>
                <p className="text-xs text-[#737686] mt-0.5">
                  Đọc danh sách phân ban từ Google Sheet, xem trước 8 cột nhiệm kỳ mới và đối soát nhân sự trước khi áp dụng.
                </p>
              </div>

              <a
                href={SAMPLE_SHEET_URL}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-bold text-blue-600 hover:text-blue-800 underline inline-flex items-center gap-1 self-start sm:self-auto"
              >
                📋 Xem Sheet mẫu chuẩn ↗
              </a>
            </div>

            {/* Hướng dẫn & Nhắc nhở làm mới */}
            <div className="p-4 bg-blue-50/70 rounded-2xl border border-blue-200/80 space-y-2">
              <p className="text-xs text-blue-950 font-semibold">
                Google Sheet gồm đúng 8 cột: <strong>Chủ Tịch, Ban Định Hướng, Ban Thành Viên, Ban Thư Ký, Ban Khách Mời, Ban TT&SK, Ban Nội Dung, Ban Chất Lượng</strong>.
                Người đứng đầu mỗi cột là <strong>LT của ban đó</strong> (Chủ Tịch có 1 người duy nhất). Định dạng mỗi ô: <strong>Họ tên (email@gmail.com)</strong>.
              </p>
              <p className="text-xs text-blue-800 bg-blue-100/70 px-3 py-1.5 rounded-lg border border-blue-200 inline-block">
                💡 <strong>Lưu ý:</strong> Nếu bạn vừa sửa dữ liệu trên Google Sheet, vui lòng bấm nút <strong>"🔍 Đọc và phân tích sheet"</strong> để hệ thống làm mới bản dự kiến mới nhất!
              </p>
            </div>

            {/* Thông báo kết quả / lỗi chuyển giao ngay tại khu vực thao tác */}
            {message && (
              <div
                className={`p-4 rounded-xl text-sm font-medium flex items-center justify-between border shadow-xs ${
                  message.type === 'success'
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                    : 'bg-red-50 text-red-900 border-red-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base">{message.type === 'success' ? '✅' : '⚠️'}</span>
                  <span>{message.text}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMessage(null)}
                  className="text-xs font-bold text-slate-500 hover:text-slate-800 ml-4 px-2 py-1 rounded"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Form nhập Sheet & ngày hiệu lực */}
            <Card className="p-5 border border-[#eff4ff] shadow-sm">
              <form onSubmit={handleParseSheet} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                  <div>
                    <label className="block text-xs font-bold text-[#172554] mb-1">
                      Đường dẫn Google Sheet danh sách nhiệm kỳ mới:
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
                  <div className="flex items-end gap-2">
                    <Button type="submit" loading={parsing} loadingText="Đang phân tích...">
                      🔍 Đọc và phân tích sheet
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
                  <div>
                    <label className="block text-xs font-bold text-[#172554] mb-1">
                      Nhiệm kỳ chuyển giao *
                    </label>
                    <select
                      required
                      value={selectedTermNumber}
                      onChange={(e) => setSelectedTermNumber(e.target.value ? Number(e.target.value) : '')}
                      className="w-full rounded-xl border border-[#cbdbf5] px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] bg-white font-medium text-[#172554]"
                    >
                      <option value="">-- Chọn số thứ tự nhiệm kỳ --</option>
                      {termOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-[#737686] mt-1">
                      {currentTermNumber
                        ? `Nhiệm kỳ hiện tại: ${formatTermBadge(currentTermNumber)} (Chỉ được chọn lớn hơn)`
                        : 'Chọn số nhiệm kỳ cho đợt chuyển giao này'}
                    </p>
                  </div>

                  <div>
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
                    <p className="text-[11px] text-[#737686] mt-1">
                      {windowPreview ? (
                        <>
                          Thời điểm này thuộc giai đoạn <strong className="text-[#172554]">{windowPreview.label}</strong>;
                          mốc thưởng của giai đoạn là <strong className="text-[#172554]">{windowPreview.anchor}</strong>.
                        </>
                      ) : (
                        'Chọn thời điểm để xem giai đoạn chuyển giao tương ứng.'
                      )}
                    </p>
                    <p className="text-[11px] text-[#737686] mt-1">
                      Nếu đặt ngày hiện tại, hệ thống sẽ áp dụng và đổi Ban cho Chapter ngay lập tức.
                    </p>
                  </div>
                </div>
              </form>
            </Card>

            {/* KẾT QUẢ PHÂN TÍCH (XEM TRƯỚC 7 CỘT VÀ 2 BẢNG ĐỐI SOÁT) */}
            {parsedResult && (
              <div className="space-y-6 pt-4 border-t border-[#eff4ff]">
                {/* 3 Thẻ Tóm tắt */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 text-center">
                    <div className="text-2xl font-extrabold text-emerald-800">
                      {parsedResult.summary?.matchedInChapter || 0}
                    </div>
                    <div className="text-xs text-emerald-700 font-semibold mt-0.5">
                      Thành viên khớp Chapter
                    </div>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 text-center">
                    <div className="text-2xl font-extrabold text-blue-800">
                      {parsedResult.summary?.unmatchedSheetCount || 0}
                    </div>
                    <div className="text-xs text-blue-700 font-semibold mt-0.5">
                      Thành viên có trong Sheet nhưng chưa thuộc Chapter
                    </div>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-center">
                    <div className="text-2xl font-extrabold text-amber-800">
                      {parsedResult.summary?.unmatchedCurrentCount || 0}
                    </div>
                    <div className="text-xs text-amber-700 font-semibold mt-0.5">
                      Thành viên Chapter không có tên trong sheet
                    </div>
                  </div>
                </div>

                {/* 1. SƠ ĐỒ DỰ KIẾN: 8 Cột Nhiệm kỳ mới */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold text-[#172554] flex items-center gap-1.5">
                      <span>🏛️ 8 Cột Nhiệm kỳ mới dự kiến</span>
                      <span className="text-xs font-normal text-[#737686]">
                        (Phân bổ theo sheet, người đầu in nổi bật là LT / Chủ tịch)
                      </span>
                    </h3>
                  </div>

                  <div className="overflow-x-auto pb-4">
                    <div className="grid grid-cols-8 gap-3 min-w-[1900px]">
                      {parsedResult.matchedNewTerm?.map((col: any, cIdx: number) => {
                        const isPresidentBan = col.departmentName === 'Chủ Tịch';
                        return (
                          <div key={cIdx} className="bg-slate-50 border border-[#e2e8f0] rounded-xl p-3 text-xs min-w-[230px]">
                            <div className="font-bold text-[#172554] border-b border-[#e2e8f0] pb-2 mb-2.5 flex justify-between items-center">
                              <span className="truncate">{col.departmentName}</span>
                              <span className="text-[10px] font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                                {col.total}
                              </span>
                            </div>

                            <div className="space-y-2">
                              {col.members.map((m: any, mIdx: number) => {
                                const isLead = m.isLead;
                                return (
                                  <div
                                    key={mIdx}
                                    className={`p-2.5 rounded-lg ${
                                      isPresidentBan
                                        ? 'bg-amber-100 border border-amber-300 font-bold'
                                        : isLead
                                        ? 'bg-amber-50 border border-amber-200 font-semibold'
                                        : 'bg-white border border-[#eff4ff]'
                                    }`}
                                  >
                                    {isLead && (
                                      <div className="text-[9px] font-bold text-amber-800 uppercase mb-1">
                                        {isPresidentBan ? '⭐ Chủ tịch' : '👑 Trưởng ban'}
                                      </div>
                                    )}
                                    {m.userId ? (
                                      <Link
                                        href={`/chapter-manager/members/${m.userId}`}
                                        className="truncate text-[#172554] hover:text-[#2563EB] font-semibold block"
                                      >
                                        {m.displayName}
                                      </Link>
                                    ) : (
                                      <div className="truncate text-[#172554] font-medium">{m.displayName}</div>
                                    )}
                                    <div className="truncate text-[10px] text-[#737686]">{m.email}</div>
                                  </div>
                                );
                              })}

                              {col.members.length === 0 && (
                                <div className="text-center py-6 text-[11px] text-[#94a3b8] italic">
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

                {/* 2. BẢNG 1: Thành viên có trong Sheet nhưng chưa thuộc Chapter */}
                {parsedResult.unmatchedSheetMembers?.length > 0 && (
                  <div className="space-y-2.5 border-t border-[#eff4ff] pt-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-blue-900 flex items-center gap-1.5">
                        <span>ℹ️ Thành viên có trong Sheet nhưng chưa thuộc Chapter ({parsedResult.unmatchedSheetMembers.length})</span>
                      </h3>
                      <span className="text-xs text-[#737686]">Cần mời hoặc tạo tài khoản vào Chapter để được xếp ban</span>
                    </div>

                    <div className="border border-blue-200 rounded-xl overflow-hidden bg-white max-h-60 overflow-y-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 border-b-2 border-slate-300 text-slate-900 font-extrabold text-[11px] uppercase tracking-wider sticky top-0">
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
                                    👑 Trưởng ban
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

                {/* 3. BẢNG 2: Thành viên Chapter không có tên trong sheet */}
                {parsedResult.unmatchedCurrentMembers?.length > 0 && (
                  <div className="space-y-2.5 border-t border-[#eff4ff] pt-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-red-700 flex items-center gap-1.5">
                          <span>⚠️ Thành viên Chapter không có tên trong sheet ({parsedResult.unmatchedCurrentMembers.length})</span>
                        </h3>
                        <p className="text-xs text-[#737686]">
                          Những thành viên này sẽ mất ban sau chuyển giao. Bạn có thể vô hiệu hóa tất cả hoặc vô hiệu hóa từng người.
                        </p>
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="bg-red-50 text-red-700 border-red-300 hover:bg-red-100 font-bold"
                        onClick={() => {
                          setDeactivateText('');
                          setShowConfirmDeactivate(true);
                        }}
                      >
                        ⛔ Vô hiệu hóa tất cả ({parsedResult.unmatchedCurrentMembers.length})
                      </Button>
                    </div>

                    <div className="border border-red-200 rounded-xl overflow-hidden bg-white max-h-60 overflow-y-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 border-b-2 border-slate-300 text-slate-900 font-extrabold text-[11px] uppercase tracking-wider sticky top-0">
                          <tr>
                            <th className="py-2.5 px-4">Họ và tên</th>
                            <th className="py-2.5 px-4">Email</th>
                            <th className="py-2.5 px-4">Ban hiện tại</th>
                            <th className="py-2.5 px-4 text-right">Thao tác</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#eff4ff]">
                          {parsedResult.unmatchedCurrentMembers.map((item: any, idx: number) => (
                            <tr key={idx} className="hover:bg-red-50/20">
                              <td className="py-2 px-4 font-semibold text-[#172554]">
                                <Link
                                  href={`/chapter-manager/members/${item.userId}`}
                                  className="hover:text-[#2563EB]"
                                >
                                  {item.displayName}
                                </Link>
                              </td>
                              <td className="py-2 px-4 text-[#737686]">{item.email}</td>
                              <td className="py-2 px-4 font-medium text-slate-700">{item.currentDepartmentName}</td>
                              <td className="py-2 px-4 text-right">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-700 bg-red-50 hover:bg-red-100 border-red-200 font-bold text-xs py-1 px-2.5"
                                  loading={deactivatingUserId === item.userId}
                                  onClick={() => {
                                    setDeactivateText('');
                                    setSingleDeactivateModal({ userId: item.userId, displayName: item.displayName });
                                  }}
                                >
                                  ⛔ Vô hiệu hóa
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Hàng nút Hành động Xác nhận chuyển giao */}
                <div className="flex flex-col sm:flex-row justify-between items-center gap-3 pt-4 border-t border-[#eff4ff]">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setParsedResult(null);
                        if (typeof window !== 'undefined' && user?.chapterId) {
                          localStorage.removeItem(`bbe_term_transition_draft_${user.chapterId}`);
                        }
                      }}
                      className="text-slate-600 hover:text-red-600"
                    >
                      ✕ Đóng và xóa bản nháp
                    </Button>
                  </div>
                  <Button
                    loading={scheduling}
                    loadingText="Đang xử lý chuyển giao..."
                    onClick={handleConfirmTransition}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                  >
                    🚀 Xác nhận chuyển giao nhiệm kỳ
                  </Button>
                </div>
              </div>
            )}
          </div>
          )}
    </>
  );
}
