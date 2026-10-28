'use client';
import Card from '@/components/ui/Card';
import type { CourseEditorState } from './useCourseEditor';

type Props = Pick<CourseEditorState,
  'course'
>;

export default function LessonQuizOverview({
  course
}: Props) {
  return (
    <div className="space-y-4">
              <div>
                <h2 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                  Bài kiểm tra theo từng bài giảng (Quiz per-lesson)
                </h2>
                <p className="text-xs text-[#737686]">
                  Hệ thống áp dụng mô hình làm bài kiểm tra sau khi xem xong từng video bài giảng. Bạn có thể bấm <strong>"+ Thêm Quiz"</strong> hoặc <strong>"Sửa Quiz"</strong> ở từng bài học trong danh sách bên trên.
                </p>
              </div>

              <Card className="p-6 border border-[#eff4ff] shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <span className="text-3xl p-2.5 bg-blue-50 border border-blue-200 rounded-2xl">📝</span>
                    <div>
                      <h4 className="text-sm font-bold text-[#172554]">Trạng thái cấu hình bài kiểm tra</h4>
                      <p className="text-xs text-[#737686] mt-0.5">
                        {(() => {
                          let totalL = 0;
                          let quizL = 0;
                          (course?.sessions || []).forEach((s: any) => {
                            (s.lessons || []).forEach((l: any) => {
                              totalL++;
                              if (l.assessment) quizL++;
                            });
                          });
                          return `${quizL}/${totalL} bài giảng đã có bài kiểm tra (Quiz)`;
                        })()}
                      </p>
                    </div>
                  </div>
                  <span className="self-start sm:self-auto px-3 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold rounded-xl shadow-2xs">
                    ✓ Quiz Theo Từng Video
                  </span>
                </div>
              </Card>
            </div>
  );
}
