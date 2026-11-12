'use client';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Toast from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import { useCourseEditor } from './useCourseEditor';
import CourseInfo from './CourseInfo';
import FinalAssessmentSummary from './FinalAssessmentSummary';
import CourseOutline from './CourseOutline';
import LessonQuizOverview from './LessonQuizOverview';
import CourseSessionModal from './CourseSessionModal';
import CourseLessonModal from './CourseLessonModal';
import CourseBulkLessonModal from './CourseBulkLessonModal';
import CourseAssessmentEditor from './CourseAssessmentEditor';

export default function AdminEditCoursePage({ params }: { params: { courseId: string } }) {
  const editor = useCourseEditor(params);
  const {
    toast,
    setToast,
    course,
    isPublished,
    savingInfo,
    handleSaveInfo,
    hasUnsavedCourseInfo,
    publishLoading,
    handlePublish,
    setShowUnpublishConfirm,
    showUnpublishConfirm,
    handleUnpublish,
    loading
  } = editor;

  return (
    <>
        <Toast toast={toast} onClose={() => setToast(null)} />

        <div className="sticky top-3 z-30 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 rounded-2xl border border-blue-100 bg-white/95 p-3 shadow-lg backdrop-blur">
          <Link
            href="/admin/courses"
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white border border-[#cbdbf5] text-xs font-bold text-[#172554] hover:bg-[#eff4ff] hover:text-[#2563EB] hover:border-[#2563EB] shadow-xs transition-all w-fit"
          >
            ← Quay lại danh sách khóa học
          </Link>
          {course && <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" disabled={editor.editorLocked} loading={savingInfo || editor.draftSaving} onClick={() => void handleSaveInfo()}>{hasUnsavedCourseInfo ? 'Lưu thay đổi •' : 'Đã lưu'}</Button>
            <span
              className={`whitespace-nowrap inline-flex items-center text-xs font-bold px-3 py-1 rounded-full ${
                isPublished ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
              }`}
            >
              {isPublished ? 'Đã xuất bản' : 'Bản nháp'}
            </span>

            {isPublished && <Button disabled={editor.editorLocked || (!editor.hasDraftChanges && !hasUnsavedCourseInfo)} loading={publishLoading} onClick={handlePublish}>Cập nhật khóa học</Button>}
            {isPublished && <Button variant="secondary" disabled={editor.draftSaving || editor.draftConflict || publishLoading || !editor.hasDraftChanges} onClick={editor.handleDiscardDraft}>Bỏ thay đổi</Button>}
            {!isPublished && (
              <Button loading={publishLoading} onClick={handlePublish}>
                Xuất bản khóa học
              </Button>
            )}
          </div>}
        </div>

        {isPublished && <div className="mb-6 space-y-3">
          <p role="status" className="text-sm text-[#434655]">{editor.draftSaving ? 'Đang lưu bản nháp…' : editor.hasDraftChanges ? 'Có thay đổi chưa cập nhật. Học viên vẫn học bản đang xuất bản.' : 'Chỉnh sửa được lưu vào bản nháp thay đổi.'}</p>
          {editor.draftConflict && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Bản nháp hoặc bản xuất bản đã thay đổi bởi Admin khác. Hãy tải lại để xem phiên bản mới trước khi tiếp tục. <Button variant="secondary" onClick={editor.reloadDraft}>Tải lại bản nháp</Button></div>}
          {editor.draftError && <p role="alert" className="text-sm text-red-700">Bản nháp cũ không hợp lệ: {editor.draftError} Đang hiển thị bản xuất bản. Hãy bỏ thay đổi để bắt đầu bản nháp mới.</p>}
          <button type="button" disabled={editor.editorLocked || editor.hasDraftChanges || hasUnsavedCourseInfo} onClick={() => setShowUnpublishConfirm(true)} className="text-sm font-semibold text-red-700 underline underline-offset-4 disabled:opacity-50">Hủy xuất bản khẩn cấp</button>
          {(editor.hasDraftChanges || hasUnsavedCourseInfo) && <p className="text-xs text-[#737686]">Cập nhật hoặc bỏ thay đổi trước khi hủy xuất bản khẩn cấp.</p>}
        </div>}

        {/* IMP-03: Unpublish Confirmation Modal */}
        <Modal
          isOpen={showUnpublishConfirm}
          onClose={() => setShowUnpublishConfirm(false)}
          maxWidth="max-w-md"
        >
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">⚠️</span>
              <h2 className="text-lg font-bold text-[#172554]">Hủy xuất bản khẩn cấp</h2>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-amber-800 font-semibold text-sm mb-1">Hành động này sẽ ảnh hưởng đến toàn bộ học viên!</p>
              <p className="text-amber-700 text-sm">
                Hủy xuất bản sẽ <strong>tạm ngừng khóa học này</strong> đối với học viên.
                Học viên sẽ không thể truy cập bài học hay làm bài kiểm tra cho đến khi khóa học được xuất bản trở lại.
              </p>
            </div>
            <p className="text-[#434655] text-sm">
              Khóa tạm rời bộ khóa bắt buộc và hạn được tính lại: còn khóa khác có sàn 3 ngày, hết khóa thì không còn hạn. Tiến trình, điểm thi và ô tick bắt buộc được giữ nguyên. Xuất bản lại trong 3 ngày khôi phục hạn trước khi gỡ; sau 3 ngày tính như thêm lại khóa.
            </p>
            <div className="flex gap-3 pt-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setShowUnpublishConfirm(false)}
              >
                Hủy bỏ
              </Button>
              <button
                onClick={handleUnpublish}
                disabled={publishLoading}
                className="flex-1 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
              >
                {publishLoading ? 'Đang xử lý...' : 'Xác nhận hủy xuất bản'}
              </button>
            </div>
          </div>
        </Modal>


        {loading && !course ? (
          <div className="space-y-6 animate-pulse">
            <div className="h-44 bg-white rounded-3xl border border-[#eff4ff]"></div>
            <div className="h-64 bg-white rounded-3xl border border-[#eff4ff]"></div>
          </div>
        ) : !course ? (
          <Card className="text-center py-16">
            <p className="text-lg font-semibold text-[#172554] mb-2">Không tìm thấy khóa học</p>
            <Link href="/admin/courses">
              <Button>Quay lại danh sách</Button>
            </Link>
          </Card>
        ) : (
          <fieldset disabled={editor.editorLocked} className="space-y-8 min-w-0">
            {/* 1. Basic Info Form */}
            <CourseInfo {...editor} />

            <FinalAssessmentSummary {...editor} />

            {/* 2. Sessions & Lessons Outline Builder with Up/Down buttons (Request 1) */}
            <CourseOutline {...editor} />

            {/* 3. Quiz Per-Lesson Overview Section */}
            <LessonQuizOverview {...editor} />
          </fieldset>
        )}

        {/* Modal: Add / Edit Session */}
        <CourseSessionModal {...editor} />

        {/* Modal: Add / Edit Lesson */}
        <CourseLessonModal {...editor} />

        {/* Modal: Bulk add lessons from pasted YouTube links */}
        <CourseBulkLessonModal {...editor} />

        {/* Modal: Assessment Multi-Type Question Builder with Question Reordering */}
        <CourseAssessmentEditor {...editor} />
    </>
  );
}
