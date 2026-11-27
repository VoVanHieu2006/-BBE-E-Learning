'use client';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { searchCourseQuestions, type QuizMatchField } from '@/lib/quiz-search';
import { courseSearchTarget, toSearchableSessions } from '@/lib/course-editor-search-ui';
import HighlightedText from './HighlightedText';
import type { CourseEditorState } from './useCourseEditor';

type Props = Pick<CourseEditorState,
  'isPublished' |
  'courseSearchSessions' |
  'courseQuestionBankLoading' |
  'courseQuestionBankError' |
  'loadCourseQuestionBank' |
  'openQuestionFromSearch'
>;

const MAX_RESULTS = 50;
const MATCH_LABEL: Record<QuizMatchField, string> = { question: 'Câu hỏi', option: 'Đáp án', explanation: 'Giải thích' };
const PANEL_ID = 'course-question-search-panel';

export default function CourseQuestionSearch({
  isPublished,
  courseSearchSessions,
  courseQuestionBankLoading,
  courseQuestionBankError,
  loadCourseQuestionBank,
  openQuestionFromSearch,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const needsLoad = open && !isPublished && !courseSearchSessions && !courseQuestionBankLoading && !courseQuestionBankError;

  useEffect(() => {
    if (needsLoad) void loadCourseQuestionBank();
  }, [needsLoad]);

  const results = useMemo(
    () => courseSearchSessions ? searchCourseQuestions(toSearchableSessions(courseSearchSessions), deferredQuery) : [],
    [courseSearchSessions, deferredQuery]
  );
  const trimmed = deferredQuery.trim();
  const waiting = !isPublished && !courseSearchSessions && !courseQuestionBankError;

  return (
    <Card className="p-6 border border-[#eff4ff] shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>Tìm câu hỏi toàn khóa học</h2>
          <p className="mt-1 text-xs text-[#6c6f7f]">Tìm trong nội dung câu hỏi, đáp án và giải thích của mọi quiz bài học, rồi mở thẳng đến đúng câu.</p>
        </div>
        <Button
          variant={open ? 'outline' : 'secondary'}
          aria-expanded={open}
          aria-controls={PANEL_ID}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Đóng tìm kiếm' : 'Tìm câu hỏi toàn khóa học'}
        </Button>
      </div>

      {open && (
        <div id={PANEL_ID} className="mt-4 space-y-3 border-t border-[#eff4ff] pt-4">
          <div className="relative">
            <label htmlFor="course-question-search-input" className="sr-only">Từ khóa tìm câu hỏi toàn khóa học</label>
            <input
              id="course-question-search-input"
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm nội dung câu hỏi, đáp án, giải thích..."
              className="w-full rounded-xl border border-[#cbdbf5] bg-white py-2.5 pl-4 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
            {query && (
              <button
                type="button"
                aria-label="Xóa từ khóa tìm kiếm"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-1.5 py-0.5 text-sm font-bold text-[#6c6f7f] hover:bg-slate-100 hover:text-[#172554]"
              >
                ✕
              </button>
            )}
          </div>
          <p className="text-[11px] text-[#6c6f7f]">
            {isPublished
              ? 'Đang tìm trong bản nháp hiện tại, gồm cả các thay đổi chưa bấm "Cập nhật khóa học".'
              : 'Đang tìm trong ngân hàng câu hỏi đã lưu của khóa học. Lưu quiz xong, kết quả sẽ tự tải lại.'}
          </p>

          {courseQuestionBankError ? (
            <div role="alert" className="flex flex-col gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
              <span>{courseQuestionBankError}</span>
              <Button size="sm" variant="outline" onClick={() => void loadCourseQuestionBank(true)}>Thử lại</Button>
            </div>
          ) : waiting || courseQuestionBankLoading ? (
            <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-sm font-semibold text-blue-800">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
              Đang tải ngân hàng câu hỏi của khóa học...
            </div>
          ) : !trimmed ? (
            <p className="rounded-xl border border-dashed border-[#cbdbf5] p-4 text-center text-sm text-[#6c6f7f]">Nhập từ khóa để tìm trong tất cả quiz của khóa học.</p>
          ) : results.length === 0 ? (
            <p role="status" className="rounded-xl border border-dashed border-[#cbdbf5] p-4 text-center text-sm font-semibold text-[#172554]">Không tìm thấy câu hỏi nào khớp với "{trimmed}"</p>
          ) : (
            <>
              <p role="status" aria-live="polite" className="text-xs font-semibold text-[#172554]">
                Tìm thấy {results.length} câu hỏi{results.length > MAX_RESULTS ? `, đang hiển thị ${MAX_RESULTS} câu đầu. Hãy nhập từ khóa cụ thể hơn để thu hẹp.` : ''}
              </p>
              <ul className="space-y-2">
                {results.slice(0, MAX_RESULTS).map((result) => {
                  const target = courseSearchTarget(result);
                  return (
                    <li key={`${result.lessonId}-${result.questionId ?? result.questionIndex}`}>
                      <button
                        type="button"
                        disabled={!target}
                        onClick={() => target && openQuestionFromSearch(target)}
                        className="w-full rounded-2xl border border-[#cbdbf5] bg-white p-3 text-left transition hover:border-[#2563EB] hover:bg-[#eff4ff] focus:outline-none focus:ring-2 focus:ring-[#2563EB] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="block text-[11px] font-semibold text-[#6c6f7f]">
                          {result.sessionTitle} › {result.lessonTitle} › {result.poolName || 'Chưa có nhóm'} › Câu #{result.questionIndex + 1}
                        </span>
                        <span className="mt-1 line-clamp-2 block text-sm font-semibold text-[#172554]">
                          <HighlightedText text={result.questionText} query={trimmed} />
                        </span>
                        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {result.matchedIn.map((field) => (
                            <span key={field} className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800">{MATCH_LABEL[field]}</span>
                          ))}
                          {result.matchedSnippet && result.matchedIn[0] !== 'question' && (
                            <span className="text-xs text-[#434655]"><HighlightedText text={result.matchedSnippet} query={trimmed} /></span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
