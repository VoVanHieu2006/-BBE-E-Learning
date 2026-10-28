'use client';

import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import type { TermTransitionState } from './useTermTransition';

type Props = Pick<
  TermTransitionState,
  'applyingBatch'
  | 'availableDepartments'
  | 'cancelingBatch'
  | 'changeDeptModal'
  | 'deactivateText'
  | 'deactivating'
  | 'deactivatingUserId'
  | 'handleApplyScheduledBatch'
  | 'handleBulkDeactivate'
  | 'handleBulkDeactivateUnassigned'
  | 'handleCancelScheduledBatch'
  | 'handleIndividualDeactivate'
  | 'handleSaveDepartment'
  | 'makeLead'
  | 'parsedResult'
  | 'savingDept'
  | 'scheduledBatch'
  | 'selectedDeptId'
  | 'setChangeDeptModal'
  | 'setDeactivateText'
  | 'setMakeLead'
  | 'setSelectedDeptId'
  | 'setShowApplyBatchModal'
  | 'setShowBulkUnassignedModal'
  | 'setShowCancelBatchModal'
  | 'setShowConfirmDeactivate'
  | 'setSingleDeactivateModal'
  | 'showApplyBatchModal'
  | 'showBulkUnassignedModal'
  | 'showCancelBatchModal'
  | 'showConfirmDeactivate'
  | 'singleDeactivateModal'
  | 'unassignedMembers'
>;

export default function TransferConfirmations({
  applyingBatch,
  availableDepartments,
  cancelingBatch,
  changeDeptModal,
  deactivateText,
  deactivating,
  deactivatingUserId,
  handleApplyScheduledBatch,
  handleBulkDeactivate,
  handleBulkDeactivateUnassigned,
  handleCancelScheduledBatch,
  handleIndividualDeactivate,
  handleSaveDepartment,
  makeLead,
  parsedResult,
  savingDept,
  scheduledBatch,
  selectedDeptId,
  setChangeDeptModal,
  setDeactivateText,
  setMakeLead,
  setSelectedDeptId,
  setShowApplyBatchModal,
  setShowBulkUnassignedModal,
  setShowCancelBatchModal,
  setShowConfirmDeactivate,
  setSingleDeactivateModal,
  showApplyBatchModal,
  showBulkUnassignedModal,
  showCancelBatchModal,
  showConfirmDeactivate,
  singleDeactivateModal,
  unassignedMembers,
}: Props) {
  return (
    <>
      {/* MODAL ĐỔI BAN CHO THÀNH VIÊN */}
      {changeDeptModal && (
        <Modal
          isOpen={Boolean(changeDeptModal)}
          onClose={() => {
            if (!savingDept) {
              setChangeDeptModal(null);
              setSelectedDeptId('');
              setMakeLead(false);
            }
          }}
          maxWidth="max-w-md"
        >
          <div className="space-y-4 p-2">
            <div className="flex items-center justify-between pb-2 border-b border-[#eff4ff]">
              <h3 className="text-base font-bold text-[#172554]">
                Phân Ban cho: {changeDeptModal.displayName}
              </h3>
              {!savingDept && (
                <button
                  type="button"
                  onClick={() => {
                    setChangeDeptModal(null);
                    setSelectedDeptId('');
                    setMakeLead(false);
                  }}
                  className="text-[#737686] hover:text-[#172554] text-base font-bold px-2 py-1"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="space-y-3">
              <p className="text-xs text-[#596174]">
                Ban hiện tại:{' '}
                <strong>{changeDeptModal.currentDeptName || 'Chưa phân Ban'}</strong>
              </p>

              <div>
                <label className="block text-xs font-bold text-[#172554] mb-1">
                  Chọn Ban mới:
                </label>
                <select
                  disabled={savingDept}
                  value={selectedDeptId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedDeptId(id);
                    const deptObj = availableDepartments.find((d: any) => d.id === id);
                    if (deptObj?.name === 'Chủ Tịch') {
                      setMakeLead(true);
                    }
                  }}
                  className="w-full rounded-xl border border-[#cbdbf5] px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] bg-white font-medium disabled:opacity-50"
                >
                  <option value="">⚠️ Đưa về trạng thái Chưa phân Ban</option>
                  {availableDepartments.map((d: any) => (
                    <option key={d.id} value={d.id}>
                      🏢 {d.name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedDeptId && (
                <div className="pt-2">
                  {availableDepartments.find((d: any) => d.id === selectedDeptId)?.name === 'Chủ Tịch' ? (
                    <div className="bg-amber-100/90 p-2.5 rounded-xl border border-amber-300 text-xs text-amber-900 font-semibold flex items-center gap-2">
                      <span>⭐</span>
                      <span>Ban Chủ Tịch chỉ có 1 người duy nhất. Thành viên này sẽ trở thành Chủ tịch mới của Chapter.</span>
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 text-xs font-semibold text-slate-800 cursor-pointer bg-amber-50/80 p-2.5 rounded-xl border border-amber-200">
                      <input
                        type="checkbox"
                        checked={makeLead}
                        disabled={savingDept}
                        onChange={(e) => setMakeLead(e.target.checked)}
                        className="rounded text-amber-600 focus:ring-amber-500 w-4 h-4 cursor-pointer"
                      />
                      <span>👑 Bổ nhiệm làm Trưởng ban của Ban này</span>
                    </label>
                  )}
                  {availableDepartments.find((d: any) => d.id === selectedDeptId)?.name !== 'Chủ Tịch' && (
                    <p className="text-[11px] text-slate-500 mt-1 pl-6">
                      (Nếu được chọn, thành viên sẽ trở thành Trưởng ban mới, thay thế Trưởng ban cũ của ban đó)
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-[#eff4ff]">
              <Button
                variant="outline"
                size="sm"
                disabled={savingDept}
                onClick={() => {
                  setChangeDeptModal(null);
                  setSelectedDeptId('');
                  setMakeLead(false);
                }}
              >
                Hủy
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={savingDept}
                disabled={savingDept}
                onClick={handleSaveDepartment}
              >
                Lưu thay đổi
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL CẢNH BÁO XÁC NHẬN VÔ HIỆU HÓA TẤT CẢ (TRONG SHEET DỰ KIẾN) */}
      {showConfirmDeactivate && (
        <Modal
          isOpen={showConfirmDeactivate}
          onClose={() => {
            setShowConfirmDeactivate(false);
            setDeactivateText('');
          }}
          maxWidth="max-w-md"
        >
          <div className="space-y-4 p-2">
            <div className="flex items-center justify-between pb-2 border-b border-[#eff4ff]">
              <h2 className="text-base font-bold text-red-700">
                Xác nhận vô hiệu hóa tất cả
              </h2>
              <button
                type="button"
                onClick={() => {
                  setShowConfirmDeactivate(false);
                  setDeactivateText('');
                }}
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
              Họ sẽ không thể đăng nhập học và không tham gia vào các phép tính hoàn thành khóa học của nhiệm kỳ mới. Bạn có chắc chắn muốn thực hiện?
            </p>

            <div className="p-3 bg-red-50/80 border border-red-200 rounded-xl space-y-1.5">
              <label className="block text-xs font-semibold text-red-950">
                Để xác nhận, vui lòng nhập chính xác chữ <strong className="text-red-600 underline font-extrabold">&ldquo;vô hiệu hóa&rdquo;</strong> vào ô bên dưới:
              </label>
              <input
                type="text"
                value={deactivateText}
                onChange={(e) => setDeactivateText(e.target.value)}
                placeholder="vô hiệu hóa"
                className="w-full px-3 py-2 text-xs border border-red-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#eff4ff]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowConfirmDeactivate(false);
                  setDeactivateText('');
                }}
              >
                Hủy
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={deactivating}
                loadingText="Đang vô hiệu hóa..."
                disabled={
                  deactivating ||
                  deactivateText.trim().toLowerCase() !== 'vô hiệu hóa'
                }
                className="bg-red-600 hover:bg-red-700 text-white font-bold"
                onClick={handleBulkDeactivate}
              >
                Vô hiệu hóa tất cả
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL CẢNH BÁO XÁC NHẬN VÔ HIỆU HÓA 1 THÀNH VIÊN RIÊNG LẺ */}
      {singleDeactivateModal && (
        <Modal
          isOpen={Boolean(singleDeactivateModal)}
          onClose={() => {
            setSingleDeactivateModal(null);
            setDeactivateText('');
          }}
          maxWidth="max-w-md"
        >
          <div className="space-y-4 p-2">
            <div className="flex items-center justify-between pb-2 border-b border-[#eff4ff]">
              <h2 className="text-base font-bold text-red-700">
                Xác nhận vô hiệu hóa thành viên
              </h2>
              <button
                type="button"
                onClick={() => {
                  setSingleDeactivateModal(null);
                  setDeactivateText('');
                }}
                className="text-[#737686] hover:text-[#172554] text-base font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>
            <div className="p-3 bg-red-50 text-red-900 rounded-xl border border-red-200 text-xs leading-relaxed space-y-1">
              <p>
                ⚠️ <strong>Cảnh báo:</strong> Bạn đang thao tác vô hiệu hóa tài khoản của{' '}
                <strong>{singleDeactivateModal.displayName}</strong>.
              </p>
              <p className="text-red-700">
                Tài khoản này sẽ bị chặn đăng nhập và ngừng toàn bộ quyền truy cập học tập trên hệ thống BBE.
              </p>
            </div>

            <div className="p-3 bg-red-50/80 border border-red-200 rounded-xl space-y-1.5">
              <label className="block text-xs font-semibold text-red-950">
                Để xác nhận, vui lòng nhập chính xác chữ <strong className="text-red-600 underline font-extrabold">&ldquo;vô hiệu hóa&rdquo;</strong> vào ô bên dưới:
              </label>
              <input
                type="text"
                value={deactivateText}
                onChange={(e) => setDeactivateText(e.target.value)}
                placeholder="vô hiệu hóa"
                className="w-full px-3 py-2 text-xs border border-red-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#eff4ff]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSingleDeactivateModal(null);
                  setDeactivateText('');
                }}
              >
                Hủy
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={deactivatingUserId === singleDeactivateModal.userId}
                loadingText="Đang xử lý..."
                disabled={
                  Boolean(deactivatingUserId) ||
                  deactivateText.trim().toLowerCase() !== 'vô hiệu hóa'
                }
                className="bg-red-600 hover:bg-red-700 text-white font-bold"
                onClick={() =>
                  handleIndividualDeactivate(
                    singleDeactivateModal.userId,
                    singleDeactivateModal.displayName
                  )
                }
              >
                Xác nhận vô hiệu hóa
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL CẢNH BÁO XÁC NHẬN VÔ HIỆU HÓA TẤT CẢ THÀNH VIÊN CHƯA CÓ BAN */}
      {showBulkUnassignedModal && (
        <Modal
          isOpen={showBulkUnassignedModal}
          onClose={() => {
            setShowBulkUnassignedModal(false);
            setDeactivateText('');
          }}
          maxWidth="max-w-md"
        >
          <div className="space-y-4 p-2">
            <div className="flex items-center justify-between pb-2 border-b border-[#eff4ff]">
              <h2 className="text-base font-bold text-red-700">
                Xác nhận vô hiệu hóa tất cả thành viên chưa có Ban
              </h2>
              <button
                type="button"
                onClick={() => {
                  setShowBulkUnassignedModal(false);
                  setDeactivateText('');
                }}
                className="text-[#737686] hover:text-[#172554] text-base font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>
            <div className="p-3 bg-red-50 text-red-900 rounded-xl border border-red-200 text-xs leading-relaxed space-y-1">
              <p>
                ⚠️ <strong>Cảnh báo:</strong> Thao tác này sẽ vô hiệu hóa toàn bộ{' '}
                <strong>{unassignedMembers.length} thành viên</strong> chưa có Ban trong danh sách.
              </p>
              <p className="text-red-700">
                Tất cả tài khoản này sẽ bị chuyển sang trạng thái <strong>Ngưng hoạt động (INACTIVE)</strong>, chặn đăng nhập học tập và kết thúc vai trò trong Chapter.
              </p>
            </div>

            <div className="p-3 bg-red-50/80 border border-red-200 rounded-xl space-y-1.5">
              <label className="block text-xs font-semibold text-red-950">
                Để xác nhận, vui lòng nhập chính xác chữ <strong className="text-red-600 underline font-extrabold">&ldquo;vô hiệu hóa&rdquo;</strong> vào ô bên dưới:
              </label>
              <input
                type="text"
                value={deactivateText}
                onChange={(e) => setDeactivateText(e.target.value)}
                placeholder="vô hiệu hóa"
                className="w-full px-3 py-2 text-xs border border-red-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#eff4ff]">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowBulkUnassignedModal(false);
                  setDeactivateText('');
                }}
              >
                Hủy
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={deactivating}
                loadingText="Đang vô hiệu hóa..."
                disabled={
                  deactivating ||
                  deactivateText.trim().toLowerCase() !== 'vô hiệu hóa'
                }
                className="bg-red-600 hover:bg-red-700 text-white font-bold"
                onClick={handleBulkDeactivateUnassigned}
              >
                Vô hiệu hóa tất cả ({unassignedMembers.length})
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL CẢNH BÁO XÁC NHẬN ÁP DỤNG NGAY CHUYỂN GIAO ĐÃ LÊN LỊCH */}
      {showApplyBatchModal && scheduledBatch && (
        <Modal
          isOpen={showApplyBatchModal}
          onClose={() => setShowApplyBatchModal(false)}
          maxWidth="max-w-md"
        >
          <div className="space-y-4 p-2">
            <div className="flex items-center justify-between pb-2 border-b border-[#eff4ff]">
              <h2 className="text-base font-bold text-[#172554] flex items-center gap-2">
                <span>⚡</span> Xác nhận áp dụng chuyển giao ngay?
              </h2>
              <button
                type="button"
                onClick={() => setShowApplyBatchModal(false)}
                className="text-[#737686] hover:text-[#172554] text-base font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>
            <div className="p-3.5 bg-amber-50 text-amber-900 rounded-xl border border-amber-200 text-xs leading-relaxed space-y-1.5">
              <p className="font-bold text-amber-950">
                ⚠️ Cảnh báo áp dụng trước thời hạn:
              </p>
              <p>
                Đợt chuyển giao nhiệm kỳ này đang được lên lịch hiệu lực vào lúc{' '}
                <strong>{new Date(scheduledBatch.effectiveAt).toLocaleString('vi-VN')}</strong>.
              </p>
              <p>
                Nếu bạn chọn <strong>&ldquo;Áp dụng ngay&rdquo;</strong>, toàn bộ sơ đồ 7 Ban, các phân công Trưởng ban (LT) và nhân sự của <strong>{scheduledBatch.totalItems} thành viên</strong> sẽ được áp dụng trực tiếp vào hệ thống ngay lúc này mà không cần chờ đến lịch hẹn.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-[#eff4ff]">
              <Button
                variant="outline"
                size="sm"
                disabled={applyingBatch}
                onClick={() => setShowApplyBatchModal(false)}
              >
                Hủy bỏ
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={applyingBatch}
                loadingText="Đang áp dụng..."
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                onClick={() => handleApplyScheduledBatch(scheduledBatch.id)}
              >
                ⚡ Xác nhận áp dụng ngay
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL CẢNH BÁO XÁC NHẬN HỦY ĐỢT CHUYỂN GIAO ĐÃ LÊN LỊCH */}
      {showCancelBatchModal && scheduledBatch && (
        <Modal
          isOpen={showCancelBatchModal}
          onClose={() => setShowCancelBatchModal(false)}
          maxWidth="max-w-md"
        >
          <div className="space-y-4 p-2">
            <div className="flex items-center justify-between pb-2 border-b border-[#eff4ff]">
              <h2 className="text-base font-bold text-red-700 flex items-center gap-2">
                <span>⚠️</span> Xác nhận hủy đợt chuyển giao?
              </h2>
              <button
                type="button"
                onClick={() => setShowCancelBatchModal(false)}
                className="text-[#737686] hover:text-[#172554] text-base font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>
            <div className="p-3.5 bg-red-50 text-red-900 rounded-xl border border-red-200 text-xs leading-relaxed space-y-1.5">
              <p className="font-bold text-red-950">
                ⚠️ Cảnh báo hủy chuyển giao đã lên lịch:
              </p>
              <p>
                Đợt chuyển giao nhiệm kỳ (hiệu lực {new Date(scheduledBatch.effectiveAt).toLocaleString('vi-VN')}) gồm <strong>{scheduledBatch.totalItems} thành viên</strong> sẽ bị hủy bỏ hoàn toàn khỏi hệ thống.
              </p>
              <p className="text-red-700 font-medium">
                Sau khi hủy, khu vực nạp Google Sheet sẽ hiển thị lại để bạn có thể tải lên và lên lịch đợt mới khi cần.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-[#eff4ff]">
              <Button
                variant="outline"
                size="sm"
                disabled={cancelingBatch}
                onClick={() => setShowCancelBatchModal(false)}
              >
                Giữ lại lịch
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={cancelingBatch}
                loadingText="Đang hủy..."
                className="bg-red-600 hover:bg-red-700 text-white font-bold"
                onClick={() => handleCancelScheduledBatch(scheduledBatch.id)}
              >
                ✕ Xác nhận hủy lịch
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
