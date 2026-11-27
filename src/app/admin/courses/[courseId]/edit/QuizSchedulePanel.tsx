'use client';
import Button from '@/components/ui/Button';
import { MAX_LESSON_QUIZ_POOLS, MAX_LESSON_QUIZ_QUESTIONS } from '@/lib/quiz-schedule-rules';
import { effectiveDateLabel, effectiveScheduleValues, hasPendingSchedule } from '@/lib/course-editor-search-ui';
import type { CourseEditorState } from './useCourseEditor';

type Props = Pick<CourseEditorState,
  'activeAssessmentMode' |
  'scheduleMeta' |
  'scheduleForm' |
  'setScheduleForm' |
  'scheduleBudgetIssue' |
  'handleCancelSchedule' |
  'handleApplyScheduledQuestionCount'
>;

const inputClass = 'mt-1 w-full rounded-xl border border-[#cbdbf5] bg-white px-3 py-2 text-sm font-normal text-[#172554] focus:outline-none focus:ring-2 focus:ring-[#2563EB]';
const toNumberOrNull = (value: string) => value.trim() === '' || !Number.isFinite(Number(value)) ? null : Math.trunc(Number(value));

export default function QuizSchedulePanel({
  activeAssessmentMode,
  scheduleMeta,
  scheduleForm,
  setScheduleForm,
  scheduleBudgetIssue,
  handleCancelSchedule,
  handleApplyScheduledQuestionCount,
}: Props) {
  if (!scheduleMeta?.hasCurrentMonthAttempts) return null;
  const isFinal = activeAssessmentMode === 'COURSE_FINAL';
  const when = effectiveDateLabel(scheduleMeta.scheduledConfig?.effectiveMonthKey);
  const pending = hasPendingSchedule(scheduleMeta, scheduleForm);
  const values = effectiveScheduleValues(scheduleMeta, scheduleForm);

  return (
    <section aria-labelledby="quiz-schedule-title" className="space-y-3">
      <div role="status" className="rounded-2xl border border-blue-200 bg-[#eff4ff] p-4 text-sm leading-relaxed text-[#172554]">
        <p className="font-bold">{isFinal ? 'Bài thi cuối khóa' : 'Quiz'} đã có lượt làm trong tháng này</p>
        <p className="mt-1">
          Cấu hình tháng này đang giữ nguyên (<strong>{scheduleMeta.currentQuestionCount} câu / {scheduleMeta.currentDurationMinutes} phút</strong>).
          Mọi thay đổi số câu hoặc thời gian sẽ tự động áp dụng từ <strong>{when}</strong>, trong khi{' '}
          {isFinal
            ? <strong>ngân hàng quiz các bài học vẫn cập nhật ngay lập tức</strong>
            : <strong>ngân hàng câu hỏi (tối đa {MAX_LESSON_QUIZ_QUESTIONS} câu / {MAX_LESSON_QUIZ_POOLS} nhóm) vẫn cập nhật ngay lập tức</strong>}.
        </p>
      </div>

      <div className="rounded-2xl border border-[#cbdbf5] bg-white p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 id="quiz-schedule-title" className="text-sm font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>Lịch áp dụng tháng sau</h4>
          {pending && (
            <Button size="sm" variant="outline" onClick={handleCancelSchedule}>Hủy lịch tháng sau</Button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-[#6c6f7f]">Tháng này (đang áp dụng, không sửa được)</p>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-[#cbdbf5] bg-[#eff4ff] px-3 py-1 text-xs font-bold text-[#172554]">{scheduleMeta.currentQuestionCount} câu mỗi lượt</span>
              <span className="rounded-full border border-[#cbdbf5] bg-[#eff4ff] px-3 py-1 text-xs font-bold text-[#172554]">{scheduleMeta.currentDurationMinutes} phút</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label htmlFor="schedule-question-count" className="text-xs font-semibold text-[#172554]">
              Số câu mỗi lượt tháng sau
              <input
                id="schedule-question-count"
                type="number"
                inputMode="numeric"
                min={1}
                max={isFinal ? 10000 : MAX_LESSON_QUIZ_QUESTIONS}
                value={values.questionCount}
                onChange={(e) => setScheduleForm((previous) => ({ ...previous, questionCount: toNumberOrNull(e.target.value) }))}
                aria-invalid={Boolean(scheduleBudgetIssue)}
                className={inputClass}
              />
            </label>
            <label htmlFor="schedule-duration-minutes" className="text-xs font-semibold text-[#172554]">
              Thời gian làm bài tháng sau (phút)
              <input
                id="schedule-duration-minutes"
                type="number"
                inputMode="numeric"
                min={1}
                max={240}
                value={values.durationMinutes}
                onChange={(e) => setScheduleForm((previous) => ({ ...previous, durationMinutes: toNumberOrNull(e.target.value) }))}
                className={inputClass}
              />
            </label>
          </div>
        </div>

        {pending ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
            Sẽ áp dụng từ {when}: {values.questionCount} câu · {values.durationMinutes} phút. Bạn có thể sửa lại nhiều lần trước thời điểm này.
          </p>
        ) : (
          <p className="text-xs text-[#6c6f7f]">Chưa hẹn thay đổi cho tháng sau. Đổi số câu hoặc thời gian ở trên để tạo lịch; có thể chỉ đổi một trong hai.</p>
        )}

        {scheduleBudgetIssue && (
          <div role="alert" className="space-y-2 rounded-xl border border-red-300 bg-red-50 p-3 text-xs font-semibold text-red-800">
            <p>⚠️ {scheduleBudgetIssue.message}</p>
            <p>Mức tối đa hiện tại: <strong>{scheduleBudgetIssue.maxAllowed} câu mỗi lượt</strong>.</p>
            <div className="flex flex-wrap gap-2">
              {scheduleBudgetIssue.reduceTo !== null && (
                <Button size="sm" variant="secondary" onClick={() => handleApplyScheduledQuestionCount(scheduleBudgetIssue.reduceTo!)}>
                  Giảm lịch tháng sau về {scheduleBudgetIssue.reduceTo} câu
                </Button>
              )}
              {scheduleBudgetIssue.raiseTo !== null && (
                <Button size="sm" variant="secondary" onClick={() => handleApplyScheduledQuestionCount(scheduleBudgetIssue.raiseTo!)}>
                  Tăng lịch tháng sau lên {scheduleBudgetIssue.raiseTo} câu
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={handleCancelSchedule}>Hủy lịch tháng sau</Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
