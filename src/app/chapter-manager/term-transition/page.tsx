'use client';

import Button from '@/components/ui/Button';
import Toast from '@/components/ui/Toast';
import useTermTransition from './useTermTransition';
import CurrentRoster from './CurrentRoster';
import ScheduledTransfer from './ScheduledTransfer';
import TransferDraft from './TransferDraft';
import TransferHistory from './TransferHistory';
import TransferConfirmations from './TransferConfirmations';

export default function ChapterManagerTermTransitionPage() {
  const state = useTermTransition();
  const {
    handleOpenCurrent,
    handleOpenHistory,
    mounted,
    scheduledBatch,
    scrollToImport,
    setToast,
    toast,
    user,
    viewMode,
  } = state;

  return (
    <div className="space-y-8 max-w-7xl pb-20">
      <Toast toast={toast} onClose={() => setToast(null)} />

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
          {!scheduledBatch ? (
            <Button
              variant="primary"
              onClick={scrollToImport}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            >
              📥 Nạp Google Sheet nhiệm kỳ mới
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 text-[#2563EB] rounded-xl text-xs font-bold border border-blue-200">
              📅 Đã có 1 đợt chuyển giao lên lịch
            </span>
          )}
        </div>
      </div>

      {/* VIEW MODE: Nhiệm kỳ hiện tại (8 Cột rộng rãi + Cuộn ngang) */}
      {viewMode === 'current' && (
        <div className="space-y-6">
          <CurrentRoster {...state} />
          {/* ĐỢT CHUYỂN GIAO NHIỆM KỲ ĐÃ LÊN LỊCH (ĐẶT DƯỚI THÀNH VIÊN CHƯA CÓ BAN) */}
          <ScheduledTransfer {...state} />
          {/* ═══════════════════════════════════════════════════════════════════
              KHU VỰC NHẬP GOOGLE SHEET CHUYỂN GIAO NHIỆM KỲ MỚI (NẰM PHÍA DƯỚI)
              CHỈ HIỂN THỊ KHI CHƯA CÓ ĐỢT CHUYỂN GIAO NÀO ĐANG LÊN LỊCH
             ═══════════════════════════════════════════════════════════════════ */}
          <TransferDraft {...state} />
        </div>
      )}

      <TransferHistory {...state} />
      <TransferConfirmations {...state} />
    </div>
  );
}
