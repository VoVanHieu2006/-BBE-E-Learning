'use client';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { parseDurationInput } from '@/lib/validation/duration';
import type { CourseEditorState } from './useCourseEditor';

type Props = Pick<CourseEditorState,
  'showLessonModal' |
  'closeLessonModal' |
  'editingLessonId' |
  'lessonForm' |
  'handleYtIdChange' |
  'durationFetchError' |
  'fetchingDuration' |
  'isVideoVerified' |
  'videoPreviewTitle' |
  'parseYouTubeId' |
  'durationWarning' |
  'setLessonForm' |
  'lessonSaving' |
  'handleSaveLesson'
>;

export default function CourseLessonModal({
  showLessonModal,
  closeLessonModal,
  editingLessonId,
  lessonForm,
  handleYtIdChange,
  durationFetchError,
  fetchingDuration,
  isVideoVerified,
  videoPreviewTitle,
  parseYouTubeId,
  durationWarning,
  setLessonForm,
  lessonSaving,
  handleSaveLesson
}: Props) {
  return (
    <Modal
          isOpen={Boolean(showLessonModal)}
          onClose={closeLessonModal}
          maxWidth="max-w-lg"
        >
          <div className="p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-[#eff4ff] pb-3">
              <h3 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                {editingLessonId ? 'Chỉnh sửa bài học' : 'Thêm bài học & Video YouTube'}
              </h3>
              <button onClick={closeLessonModal} className="text-[#737686] hover:text-[#172554] text-xl font-bold p-1 rounded-lg hover:bg-slate-100 transition">
                ✕
              </button>
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#172554] mb-1">
                Link YouTube hoặc Video ID (11 ký tự) *
              </label>
              <input
                type="text"
                required
                value={lessonForm.youtubeVideoId}
                onChange={(e) => handleYtIdChange(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=... hoặc dQw4w9WgXcQ"
                className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] ${
                  durationFetchError ? 'border-red-400 bg-red-50' : 'border-[#cbdbf5]'
                }`}
              />
              {fetchingDuration && (
                <p className="text-xs text-[#2563EB] mt-1.5 flex items-center gap-1.5">
                  <span className="inline-block animate-spin">⏳</span> Đang tự động nhận diện video và thời lượng...
                </p>
              )}
              {durationFetchError && (
                <p className="text-xs text-red-600 mt-1.5 font-medium">⚠️ {durationFetchError}</p>
              )}
              {isVideoVerified && videoPreviewTitle && (
                <div
                  className={`mt-2.5 p-3 rounded-2xl flex items-center gap-3 border ${
                    lessonForm.durationKnown ? 'bg-emerald-50 border-emerald-200' : 'bg-[#f8f9ff] border-[#cbdbf5]'
                  }`}
                >
                  <img
                    src={`https://i.ytimg.com/vi/${parseYouTubeId(lessonForm.youtubeVideoId)}/hqdefault.jpg`}
                    alt="Thumbnail"
                    className="w-20 h-12 object-cover rounded-xl shrink-0 shadow-sm"
                  />
                  <div className="overflow-hidden flex-1">
                    <p className="text-xs font-bold text-[#172554] truncate">{videoPreviewTitle}</p>
                    {lessonForm.durationKnown ? (
                      <p className="text-xs text-emerald-700 font-semibold mt-0.5">
                        ✓ Tự động nhận diện: {lessonForm.durationFormatted || `${lessonForm.durationSeconds} giây`}
                      </p>
                    ) : (
                      <p className="text-xs text-[#737686] font-semibold mt-0.5">
                        Chưa xác định được thời lượng — cần nhập thủ công
                      </p>
                    )}
                  </div>
                </div>
              )}

              {isVideoVerified && !lessonForm.durationKnown && (
                <div className="mt-2.5 p-3 bg-amber-50 border border-amber-200 rounded-2xl space-y-2">
                  <p className="text-xs text-amber-800 font-semibold">⚠️ {durationWarning}</p>
                  <div>
                    <label className="block text-xs font-semibold text-[#172554] mb-1">
                      Thời lượng video * (mm:ss hoặc tổng số giây)
                    </label>
                    <input
                      type="text"
                      value={lessonForm.manualDuration}
                      onChange={(e) => setLessonForm((prev) => ({ ...prev, manualDuration: e.target.value }))}
                      placeholder="Ví dụ: 20:15 hoặc 1215"
                      className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                    />
                    {lessonForm.manualDuration.trim() !== '' && parseDurationInput(lessonForm.manualDuration) === null && (
                      <p className="text-xs text-red-600 mt-1.5 font-medium">
                        Định dạng chưa hợp lệ. Nhập mm:ss (vd 20:15) hoặc tổng số giây (vd 1215).
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#172554] mb-1">Tiêu đề bài học *</label>
              <input
                type="text"
                required
                value={lessonForm.title}
                onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })}
                placeholder="Ví dụ: Bài 1.1: Giới thiệu văn hóa BBE"
                className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#172554] mb-1">Mô tả bài học</label>
              <textarea
                rows={3}
                value={lessonForm.description}
                onChange={(e) => setLessonForm({ ...lessonForm, description: e.target.value })}
                placeholder="Mô tả nội dung bài học (tùy chọn)"
                className="w-full px-4 py-2 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-[#eff4ff]">
              <Button variant="outline" onClick={closeLessonModal}>
                Hủy
              </Button>
              <Button
                loading={lessonSaving}
                loadingText={editingLessonId ? 'Đang lưu...' : 'Đang tạo...'}
                disabled={
                  !isVideoVerified ||
                  fetchingDuration ||
                  (!lessonForm.durationKnown && parseDurationInput(lessonForm.manualDuration) === null)
                }
                onClick={handleSaveLesson}
              >
                {editingLessonId ? 'Lưu thay đổi' : 'Tạo bài học'}
              </Button>
            </div>
          </div>
        </Modal>
  );
}
