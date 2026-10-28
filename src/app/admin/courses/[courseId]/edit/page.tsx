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
          {course && <div className="flex items-center gap-3">
            {!isPublished && <Button variant="secondary" loading={savingInfo} onClick={() => void handleSaveInfo()}>{hasUnsavedCourseInfo ? 'Lưu thay đổi •' : 'Đã lưu'}</Button>}
            <span
              className={`whitespace-nowrap inline-flex items-center text-xs font-bold px-3 py-1 rounded-full ${
                isPublished ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
              }`}
            >
              {isPublished ? '✓ Đang công khai (Published)' : 'Bản nháp (Draft)'}
            </span>

            {isPublished && <Button loading={publishLoading} onClick={handlePublish}>Công bố cập nhật nội dung</Button>}
            {isPublished ? (
              <Button variant="secondary" loading={publishLoading} onClick={() => setShowUnpublishConfirm(true)}>
                Hạ về bản nháp
              </Button>
            ) : (
              <Button loading={publishLoading} onClick={handlePublish}>
                Công khai khóa học
              </Button>
            )}
          </div>}
        </div>

        {/* IMP-03: Unpublish Confirmation Modal */}
        <Modal
          isOpen={showUnpublishConfirm}
          onClose={() => setShowUnpublishConfirm(false)}
          maxWidth="max-w-md"
        >
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">⚠️</span>
              <h2 className="text-lg font-bold text-[#172554]">Xác nhận hạ xuất bản</h2>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-amber-800 font-semibold text-sm mb-1">Hành động này sẽ ảnh hưởng đến toàn bộ học viên!</p>
              <p className="text-amber-700 text-sm">
                Việc hạ về bản nháp sẽ <strong>tạm thời ẩn khóa học này</strong> khỏi danh sách học viên đang theo dõi.
                Học viên sẽ không thể truy cập bài học hay làm bài kiểm tra cho đến khi khóa học được xuất bản trở lại.
              </p>
            </div>
            <p className="text-[#434655] text-sm">
              Dữ liệu tiến trình và điểm thi của học viên sẽ <strong>không bị mất</strong>. Bạn có thể xuất bản lại bất cứ lúc nào.
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
                {publishLoading ? 'Đang xử lý...' : 'Xác nhận hạ xuất bản'}
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
          <div className="space-y-8">
            {/* 1. Basic Info Form */}
            <CourseInfo {...editor} />

            <FinalAssessmentSummary {...editor} />

            {/* 2. Sessions & Lessons Outline Builder with Up/Down buttons (Request 1) */}
            <CourseOutline {...editor} />

            {/* 3. Quiz Per-Lesson Overview Section */}
            <LessonQuizOverview {...editor} />
          </div>
        )}

        {/* Modal: Add / Edit Session */}
        <CourseSessionModal {...editor} />

        {/* Modal: Add / Edit Lesson */}
        <CourseLessonModal {...editor} />

        {/* Modal: Assessment Multi-Type Question Builder with Question Reordering */}
        <CourseAssessmentEditor {...editor} />
    </>
  );
}
