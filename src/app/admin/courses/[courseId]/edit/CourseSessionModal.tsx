'use client';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import type { CourseEditorState } from './useCourseEditor';

type Props = Pick<CourseEditorState,
  'showSessionModal' |
  'setShowSessionModal' |
  'sessionModalMode' |
  'sessionForm' |
  'setSessionForm' |
  'sessionSaving' |
  'handleSaveSession'
>;

export default function CourseSessionModal({
  showSessionModal,
  setShowSessionModal,
  sessionModalMode,
  sessionForm,
  setSessionForm,
  sessionSaving,
  handleSaveSession
}: Props) {
  return (
    <Modal
          isOpen={showSessionModal}
          onClose={() => setShowSessionModal(false)}
          maxWidth="max-w-md"
        >
          <div className="p-6 space-y-4">
            <h3 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              {sessionModalMode === 'create' ? 'Thêm buổi học mới' : 'Chỉnh sửa buổi học'}
            </h3>
            <div>
              <label className="block text-sm font-semibold text-[#172554] mb-1.5">Tiêu đề buổi học *</label>
              <input
                type="text"
                required
                value={sessionForm.title}
                onChange={(e) => setSessionForm({ ...sessionForm, title: e.target.value })}
                placeholder="Ví dụ: Buổi 1 — Tổng quan kiến thức BBE"
                className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-[#172554] mb-1.5">Mô tả buổi học</label>
              <textarea
                rows={3}
                value={sessionForm.description}
                onChange={(e) => setSessionForm({ ...sessionForm, description: e.target.value })}
                placeholder="Mô tả tóm tắt nội dung buổi học này (tùy chọn)"
                className="w-full px-4 py-2 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setShowSessionModal(false)}>
                Hủy
              </Button>
              <Button
                loading={sessionSaving}
                loadingText={sessionModalMode === 'create' ? 'Đang thêm...' : 'Đang lưu...'}
                onClick={handleSaveSession}
              >
                {sessionModalMode === 'create' ? 'Thêm buổi học' : 'Lưu thay đổi'}
              </Button>
            </div>
          </div>
        </Modal>
  );
}
