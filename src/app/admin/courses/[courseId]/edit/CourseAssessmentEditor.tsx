'use client';
import { useEffect, useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { MAX_LESSON_QUIZ_POOLS, MAX_LESSON_QUIZ_QUESTIONS } from '@/lib/quiz-schedule-rules';
import { getHighlightSegments, type QuizMatchField } from '@/lib/quiz-search';
import { filterQuizBank, questionDomId, questionKeyOf, type QuizImportMode } from '@/lib/course-editor-search-ui';
import HighlightedText from './HighlightedText';
import QuizSchedulePanel from './QuizSchedulePanel';
import type { CourseEditorState } from './useCourseEditor';

type Props = Pick<CourseEditorState,
  'showAssessmentModal' |
  'closeAssessmentModal' |
  'activeAssessmentMode' |
  'activeLessonForAssessment' |
  'assessmentLoading' |
  'assessmentFormError' |
  'assessmentForm' |
  'setAssessmentForm' |
  'finalAvailableQuestions' |
  'quizPoolNames' |
  'lessonPoolCounts' |
  'maxLessonQuestionsAllowed' |
  'expectedDistributionText' |
  'minLessonPoolCount' |
  'handleAddPool' |
  'quizImportUrl' |
  'setQuizImportUrl' |
  'quizImporting' |
  'handleImportQuiz' |
  'quizImportErrors' |
  'quizImportMode' |
  'setQuizImportMode' |
  'setQuizPoolNames' |
  'handleAddQuestion' |
  'handleRemovePool' |
  'handleMoveQuestion' |
  'handleRemoveQuestion' |
  'handleUpdateQuestion' |
  'handleQuestionTypeChange' |
  'handleRemoveOption' |
  'handleAddOption' |
  'editorLocked' |
  'handleDeleteAssessment' |
  'assessmentSaving' |
  'isLessonQuizInvalid' |
  'handleSaveAssessment' |
  'scheduleMeta' |
  'scheduleForm' |
  'setScheduleForm' |
  'scheduleBudgetIssue' |
  'handleCancelSchedule' |
  'handleApplyScheduledQuestionCount' |
  'focusedQuestionKey'
>;

const MATCH_LABEL: Record<QuizMatchField, string> = { question: 'Câu hỏi', option: 'Đáp án', explanation: 'Giải thích' };
const IMPORT_MODES: { value: QuizImportMode; label: string; hint: string }[] = [
  { value: 'append', label: 'Thêm vào ngân hàng hiện có', hint: `Giữ nguyên các câu hiện có, gộp nhóm trùng tên, tối đa ${MAX_LESSON_QUIZ_QUESTIONS} câu / ${MAX_LESSON_QUIZ_POOLS} nhóm.` },
  { value: 'replace', label: 'Thay thế toàn bộ ngân hàng', hint: 'Bỏ các câu đang soạn và dùng đúng nội dung trong file.' },
];

const Highlighted = HighlightedText;

export default function CourseAssessmentEditor({
  showAssessmentModal,
  closeAssessmentModal,
  activeAssessmentMode,
  activeLessonForAssessment,
  assessmentLoading,
  assessmentFormError,
  assessmentForm,
  setAssessmentForm,
  finalAvailableQuestions,
  quizPoolNames,
  lessonPoolCounts,
  maxLessonQuestionsAllowed,
  expectedDistributionText,
  minLessonPoolCount,
  handleAddPool,
  quizImportUrl,
  setQuizImportUrl,
  quizImporting,
  handleImportQuiz,
  quizImportErrors,
  quizImportMode,
  setQuizImportMode,
  setQuizPoolNames,
  handleAddQuestion,
  handleRemovePool,
  handleMoveQuestion,
  handleRemoveQuestion,
  handleUpdateQuestion,
  handleQuestionTypeChange,
  handleRemoveOption,
  handleAddOption,
  editorLocked,
  handleDeleteAssessment,
  assessmentSaving,
  isLessonQuizInvalid,
  handleSaveAssessment,
  scheduleMeta,
  scheduleForm,
  setScheduleForm,
  scheduleBudgetIssue,
  handleCancelSchedule,
  handleApplyScheduledQuestionCount,
  focusedQuestionKey
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [poolFilterValue, setPoolFilterValue] = useState<number | null>(null);
  const lessonId = activeLessonForAssessment?.lessonId;

  useEffect(() => {
    setSearchQuery('');
    setPoolFilterValue(null);
  }, [showAssessmentModal, lessonId]);

  const poolFilter = poolFilterValue !== null && poolFilterValue < quizPoolNames.length ? poolFilterValue : null;
  const view = useMemo(
    () => filterQuizBank(assessmentForm.questions, quizPoolNames.length, searchQuery, poolFilter),
    [assessmentForm.questions, quizPoolNames.length, searchQuery, poolFilter]
  );
  const clearFilters = () => { setSearchQuery(''); setPoolFilterValue(null); };
  const focusedIndex = focusedQuestionKey ? assessmentForm.questions.findIndex((question, index) => questionKeyOf(question, index) === focusedQuestionKey) : -1;
  const focusedPool = focusedIndex >= 0 ? assessmentForm.questions[focusedIndex].poolIndex ?? 0 : -1;
  const questionCount = assessmentForm.questions.length;
  const monthLocked = Boolean(scheduleMeta?.hasCurrentMonthAttempts);

  useEffect(() => {
    if (!showAssessmentModal || assessmentLoading || !focusedQuestionKey || focusedIndex < 0) return;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const focusQuestion = () => {
      const element = document.getElementById(questionDomId(focusedQuestionKey));
      if (!element) {
        if (attempts++ < 15) timer = setTimeout(focusQuestion, 60);
        return;
      }
      if (element instanceof HTMLDetailsElement) element.open = true;
      const pool = element.parentElement?.closest('details');
      if (pool) pool.open = true;
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    focusQuestion();
    return () => { if (timer) clearTimeout(timer); };
  }, [showAssessmentModal, assessmentLoading, focusedQuestionKey, focusedIndex >= 0]);

  return (
    <Modal
          isOpen={showAssessmentModal}
          onClose={closeAssessmentModal}
          maxWidth="max-w-2xl"
        >
          <div className="p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-[#eff4ff] pb-3">
              <h3 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                {activeAssessmentMode === 'COURSE_FINAL' ? 'Cấu hình bài thi cuối khóa' : activeLessonForAssessment ? `Cấu hình Quiz: ${activeLessonForAssessment.lessonTitle}` : 'Cấu hình bài kiểm tra'}
              </h3>
              <button
                type="button"
                aria-label="Đóng cửa sổ cấu hình bài kiểm tra"
                onClick={closeAssessmentModal}
                className="text-[#6c6f7f] hover:text-[#172554] font-bold text-xl p-1 rounded-lg hover:bg-slate-100 transition"
              >
                ✕
              </button>
            </div>

            {assessmentLoading ? (
              <div className="space-y-4 py-2" role="status" aria-live="polite">
                <div className="flex items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-sm font-semibold text-blue-800">
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                  Đang tải nội dung bài kiểm tra...
                </div>
                <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
                <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
                <div className="grid grid-cols-2 gap-3">
                  <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
                  <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
                </div>
              </div>
            ) : <>

              {assessmentFormError && (
                <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-semibold flex items-center gap-2">
                  <span>⚠️</span>
                  <span>{assessmentFormError}</span>
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label htmlFor="assessment-title" className="block text-sm font-semibold text-[#172554] mb-1">Tiêu đề bài kiểm tra *</label>
                  <input id="assessment-title"
                    type="text"
                    required
                    value={assessmentForm.title}
                    onChange={(e) => setAssessmentForm({ ...assessmentForm, title: e.target.value })}
                    className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  />
                </div>
                <div>
                  <label htmlFor="assessment-description" className="block text-sm font-semibold text-[#172554] mb-1">Mô tả / Yêu cầu đạt</label>
                  <textarea id="assessment-description"
                    rows={2}
                    value={assessmentForm.description}
                    onChange={(e) => setAssessmentForm({ ...assessmentForm, description: e.target.value })}
                    className="w-full px-4 py-2 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  />
                </div>
              </div>

              {monthLocked ? (
                <QuizSchedulePanel
                  activeAssessmentMode={activeAssessmentMode}
                  scheduleMeta={scheduleMeta}
                  scheduleForm={scheduleForm}
                  setScheduleForm={setScheduleForm}
                  scheduleBudgetIssue={scheduleBudgetIssue}
                  handleCancelSchedule={handleCancelSchedule}
                  handleApplyScheduledQuestionCount={handleApplyScheduledQuestionCount}
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-[#172554]">Số câu mỗi lượt<input type="number" min={1} max={activeAssessmentMode === 'COURSE_FINAL' ? finalAvailableQuestions : questionCount} value={assessmentForm.questionCount} onChange={(e) => setAssessmentForm({ ...assessmentForm, questionCount: Number(e.target.value) })} className="mt-1 w-full rounded-xl border border-[#cbdbf5] px-3 py-2 font-normal"/></label>
                  <label className="text-sm font-semibold text-[#172554]">Thời gian (phút)<input type="number" min={1} max={240} value={assessmentForm.durationMinutes} onChange={(e) => setAssessmentForm({ ...assessmentForm, durationMinutes: Number(e.target.value) })} className="mt-1 w-full rounded-xl border border-[#cbdbf5] px-3 py-2 font-normal"/></label>
                </div>
              )}

              {activeAssessmentMode === 'LESSON' && quizPoolNames.length > 0 ? (
                <div className="rounded-2xl border border-blue-200 bg-blue-50/80 p-4 space-y-2.5 text-sm text-[#172554]">
                  <div className="flex flex-wrap items-center gap-y-1 gap-x-2.5 text-xs font-semibold text-blue-900">
                    <span>Tổng số nhóm: <strong>{quizPoolNames.length}/{MAX_LESSON_QUIZ_POOLS}</strong></span>
                    <span className="text-blue-300">•</span>
                    <span>Số câu từng nhóm: <strong>{quizPoolNames.map((name, idx) => `${name || `Nhóm ${idx + 1}`}: ${lessonPoolCounts[idx]} câu`).join(' | ')}</strong></span>
                    <span className="text-blue-300">•</span>
                    <span>Tổng ngân hàng: <strong>{questionCount}/{MAX_LESSON_QUIZ_QUESTIONS} câu</strong></span>
                    <span className="text-blue-300">•</span>
                    <span>Mỗi lượt{monthLocked ? ' (tháng này)' : ''}: <strong>{assessmentForm.questionCount} câu</strong></span>
                    <span className="text-blue-300">•</span>
                    <span>Tối đa cân bằng: <strong>{maxLessonQuestionsAllowed} câu/lượt</strong></span>
                  </div>

                  {expectedDistributionText && (
                    <div className="text-xs font-bold text-emerald-800 bg-emerald-100/90 border border-emerald-300 px-3 py-1.5 rounded-xl">
                      ✓ {expectedDistributionText} (Tối đa: {maxLessonQuestionsAllowed} câu/lượt)
                    </div>
                  )}

                  {minLessonPoolCount === 0 && (
                    <div className="text-xs font-bold text-amber-800 bg-amber-100/90 border border-amber-300 px-3 py-2 rounded-xl flex items-center gap-2">
                      <span>⚠️</span>
                      <span>Có nhóm chưa có câu hỏi (0 câu). Mỗi nhóm phải có ít nhất 1 câu hỏi để đủ điều kiện xuất bản cấu hình mới.</span>
                    </div>
                  )}

                  {minLessonPoolCount > 0 && assessmentForm.questionCount < quizPoolNames.length && (
                    <div className="text-xs font-bold text-amber-800 bg-amber-100/90 border border-amber-300 px-3 py-2 rounded-xl flex items-center gap-2">
                      <span>⚠️</span>
                      <span>Số câu mỗi lượt ({assessmentForm.questionCount}) không thể nhỏ hơn số nhóm ({quizPoolNames.length}) để bảo đảm phân phối cân bằng.</span>
                    </div>
                  )}

                  {minLessonPoolCount > 0 && assessmentForm.questionCount > maxLessonQuestionsAllowed && (
                    <div className="text-xs font-bold text-red-800 bg-red-100/90 border border-red-300 px-3 py-2 rounded-xl flex items-center gap-2">
                      <span>⚠️</span>
                      <span>Với {quizPoolNames.length} nhóm và nhóm ít câu nhất có {minLessonPoolCount} câu, bài kiểm tra chỉ được chọn tối đa {maxLessonQuestionsAllowed} câu để bảo đảm phân phối cân bằng.</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">
                  Ngân hàng: {activeAssessmentMode === 'COURSE_FINAL' ? finalAvailableQuestions : questionCount} câu
                  <span className="mx-2 text-blue-300">|</span>
                  Mỗi lần thi{monthLocked ? ' (tháng này)' : ''}: {assessmentForm.questionCount} câu
                  <span className="mx-2 text-blue-300">|</span>
                  Thời gian{monthLocked ? ' (tháng này)' : ''}: {assessmentForm.durationMinutes} phút
                </div>
              )}

              {activeAssessmentMode === 'COURSE_FINAL' && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">Ngân hàng quiz hiện có {finalAvailableQuestions} câu. Bài thi sẽ lưu một phiên bản đề riêng và lấy câu hỏi đều từ các bài học. Nếu số câu giảm xuống dưới mức đã cấu hình, hệ thống sẽ chặn thao tác sửa/xóa quiz và hướng dẫn điều chỉnh.</div>}
              {activeAssessmentMode === 'COURSE_FINAL' && finalAvailableQuestions < assessmentForm.questionCount && <p className="text-sm font-semibold text-red-700">Đang thiếu {assessmentForm.questionCount - finalAvailableQuestions} câu so với cấu hình. Hãy giảm số câu mỗi lượt hoặc bổ sung quiz bài học.</p>}
              {activeAssessmentMode === 'LESSON' && <>
              {/* Dynamic Questions Builder with Up/Down buttons (Request 8) */}
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="font-bold text-sm text-[#172554]">Ngân hàng câu hỏi ({quizPoolNames.length} nhóm · {questionCount} câu)<span className="ml-2 text-xs font-normal text-[#6c6f7f]">Tối đa {MAX_LESSON_QUIZ_QUESTIONS} câu / {MAX_LESSON_QUIZ_POOLS} nhóm</span></h4>
                  <Button size="sm" variant="secondary" onClick={handleAddPool} disabled={quizPoolNames.length >= MAX_LESSON_QUIZ_POOLS} title={quizPoolNames.length >= MAX_LESSON_QUIZ_POOLS ? `Đã đạt tối đa ${MAX_LESSON_QUIZ_POOLS} nhóm` : undefined}>＋ Tạo nhóm</Button>
                </div>

                {/* Import câu hỏi từ Google Sheet / Google Doc */}
                <div className="p-4 bg-white border border-[#cbdbf5] rounded-2xl space-y-3">
                  <fieldset className="space-y-1.5">
                    <legend className="text-xs font-semibold text-[#172554]">Cách nhập câu hỏi</legend>
                    <div role="radiogroup" aria-label="Chế độ nhập câu hỏi" className="grid gap-2 sm:grid-cols-2">
                      {IMPORT_MODES.map((mode) => (
                        <label
                          key={mode.value}
                          htmlFor={`quiz-import-mode-${mode.value}`}
                          className={`flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 text-xs transition ${quizImportMode === mode.value ? 'border-[#2563EB] bg-[#eff4ff]' : 'border-[#cbdbf5] bg-white hover:bg-[#f8f9ff]'}`}
                        >
                          <input
                            id={`quiz-import-mode-${mode.value}`}
                            type="radio"
                            name="quiz-import-mode"
                            value={mode.value}
                            checked={quizImportMode === mode.value}
                            onChange={() => setQuizImportMode(mode.value)}
                            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer text-[#2563EB]"
                          />
                          <span>
                            <span className="block font-bold text-[#172554]">{mode.label}</span>
                            <span className="mt-0.5 block text-[11px] leading-snug text-[#6c6f7f]">{mode.hint}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label htmlFor="quiz-import-url" className="block text-xs font-semibold text-[#172554]">
                    Nhập câu hỏi từ Google Sheet / Google Doc
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input id="quiz-import-url"
                      type="text"
                      value={quizImportUrl}
                      onChange={(e) => setQuizImportUrl(e.target.value)}
                      placeholder="Dán link Google Sheet/Doc đã chia sẻ công khai"
                      className="flex-1 px-3 py-2 border border-[#cbdbf5] rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                    />
                    <Button size="sm" variant="secondary" loading={quizImporting} loadingText="Đang tải..." onClick={handleImportQuiz}>
                      Tải câu hỏi
                    </Button>
                  </div>
                  <p className="text-[11px] text-[#6c6f7f] leading-relaxed">
                    Hãy thực hiện theo mẫu sau:{' '}
                    <a
                      href="https://docs.google.com/spreadsheets/d/1HhM0S2agnLMWz9MQYCswyGL1W8SeplN0DiNMFWYNa20/edit?usp=sharing"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#2563EB] hover:underline font-semibold inline-flex items-center gap-1"
                    >
                      Mẫu các câu hỏi
                    </a>
                  </p>
                  {quizImportErrors.length > 0 && (
                    <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                      <p className="text-[11px] font-bold text-amber-800 mb-1">
                        {quizImportErrors.length} dòng bị bỏ qua:
                      </p>
                      <ul className="text-[11px] text-amber-800 list-disc pl-4 space-y-0.5">
                        {quizImportErrors.map((err) => (
                          <li key={`${err.row}-${err.message}`}>Dòng {err.row}: {err.message}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Tìm kiếm / lọc câu hỏi trong quiz */}
                <div className="space-y-2 rounded-2xl border border-[#cbdbf5] bg-[#f8f9ff] p-3">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        aria-label="Tìm câu hỏi trong quiz"
                        placeholder="Tìm nội dung câu hỏi, đáp án, giải thích..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full rounded-xl border border-[#cbdbf5] bg-white py-2 pl-3 pr-9 text-xs focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          aria-label="Xóa từ khóa tìm kiếm"
                          onClick={() => setSearchQuery('')}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg px-1.5 py-0.5 text-sm font-bold text-[#6c6f7f] hover:bg-slate-100 hover:text-[#172554]"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <select
                      aria-label="Lọc câu hỏi theo nhóm"
                      value={poolFilter === null ? '' : String(poolFilter)}
                      onChange={(e) => setPoolFilterValue(e.target.value === '' ? null : Number(e.target.value))}
                      className="rounded-xl border border-[#cbdbf5] bg-white px-3 py-2 text-xs sm:w-56"
                    >
                      <option value="">Tất cả nhóm</option>
                      {quizPoolNames.map((name, index) => <option key={index} value={index}>{`${name || `Nhóm ${index + 1}`} (${lessonPoolCounts[index] ?? 0} câu)`}</option>)}
                    </select>
                  </div>
                  {view.active && (
                    <p role="status" aria-live="polite" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-[#172554]">
                      <span>Hiển thị {view.matchCount} / {view.total} câu hỏi</span>
                      <span className="font-normal text-[#6c6f7f]">Đang lọc: nút di chuyển câu hỏi tạm tắt để không làm sai thứ tự.</span>
                      <button type="button" onClick={clearFilters} className="font-semibold text-[#2563EB] hover:underline">Xóa bộ lọc</button>
                    </p>
                  )}
                </div>

                {view.active && view.matchCount === 0 && (
                  <div role="status" className="rounded-2xl border border-dashed border-[#cbdbf5] bg-white p-6 text-center text-sm text-[#434655]">
                    <p className="font-semibold text-[#172554]">
                      {searchQuery.trim() ? `Không tìm thấy câu hỏi nào khớp với "${searchQuery.trim()}"` : 'Nhóm này chưa có câu hỏi nào'}
                    </p>
                    <Button size="sm" variant="outline" className="mt-3" onClick={clearFilters}>Xóa bộ lọc</Button>
                  </div>
                )}

                {view.visiblePools.map((poolIndex) => {
                  const poolName = quizPoolNames[poolIndex];
                  const entries = view.byPool.get(poolIndex) || [];
                  return (
                  <details key={`pool-${poolIndex}`} open={view.active || focusedPool === poolIndex} className="rounded-2xl border border-blue-200 bg-white">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-bold text-[#172554]"><span>{poolName} · {lessonPoolCounts[poolIndex] ?? 0} câu{view.active ? ` (${entries.length} khớp)` : ''}</span><span className="text-xs font-normal text-blue-600">Mở nhóm ▾</span></summary>
                    <div className="space-y-3 border-t border-blue-100 p-3">
                      <div className="flex gap-2"><input aria-label={`Tên nhóm câu hỏi ${poolIndex + 1}`} value={poolName} onChange={(e) => setQuizPoolNames((previous) => previous.map((name, index) => index === poolIndex ? e.target.value : name))} className="flex-1 rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"/><Button size="sm" variant="secondary" disabled={questionCount >= MAX_LESSON_QUIZ_QUESTIONS} title={questionCount >= MAX_LESSON_QUIZ_QUESTIONS ? `Đã đạt tối đa ${MAX_LESSON_QUIZ_QUESTIONS} câu` : undefined} onClick={() => handleAddQuestion(poolIndex)}>＋ Tạo câu hỏi</Button><button type="button" onClick={() => handleRemovePool(poolIndex)} className="rounded-lg px-2 text-red-600 hover:bg-red-50">Xóa nhóm</button></div>
                {entries.map(({ index: qIdx, question: q, match }) => {
                  const questionKey = questionKeyOf(q, qIdx);
                  const isFocused = questionKey === focusedQuestionKey;
                  const matchedOptions = view.active && searchQuery.trim() ? q.options.map((opt, oIdx) => ({ opt, oIdx })).filter(({ opt }) => getHighlightSegments(opt.optionText, searchQuery).some((segment) => segment.match)) : [];
                  const explanationMatched = view.active && searchQuery.trim() && getHighlightSegments(q.explanation || '', searchQuery).some((segment) => segment.match);
                  return (
                  <details key={questionKey} id={questionDomId(questionKey)} open={view.active || isFocused} className={`group rounded-2xl border bg-[#f8f9ff] ${isFocused ? 'border-[#2563EB] ring-2 ring-blue-300' : 'border-[#eff4ff]'}`}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-[#172554]">
                      <span className="shrink-0">{quizPoolNames[q.poolIndex ?? 0] || 'Chưa có nhóm'} · Câu {qIdx + 1}</span>
                      <span className="flex min-w-0 items-center gap-1.5">
                        {view.active && searchQuery.trim() && match.matchedIn.map((field) => <span key={field} className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800">{MATCH_LABEL[field]}</span>)}
                        <span className="max-w-[65%] truncate text-xs font-normal text-[#6c6f7f]">{q.questionText ? <Highlighted text={q.questionText} query={searchQuery} /> : 'Chưa nhập nội dung'}</span>
                      </span>
                    </summary>
                  <div className="space-y-3 border-t border-[#eff4ff] p-4">
                    {(matchedOptions.length > 0 || explanationMatched) && (
                      <div className="space-y-1 rounded-xl border border-yellow-200 bg-yellow-50 p-2.5 text-xs text-[#434655]">
                        <p className="font-bold text-[#172554]">Nội dung khớp từ khóa</p>
                        {matchedOptions.map(({ opt, oIdx }) => <p key={oIdx}><span className="font-semibold">Đáp án {oIdx + 1}:</span> <Highlighted text={opt.optionText} query={searchQuery} /></p>)}
                        {explanationMatched && <p><span className="font-semibold">Giải thích:</span> <Highlighted text={q.explanation || ''} query={searchQuery} /></p>}
                      </div>
                    )}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-1.5 shrink-0 mt-1">
                        <span className="font-bold text-sm text-[#2563EB]">Câu {qIdx + 1}</span>
                        {/* Reorder Up/Down buttons: always act on the original index, disabled while filtering */}
                        <div className="flex flex-col gap-0.5">
                          {qIdx > 0 && (
                            <button
                              type="button"
                              disabled={view.active}
                              onClick={() => handleMoveQuestion(qIdx, 'up')}
                              className="text-[11px] text-[#6c6f7f] hover:text-[#2563EB] px-1 bg-white border border-[#cbdbf5] rounded hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
                              title={view.active ? 'Hãy xóa bộ lọc trước khi di chuyển câu hỏi' : 'Di chuyển câu hỏi lên'}
                              aria-label={`Di chuyển câu ${qIdx + 1} lên`}
                            >
                              ▲
                            </button>
                          )}
                          {qIdx < questionCount - 1 && (
                            <button
                              type="button"
                              disabled={view.active}
                              onClick={() => handleMoveQuestion(qIdx, 'down')}
                              className="text-[11px] text-[#6c6f7f] hover:text-[#2563EB] px-1 bg-white border border-[#cbdbf5] rounded hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
                              title={view.active ? 'Hãy xóa bộ lọc trước khi di chuyển câu hỏi' : 'Di chuyển câu hỏi xuống'}
                              aria-label={`Di chuyển câu ${qIdx + 1} xuống`}
                            >
                              ▼
                            </button>
                          )}
                        </div>
                      </div>

                      <input aria-label={`Nội dung câu ${qIdx + 1}`}
                        type="text"
                        required
                        value={q.questionText}
                        onChange={(e) => handleUpdateQuestion(qIdx, (row) => ({ ...row, questionText: e.target.value }))}
                        placeholder="Nhập nội dung câu hỏi..."
                        className="flex-1 px-3 py-2 border border-[#cbdbf5] rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                      />
                      <select aria-label={`Nhóm của câu ${qIdx + 1}`} value={q.poolIndex ?? 0} onChange={(e) => handleUpdateQuestion(qIdx, (row) => ({ ...row, poolIndex: Number(e.target.value) }))} className="w-28 rounded-xl border border-[#cbdbf5] bg-white px-2 py-2 text-xs">
                        {quizPoolNames.map((name, index) => <option key={index} value={index}>{name || `Pool ${index + 1}`}</option>)}
                      </select>
                      <button
                        type="button"
                        aria-label={`Xóa câu ${qIdx + 1}`}
                        onClick={() => handleRemoveQuestion(qIdx)}
                        className="p-1.5 text-[#6c6f7f] hover:text-red-600 rounded-lg hover:bg-red-50 shrink-0"
                        title="Xóa câu hỏi này"
                      >
                        🗑️
                      </button>
                    </div>

                    {/* Question Config: Type, Points, Duration */}
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <div>
                        <label className="font-semibold text-[#434655] mr-1.5">Loại câu:</label>
                        <select aria-label={`Loại câu ${qIdx + 1}`}
                          value={q.type}
                          onChange={(e) => handleQuestionTypeChange(qIdx, e.target.value as any)}
                          className="px-2.5 py-1.5 border border-[#cbdbf5] rounded-lg bg-white"
                        >
                          <option value="SINGLE_CHOICE">Trắc nghiệm 1 đáp án</option>
                          <option value="MULTIPLE_CHOICE">Trắc nghiệm nhiều đáp án</option>
                        </select>
                      </div>

                    </div>

                    {/* Explanation (hiện cho học viên khi đạt ≥85 điểm) */}
                    <div>
                      <label className="block text-xs font-semibold text-[#434655] mb-1">
                        💡 Giải thích đáp án (hiện cho học viên khi đạt điểm)
                      </label>
                      <textarea aria-label={`Giải thích đáp án câu ${qIdx + 1}`}
                        rows={2}
                        value={q.explanation ?? ''}
                        onChange={(e) => handleUpdateQuestion(qIdx, (row) => ({ ...row, explanation: e.target.value }))}
                        placeholder="Giải thích tại sao đáp án đúng (tùy chọn)"
                        className="w-full px-3 py-2 border border-[#cbdbf5] rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                      />
                    </div>

                    {/* Options Editor */}
                    <div className="space-y-2 pt-2 border-t border-[#eff4ff]">
                      <span className="text-xs font-semibold text-[#6c6f7f]">
                        {q.type === 'SINGLE_CHOICE'
                          ? 'Chọn 1 nút tròn làm đáp án đúng:'
                          : q.type === 'MULTIPLE_CHOICE'
                          ? 'Tích chọn các đáp án đúng:'
                          : 'Chọn Đúng hoặc Sai:'}
                      </span>

                      {q.options.map((opt, oIdx) => (
                        <div key={oIdx} className="flex items-center gap-2">
                          <input aria-label={`Đáp án ${oIdx + 1} của câu ${qIdx + 1} là đáp án đúng`}
                            type={q.type === 'SINGLE_CHOICE' ? 'radio' : 'checkbox'}
                            name={`correct-${qIdx}`}
                            checked={opt.isCorrect}
                            onChange={() => handleUpdateQuestion(qIdx, (row) => ({
                              ...row,
                              options: row.options.map((o, idx) => row.type === 'SINGLE_CHOICE'
                                ? { ...o, isCorrect: idx === oIdx }
                                : idx === oIdx ? { ...o, isCorrect: !o.isCorrect } : o),
                            }))}
                            className="h-4 w-4 text-[#2563EB] shrink-0 cursor-pointer"
                          />
                          <input aria-label={`Nội dung đáp án ${oIdx + 1} của câu ${qIdx + 1}`}
                            type="text"
                            required
                            value={opt.optionText}
                            onChange={(e) => handleUpdateQuestion(qIdx, (row) => ({
                              ...row,
                              options: row.options.map((o, idx) => idx === oIdx ? { ...o, optionText: e.target.value } : o),
                            }))}
                            className="flex-1 px-3 py-1.5 border border-[#cbdbf5] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#2563EB] disabled:bg-slate-100"
                          />
                          {q.options.length > 2 && (
                            <button
                              type="button"
                              aria-label={`Xóa đáp án ${oIdx + 1} của câu ${qIdx + 1}`}
                              onClick={() => handleRemoveOption(qIdx, oIdx)}
                              className="text-[#6c6f7f] hover:text-red-600 font-bold px-1.5"
                              title="Xóa đáp án này"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={() => handleAddOption(qIdx)}
                        className="text-xs text-[#2563EB] hover:underline font-semibold pt-1 block"
                      >
                        ＋ Thêm đáp án lựa chọn
                      </button>
                    </div>
                  </div>
                  </details>
                  );
                })}
                    </div>
                  </details>
                  );
                })}
              </div>
              </>}

              <div className="flex items-center justify-between pt-3 border-t border-[#eff4ff]">
                <div>
                  {activeLessonForAssessment?.assessment && !editorLocked && (
                    <Button variant="danger" size="sm" onClick={handleDeleteAssessment}>
                      🗑️ Xóa Quiz này
                    </Button>
                  )}
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={closeAssessmentModal}>
                    Hủy
                  </Button>
                  <Button
                    loading={assessmentSaving}
                    loadingText="Đang lưu..."
                    disabled={isLessonQuizInvalid || assessmentSaving}
                    onClick={handleSaveAssessment}
                  >
                    Lưu bài kiểm tra
                  </Button>
                </div>
              </div>
              </>}
            </div>
        </Modal>
  );
}
