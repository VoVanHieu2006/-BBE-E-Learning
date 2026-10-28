'use client';

import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { formatTermBadge } from './term-format';
import type { TermTransitionState } from './useTermTransition';

type Props = Pick<
  TermTransitionState,
  'actionLoading'
  | 'availableDepartments'
  | 'changeDeptModal'
  | 'deactivatingUserId'
  | 'displayTermNumber'
  | 'handleAppointLead'
  | 'loadCurrentRoster'
  | 'notify'
  | 'rosterData'
  | 'rosterLoading'
  | 'selectedDeptId'
  | 'setChangeDeptModal'
  | 'setDeactivateText'
  | 'setMakeLead'
  | 'setSelectedDeptId'
  | 'setShowBulkUnassignedModal'
  | 'setSingleDeactivateModal'
  | 'unassignedMembers'
  | 'user'
>;

export default function CurrentRoster({
  actionLoading,
  availableDepartments,
  changeDeptModal,
  deactivatingUserId,
  displayTermNumber,
  handleAppointLead,
  loadCurrentRoster,
  notify,
  rosterData,
  rosterLoading,
  selectedDeptId,
  setChangeDeptModal,
  setDeactivateText,
  setMakeLead,
  setSelectedDeptId,
  setShowBulkUnassignedModal,
  setSingleDeactivateModal,
  unassignedMembers,
  user,
}: Props) {
  return (
    <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-[#172554] flex items-center gap-2 flex-wrap">
                {displayTermNumber ? (
                  <>
                    <span>🏛️ Sơ đồ Phân ban Chapter</span>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-blue-100 text-[#2563EB] text-xs font-bold border border-blue-200">
                      {formatTermBadge(displayTermNumber)}
                    </span>
                  </>
                ) : (
                  <span>🏛️ Sơ đồ Phân ban nhiệm kỳ hiện tại</span>
                )}
              </h2>
              <p className="text-xs text-[#737686] mt-0.5">
                Người đứng đầu mỗi Ban là Trưởng ban. Bấm vào thành viên để xem chi tiết hoặc đổi Ban. Bảng cuộn ngang ↔ để xem đủ 8 cột.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (user?.chapterId) {
                  loadCurrentRoster(user.chapterId, true);
                  notify('success', 'Đang tải lại sơ đồ và đồng bộ trạng thái mới nhất...');
                }
              }}
              loading={rosterLoading}
              loadingText="Đang tải lại sơ đồ..."
              disabled={rosterLoading}
            >
              🔄 Tải lại sơ đồ
            </Button>
          </div>

          {rosterLoading ? (
            <Card className="p-16 text-center text-[#737686]">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent mb-3" />
              <p className="font-semibold">Đang tải sơ đồ phân ban của Chapter...</p>
            </Card>
          ) : (
            <div className="relative">
              {/* Lớp phủ làm mờ mượt mà khi đang xử lý bổ nhiệm / đổi ban */}
              {actionLoading && (
                <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] z-20 flex flex-col items-center justify-center rounded-2xl transition-all">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-3 border-blue-600 border-t-transparent mb-2" />
                  <span className="text-xs font-bold text-slate-800 bg-white/95 px-3.5 py-1.5 rounded-full shadow-md border border-slate-200">
                    {actionLoading.type === 'appoint'
                      ? '👑 Đang bổ nhiệm Trưởng ban...'
                      : actionLoading.type === 'saveDept'
                      ? '⚙️ Đang lưu thông tin phân Ban...'
                      : actionLoading.type === 'applyScheduled'
                      ? '⚡ Đang áp dụng chuyển giao nhiệm kỳ...'
                      : 'Đang xử lý...'}
                  </span>
                </div>
              )}

              <div className={`overflow-x-auto pb-4 ${actionLoading ? 'pointer-events-none opacity-50' : ''}`}>
                <div className="grid grid-cols-8 gap-3.5 min-w-[1900px]">
                {rosterData.map((ban, idx) => {
                  const isPresidentBan = ban.name === 'Chủ Tịch';
                  return (
                    <div
                      key={ban.id || ban.name || idx}
                      className="bg-slate-50/70 border border-[#e2e8f0] rounded-2xl p-3.5 flex flex-col h-full shadow-xs min-w-[230px]"
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

                      {/* Danh sách thành viên trong Ban (Không cuộn riêng lẻ từng cột) */}
                      <div className="space-y-2.5 flex-1 pr-0.5">
                        {ban.members.map((member: any, mIdx: number) => {
                          const isLead = member.isLead;

                          return (
                            <div
                              key={member.userId || mIdx}
                              className={`rounded-xl p-3 text-xs transition relative group ${
                                isPresidentBan
                                  ? 'bg-gradient-to-b from-amber-50 to-white border-2 border-amber-400 shadow-sm'
                                  : isLead
                                  ? 'bg-gradient-to-b from-amber-50/80 to-white border-2 border-amber-300 shadow-xs'
                                  : 'bg-white border border-[#eff4ff] hover:border-blue-300'
                              }`}
                            >
                              {/* Badge Chức vụ */}
                              {isPresidentBan ? (
                                <div className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-amber-900 bg-amber-200/80 px-2 py-0.5 rounded-md mb-1.5 shadow-2xs">
                                  <span>⭐</span> Chủ tịch Chapter
                                </div>
                              ) : isLead ? (
                                <div className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md mb-1.5 border border-amber-200">
                                  <span>👑</span> Trưởng ban
                                </div>
                              ) : null}

                              {/* Click vào tên để xem chi tiết */}
                              <Link
                                href={`/chapter-manager/members/${member.userId}`}
                                className="font-bold text-[#172554] hover:text-[#2563EB] block text-[13px] transition break-words"
                                title="Bấm để xem chi tiết thành viên"
                              >
                                {member.displayName}
                              </Link>
                              <div className="text-[11px] text-[#737686] truncate mt-0.5" title={member.email}>
                                {member.email}
                              </div>

                              {/* Nút hành động */}
                              <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                                {!isLead && !isPresidentBan && ban.id ? (
                                  <button
                                    type="button"
                                    disabled={Boolean(actionLoading)}
                                    onClick={() => handleAppointLead(member.userId, member.displayName, ban.id!, ban.name)}
                                    className="text-amber-700 hover:text-amber-900 font-bold flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                                    title="Bổ nhiệm làm Trưởng ban"
                                  >
                                    {actionLoading?.type === 'appoint' && actionLoading.id === member.userId ? (
                                      <>
                                        <div className="animate-spin rounded-full h-3 w-3 border-2 border-amber-700 border-t-transparent" />
                                        <span>Đang bổ nhiệm...</span>
                                      </>
                                    ) : (
                                      <>
                                        <span>👑</span> Bổ nhiệm LT
                                      </>
                                    )}
                                  </button>
                                ) : (
                                  <span className="text-[10px] text-amber-800 font-bold">{isPresidentBan ? '⭐ Lãnh đạo' : '👑 Trưởng ban'}</span>
                                )}
                                <button
                                  type="button"
                                  disabled={Boolean(actionLoading)}
                                  onClick={() => {
                                    setChangeDeptModal({
                                      userId: member.userId,
                                      displayName: member.displayName,
                                      currentDeptName: ban.name,
                                    });
                                    setSelectedDeptId(ban.id || '');
                                    setMakeLead(member.isLead);
                                  }}
                                  className="text-slate-500 hover:text-[#2563EB] font-semibold flex items-center gap-0.5 ml-auto disabled:opacity-40 disabled:cursor-not-allowed"
                                  title="Chuyển sang ban khác"
                                >
                                  ⚙️ Đổi ban
                                </button>
                              </div>
                            </div>
                          );
                        })}

                        {ban.members.length === 0 && (
                          <div className="text-center py-8 text-xs text-[#94a3b8] italic">
                            Chưa có thành viên
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

          {/* KHU VỰC THÀNH VIÊN CHƯA CÓ BAN (ĐẶT NGAY DƯỚI SƠ ĐỒ NHIỆM KỲ HIỆN TẠI ĐỂ DỄ THAO TÁC) */}
          <Card className="border border-amber-200 bg-amber-50/20 p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-amber-200/60 pb-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-amber-900 flex items-center gap-1.5">
                  <span>⚠️ Thành viên chưa có Ban ({unassignedMembers.length})</span>
                </h3>
                <p className="text-xs text-[#737686] mt-0.5">
                  Các thành viên thuộc Chapter nhưng chưa phân ban (bao gồm thành viên không có trong sheet sau khi chuyển giao). Bạn có thể gán Ban hoặc vô hiệu hóa tài khoản.
                </p>
              </div>

              {unassignedMembers.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="bg-red-50 text-red-700 hover:bg-red-100 border-red-300 font-bold text-xs shrink-0 self-start sm:self-auto"
                  onClick={() => {
                    setDeactivateText('');
                    setShowBulkUnassignedModal(true);
                  }}
                >
                  ⛔ Vô hiệu hóa tất cả ({unassignedMembers.length})
                </Button>
              )}
            </div>

            {unassignedMembers.length === 0 ? (
              <p className="text-xs text-[#737686] italic py-2">
                Tất cả thành viên trong Chapter đã được phân vào các Ban đầy đủ.
              </p>
            ) : (
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-left text-xs bg-white rounded-xl border border-amber-200/80 overflow-hidden">
                  <thead className="bg-slate-100 border-b-2 border-slate-300 text-slate-900 font-extrabold text-[11px] uppercase tracking-wider sticky top-0">
                    <tr>
                      <th className="py-2.5 px-4">Thành viên</th>
                      <th className="py-2.5 px-4">Email</th>
                      <th className="py-2.5 px-4 text-center">Gán vào Ban</th>
                      <th className="py-2.5 px-4 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {unassignedMembers.map((m) => (
                      <tr key={m.userId} className="hover:bg-amber-50/30 transition">
                        <td className="py-2.5 px-4">
                          <Link
                            href={`/chapter-manager/members/${m.userId}`}
                            className="font-semibold text-[#172554] hover:text-[#2563EB]"
                          >
                            {m.displayName}
                          </Link>
                        </td>
                        <td className="py-2.5 px-4 text-[#737686]">{m.email}</td>
                        <td className="py-2.5 px-4 text-center">
                          <select
                            value={changeDeptModal?.userId === m.userId ? selectedDeptId : ''}
                            disabled={Boolean(actionLoading)}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val) {
                                setSelectedDeptId(val);
                                setChangeDeptModal({
                                  userId: m.userId,
                                  displayName: m.displayName,
                                });
                                const deptObj = availableDepartments.find((d: any) => d.id === val);
                                setMakeLead(deptObj?.name === 'Chủ Tịch');
                              }
                            }}
                            className="text-xs border border-[#cbdbf5] rounded-lg px-2.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-[#2563EB] disabled:opacity-50"
                          >
                            <option value="">➕ Chọn ban để gán...</option>
                            {availableDepartments.map((d: any) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={`/chapter-manager/members/${m.userId}`}
                              className="text-blue-600 hover:underline font-semibold"
                            >
                              Chi tiết
                            </Link>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-700 bg-red-50 hover:bg-red-100 border-red-200 font-semibold text-xs py-1 px-2.5"
                              loading={deactivatingUserId === m.userId}
                              onClick={() => {
                                setDeactivateText('');
                                setSingleDeactivateModal({ userId: m.userId, displayName: m.displayName });
                              }}
                            >
                              ⛔ Vô hiệu hóa
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

    </>
  );
}
