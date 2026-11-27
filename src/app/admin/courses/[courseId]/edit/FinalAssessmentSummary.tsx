'use client';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { formatMonthKey, nextMonthKey, pendingScheduleOf } from '@/lib/course-editor-search-ui';
import type { CourseEditorState } from './useCourseEditor';

type Props = Pick<CourseEditorState,
  'course' |
  'openFinalAssessmentEditor'
>;

export default function FinalAssessmentSummary({
  course,
  openFinalAssessmentEditor
}: Props) {
  const pending = pendingScheduleOf(course.finalAssessment);
  const month = formatMonthKey(pending?.monthKey) || formatMonthKey(nextMonthKey());
  return (
    <Card className="p-6 border border-amber-200 bg-gradient-to-r from-amber-50 to-white shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-[#172554]">Bài thi cuối khóa</h2>
                  <p className="mt-1 text-sm text-[#6c6f7f]">
                    Mở sau khi học viên hoàn tất 100% video và đạt tất cả quiz từng bài học.
                    {course.finalAssessment?.title ? ` Hiện tại: ${course.finalAssessment.title} (${course.finalAssessment.questionCount || 0} câu).` : ' Chưa cấu hình.'}
                  </p>
                  {pending && (
                    <span data-testid="final-schedule-badge" className="mt-2 inline-flex items-center rounded-full border border-blue-200 bg-[#eff4ff] px-3 py-1 text-xs font-bold text-[#172554]">
                      Lịch tháng sau ({month}): {pending.questionCount} câu · {pending.durationMinutes} phút
                    </span>
                  )}
                </div>
                <Button variant="secondary" onClick={openFinalAssessmentEditor}>
                  {course.finalAssessment ? 'Cập nhật bài thi cuối khóa' : 'Thiết lập bài thi cuối khóa'}
                </Button>
              </div>
            </Card>
  );
}
