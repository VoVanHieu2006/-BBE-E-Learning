'use client';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
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
  'setQuizPoolNames' |
  'handleAddQuestion' |
  'handleRemovePool' |
  'handleMoveQuestion' |
  'handleRemoveQuestion' |
  'handleQuestionTypeChange' |
  'handleRemoveOption' |
  'handleAddOption' |
  'isPublished' |
  'handleDeleteAssessment' |
  'assessmentSaving' |
  'isLessonQuizInvalid' |
  'handleSaveAssessment'
>;

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
  setQuizPoolNames,
  handleAddQuestion,
  handleRemovePool,
  handleMoveQuestion,
  handleRemoveQuestion,
  handleQuestionTypeChange,
  handleRemoveOption,
  handleAddOption,
  isPublished,
  handleDeleteAssessment,
  assessmentSaving,
  isLessonQuizInvalid,
  handleSaveAssessment
}: Props) {
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
                onClick={closeAssessmentModal}
                className="text-[#737686] hover:text-[#172554] font-bold text-xl p-1 rounded-lg hover:bg-slate-100 transition"
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
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-semibold flex items-center gap-2">
                  <span>⚠️</span>
                  <span>{assessmentFormError}</span>
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-semibold text-[#172554] mb-1">Tiêu đề bài kiểm tra *</label>
                  <input
                    type="text"
                    required
                    value={assessmentForm.title}
                    onChange={(e) => setAssessmentForm({ ...assessmentForm, title: e.target.value })}
                    className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#172554] mb-1">Mô tả / Yêu cầu đạt</label>
                  <textarea
                    rows={2}
                    value={assessmentForm.description}
                    onChange={(e) => setAssessmentForm({ ...assessmentForm, description: e.target.value })}
                    className="w-full px-4 py-2 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-semibold text-[#172554]">Số câu mỗi lượt<input type="number" min={1} max={activeAssessmentMode === 'COURSE_FINAL' ? finalAvailableQuestions : assessmentForm.questions.length} value={assessmentForm.questionCount} onChange={(e) => setAssessmentForm({ ...assessmentForm, questionCount: Number(e.target.value) })} className="mt-1 w-full rounded-xl border border-[#cbdbf5] px-3 py-2 font-normal"/></label>
                <label className="text-sm font-semibold text-[#172554]">Thời gian (phút)<input type="number" min={1} max={240} value={assessmentForm.durationMinutes} onChange={(e) => setAssessmentForm({ ...assessmentForm, durationMinutes: Number(e.target.value) })} className="mt-1 w-full rounded-xl border border-[#cbdbf5] px-3 py-2 font-normal"/></label>
              </div>

              {activeAssessmentMode === 'LESSON' && quizPoolNames.length > 0 ? (
                <div className="rounded-2xl border border-blue-200 bg-blue-50/80 p-4 space-y-2.5 text-sm text-[#172554]">
                  <div className="flex flex-wrap items-center gap-y-1 gap-x-2.5 text-xs font-semibold text-blue-900">
                    <span>Tổng số nhóm: <strong>{quizPoolNames.length}</strong></span>
                    <span className="text-blue-300">•</span>
                    <span>Số câu từng nhóm: <strong>{quizPoolNames.map((name, idx) => `${name || `Nhóm ${idx + 1}`}: ${lessonPoolCounts[idx]} câu`).join(' | ')}</strong></span>
                    <span className="text-blue-300">•</span>
                    <span>Tổng ngân hàng: <strong>{assessmentForm.questions.length} câu</strong></span>
                    <span className="text-blue-300">•</span>
                    <span>Mỗi lượt: <strong>{assessmentForm.questionCount} câu</strong></span>
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
                  Ngân hàng: {activeAssessmentMode === 'COURSE_FINAL' ? finalAvailableQuestions : assessmentForm.questions.length} câu
                  <span className="mx-2 text-blue-300">|</span>
                  Mỗi lần thi: {assessmentForm.questionCount} câu
                  <span className="mx-2 text-blue-300">|</span>
                  Thời gian: {assessmentForm.durationMinutes} phút
                </div>
              )}

              {activeAssessmentMode === 'COURSE_FINAL' && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">Ngân hàng quiz hiện có {finalAvailableQuestions} câu. Bài thi sẽ lưu một phiên bản đề riêng và lấy câu hỏi đều từ các bài học. Nếu số câu giảm xuống dưới mức đã cấu hình, hệ thống sẽ chặn thao tác sửa/xóa quiz và hướng dẫn điều chỉnh.</div>}
              {activeAssessmentMode === 'COURSE_FINAL' && finalAvailableQuestions < assessmentForm.questionCount && <p className="text-sm font-semibold text-red-700">Đang thiếu {assessmentForm.questionCount - finalAvailableQuestions} câu so với cấu hình. Hãy giảm số câu mỗi lượt hoặc bổ sung quiz bài học.</p>}
              {activeAssessmentMode === 'LESSON' && <>
              {/* Dynamic Questions Builder with Up/Down buttons (Request 8) */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm text-[#172554]">Ngân hàng câu hỏi ({quizPoolNames.length} nhóm · {assessmentForm.questions.length} câu)</h4>
                  <Button size="sm" variant="secondary" onClick={handleAddPool}>＋ Tạo nhóm</Button>
                </div>

                {/* Import câu hỏi từ Google Sheet / Google Doc */}
                <div className="p-4 bg-white border border-[#cbdbf5] rounded-2xl space-y-2">
                  <label className="block text-xs font-semibold text-[#172554]">
                    Nhập câu hỏi từ Google Sheet / Google Doc
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
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
                  <p className="text-[11px] text-[#737686] leading-relaxed">
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

                {quizPoolNames.map((poolName, poolIndex) => (
                  <details key={`pool-${poolIndex}`} className="rounded-2xl border border-blue-200 bg-white">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-bold text-[#172554]"><span>{poolName} · {assessmentForm.questions.filter((question) => (question.poolIndex ?? 0) === poolIndex).length} câu</span><span className="text-xs font-normal text-blue-600">Mở nhóm ▾</span></summary>
                    <div className="space-y-3 border-t border-blue-100 p-3">
                      <div className="flex gap-2"><input value={poolName} onChange={(e) => setQuizPoolNames((previous) => previous.map((name, index) => index === poolIndex ? e.target.value : name))} className="flex-1 rounded-xl border border-[#cbdbf5] px-3 py-2 text-sm"/><Button size="sm" variant="secondary" onClick={() => handleAddQuestion(poolIndex)}>＋ Tạo câu hỏi</Button><button type="button" onClick={() => handleRemovePool(poolIndex)} className="rounded-lg px-2 text-red-600 hover:bg-red-50">Xóa nhóm</button></div>
                {assessmentForm.questions.map((q, qIdx) => (q.poolIndex ?? 0) === poolIndex ? (
                  <details key={qIdx} className="group rounded-2xl border border-[#eff4ff] bg-[#f8f9ff]">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-[#172554]"><span>{quizPoolNames[q.poolIndex ?? 0] || 'Chưa có nhóm'} · Câu {qIdx + 1}</span><span className="max-w-[65%] truncate text-xs font-normal text-[#737686]">{q.questionText || 'Chưa nhập nội dung'}</span></summary>
                  <div className="space-y-3 border-t border-[#eff4ff] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-1.5 shrink-0 mt-1">
                        <span className="font-bold text-sm text-[#2563EB]">Câu {qIdx + 1}</span>
                        {/* Reorder Up/Down buttons */}
                        <div className="flex flex-col gap-0.5">
                          {qIdx > 0 && (
                            <button
                              type="button"
                              onClick={() => handleMoveQuestion(qIdx, 'up')}
                              className="text-[9px] text-[#737686] hover:text-[#2563EB] px-1 bg-white border border-[#cbdbf5] rounded hover:bg-blue-50"
                              title="Di chuyển câu hỏi lên"
                            >
                              ▲
                            </button>
                          )}
                          {qIdx < assessmentForm.questions.length - 1 && (
                            <button
                              type="button"
                              onClick={() => handleMoveQuestion(qIdx, 'down')}
                              className="text-[9px] text-[#737686] hover:text-[#2563EB] px-1 bg-white border border-[#cbdbf5] rounded hover:bg-blue-50"
                              title="Di chuyển câu hỏi xuống"
                            >
                              ▼
                            </button>
                          )}
                        </div>
                      </div>

                      <input
                        type="text"
                        required
                        value={q.questionText}
                        onChange={(e) => {
                          const qs = [...assessmentForm.questions];
                          qs[qIdx].questionText = e.target.value;
                          setAssessmentForm({ ...assessmentForm, questions: qs });
                        }}
                        placeholder="Nhập nội dung câu hỏi..."
                        className="flex-1 px-3 py-2 border border-[#cbdbf5] rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                      />
                      <select value={q.poolIndex ?? 0} onChange={(e) => {
                        const qs = [...assessmentForm.questions];
                        qs[qIdx].poolIndex = Number(e.target.value);
                        setAssessmentForm({ ...assessmentForm, questions: qs });
                      }} className="w-28 rounded-xl border border-[#cbdbf5] bg-white px-2 py-2 text-xs">
                        {quizPoolNames.map((name, index) => <option key={index} value={index}>{name || `Pool ${index + 1}`}</option>)}
                      </select>
                      <button
                        onClick={() => handleRemoveQuestion(qIdx)}
                        className="p-1.5 text-[#737686] hover:text-red-600 rounded-lg hover:bg-red-50 shrink-0"
                        title="Xóa câu hỏi này"
                      >
                        🗑️
                      </button>
                    </div>

                    {/* Question Config: Type, Points, Duration */}
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <div>
                        <label className="font-semibold text-[#434655] mr-1.5">Loại câu:</label>
                        <select
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
                      <textarea
                        rows={2}
                        value={q.explanation ?? ''}
                        onChange={(e) => {
                          const qs = [...assessmentForm.questions];
                          qs[qIdx].explanation = e.target.value;
                          setAssessmentForm({ ...assessmentForm, questions: qs });
                        }}
                        placeholder="Giải thích tại sao đáp án đúng (tùy chọn)"
                        className="w-full px-3 py-2 border border-[#cbdbf5] rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                      />
                    </div>

                    {/* Options Editor */}
                    <div className="space-y-2 pt-2 border-t border-[#eff4ff]">
                      <span className="text-xs font-semibold text-[#737686]">
                        {q.type === 'SINGLE_CHOICE'
                          ? 'Chọn 1 nút tròn làm đáp án đúng:'
                          : q.type === 'MULTIPLE_CHOICE'
                          ? 'Tích chọn các đáp án đúng:'
                          : 'Chọn Đúng hoặc Sai:'}
                      </span>

                      {q.options.map((opt, oIdx) => (
                        <div key={oIdx} className="flex items-center gap-2">
                          <input
                            type={q.type === 'SINGLE_CHOICE' ? 'radio' : 'checkbox'}
                            name={`correct-${qIdx}`}
                            checked={opt.isCorrect}
                            onChange={() => {
                              const qs = [...assessmentForm.questions];
                              if (q.type === 'SINGLE_CHOICE') {
                                qs[qIdx].options = qs[qIdx].options.map((o, idx) => ({
                                  ...o,
                                  isCorrect: idx === oIdx,
                                }));
                              } else {
                                qs[qIdx].options[oIdx].isCorrect = !qs[qIdx].options[oIdx].isCorrect;
                              }
                              setAssessmentForm({ ...assessmentForm, questions: qs });
                            }}
                            className="h-4 w-4 text-[#2563EB] shrink-0 cursor-pointer"
                          />
                          <input
                            type="text"
                            required
                            value={opt.optionText}
                            onChange={(e) => {
                              const qs = [...assessmentForm.questions];
                              qs[qIdx].options[oIdx].optionText = e.target.value;
                              setAssessmentForm({ ...assessmentForm, questions: qs });
                            }}
                            className="flex-1 px-3 py-1.5 border border-[#cbdbf5] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#2563EB] disabled:bg-slate-100"
                          />
                          {q.options.length > 2 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveOption(qIdx, oIdx)}
                              className="text-[#737686] hover:text-red-600 font-bold px-1.5"
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
                ) : null)}
                    </div>
                  </details>
                ))}
              </div>
              </>}

              <div className="flex items-center justify-between pt-3 border-t border-[#eff4ff]">
                <div>
                  {activeLessonForAssessment?.assessment && !isPublished && (
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
