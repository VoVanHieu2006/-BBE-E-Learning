'use client';
import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { QUIZ_COOLDOWN_MINUTES } from '@/lib/config/quiz';
import { clearApiCache } from '@/lib/api/client';

interface LessonQuizProps {
  lessonId: string;
  assessmentId: string;
  lessonTitle: string;
  accessToken: string;
  isCompleted: boolean;
  forceNew?: boolean;
  assessmentLabel?: string;
  returnHref?: string;
  onQuizPassed: () => void;
  onCancel?: (cooldownInfo?: any) => void;
  onSubmitted?: (result?: any) => void;
  onToast?: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
}

export default function LessonQuiz({
  lessonId,
  assessmentId,
  lessonTitle,
  accessToken,
  isCompleted,
  forceNew = false,
  assessmentLabel = 'Bài kiểm tra bài học',
  returnHref,
  onQuizPassed,
  onCancel,
  onSubmitted,
  onToast,
}: LessonQuizProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState<any>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);

  const isSubmittingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    initQuiz();
  }, [assessmentId]);

  async function initQuiz() {
    isSubmittingRef.current = false;
    setLoading(true);
    setError('');
    setResult(null);
    setSelectedAnswers({});

    if (!accessToken) {
      setError('Vui lòng đăng nhập để thực hiện bài kiểm tra.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/v1/assessments/${assessmentId}/attempts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ forceNew: Boolean(forceNew) }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message || 'Chưa thể bắt đầu bài kiểm tra. Hãy đảm bảo bạn đã xem video bài giảng.');
        setLoading(false);
        return;
      }

      setAttempt(data);

      const attemptId = data.attemptId || data.id;

      // BR-04: Phân biệt rõ giữa khôi phục bài đang làm dở (data.isResumed === true)
      // và bắt đầu một lượt làm bài mới (không tự động điền đáp án của lượt trước)
      if (data.isResumed && attemptId) {
        let draftAnswers: Record<string, string> = data.existingAnswers || {};
        if (typeof window !== 'undefined') {
          try {
            const cached = localStorage.getItem(`quiz_answers_${attemptId}`);
            if (cached) {
              draftAnswers = { ...draftAnswers, ...JSON.parse(cached) };
            }
          } catch {}
        }
        setSelectedAnswers(draftAnswers);
      } else {
        // Lượt làm mới hoàn toàn: reset về rỗng và dọn dẹp bộ nhớ nháp cũ
        setSelectedAnswers({});
      }

      // The backend's expiresAt is authoritative. It is derived from the
      // assessment's configured duration, never from the number of bank
      // questions or a hard-coded frontend value.
      const configuredMinutes = Number(data.durationMinutes || 0);
      let initialSecs = configuredMinutes > 0 ? configuredMinutes * 60 : 0;
      const expiresAtMs = data.expiresAt ? new Date(data.expiresAt).getTime() : Number.NaN;
      if (Number.isFinite(expiresAtMs)) {
        initialSecs = Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000));
      }
      setTimeLeft(initialSecs);
    } catch (e: any) {
      setError(e?.message || 'Lỗi kết nối khi khởi tạo bài kiểm tra.');
    } finally {
      setLoading(false);
    }
  }

  // Timer countdown
  useEffect(() => {
    if (loading || !attempt || timeLeft <= 0 || result || isSubmittingRef.current) return;

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          handleAutoSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [loading, attempt, timeLeft, result]);

  // Tab close / navigation warning & auto cancel on page close
  useEffect(() => {
    if (!attempt || result) return;
    const attemptId = attempt.attemptId || attempt.id;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'Bạn đang làm bài kiểm tra. Nếu rời khỏi trang, bài thi sẽ bị hủy.';
      return e.returnValue;
    };

    const handlePageHide = () => {
      if (attemptId && !result) {
        // Tự động gửi tín hiệu hủy khi đóng tab/trình duyệt
        try {
          navigator.sendBeacon(`/api/v1/attempts/${attemptId}/cancel`, JSON.stringify({ reason: 'TAB_CLOSED' }));
        } catch {}
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [attempt, result]);

  const handleSelectOption = (questionId: string, optionId: string) => {
    if (result) return; // Frozen after submit
    const updated = { ...selectedAnswers, [questionId]: optionId };
    setSelectedAnswers(updated);

    const attemptId = attempt?.attemptId || attempt?.id;
    if (attemptId && typeof window !== 'undefined') {
      try {
        localStorage.setItem(`quiz_answers_${attemptId}`, JSON.stringify(updated));
      } catch {}
    }
  };

  const handleAutoSubmit = async () => {
    if (result || submitting || isSubmittingRef.current) return;
    onToast?.('info', 'Hết thời gian làm bài! Đang tự động nộp bài...', 'Hết giờ');
    handleSubmit();
  };

  const handleSubmit = async () => {
    const attemptId = attempt?.attemptId || attempt?.id;
    if (!attemptId || submitting || result || isSubmittingRef.current) return;

    // Synchronous mutex to prevent race conditions and double-submits
    isSubmittingRef.current = true;
    setSubmitting(true);

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    let isSuccess = false;
    try {
      const res = await fetch(`/api/v1/attempts/${attemptId}/submit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ answers: selectedAnswers }),
      });

      const data = await res.json();
      if (res.ok) {
        isSuccess = true;
        setResult(data);
        clearApiCache('/api/v1/courses');
        clearApiCache('/api/v1/lessons');
        clearApiCache('/api/v1/learning');
        clearApiCache('/api/v1/members/me');
        clearApiCache('/api/v1/stars/me');
        clearApiCache('/api/v1/streak');
        if (typeof window !== 'undefined') {
          try {
            localStorage.removeItem(`quiz_answers_${attemptId}`);
            sessionStorage.setItem('bbe_last_progress_update', Date.now().toString());
            window.dispatchEvent(new CustomEvent('bbe-progress-updated', {
              detail: { lessonId, assessmentId, passed: Boolean(data.passed) }
            }));
          } catch {}
        }

        onSubmitted?.(data);

        if (data.passed) {
          onQuizPassed();
          onToast?.('success', `Chúc mừng! Bạn đạt ${data.scorePercent}% và đã vượt qua ${assessmentLabel.toLowerCase()}!`, 'Đạt yêu cầu');
        } else {
          onToast?.('error', `Bạn đạt ${data.scorePercent}%. Cần đạt từ 85% để vượt qua bài học. Sau thời gian giãn cách ${QUIZ_COOLDOWN_MINUTES} phút bạn có thể làm lại.`, 'Chưa đạt');
        }
      } else {
        onToast?.('error', data?.error?.message || 'Lỗi nộp bài kiểm tra.', 'Lỗi');
      }
    } catch (e: any) {
      onToast?.('error', e?.message || 'Lỗi kết nối khi nộp bài.', 'Lỗi');
    } finally {
      setSubmitting(false);
      // If failed, release mutex so user can try submitting again
      if (!isSuccess) {
        isSubmittingRef.current = false;
      }
    }
  };

  const handleCancelQuiz = async () => {
    const attemptId = attempt?.attemptId || attempt?.id;
    if (!attemptId || cancelling) return;

    setCancelling(true);
    try {
      const res = await fetch(`/api/v1/attempts/${attemptId}/cancel`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      const data = await res.json();
      if (typeof window !== 'undefined') {
        localStorage.removeItem(`quiz_answers_${attemptId}`);
      }
      setShowCancelModal(false);
      onToast?.('info', data.message || `Đã hủy bài kiểm tra. Cần đợi ${QUIZ_COOLDOWN_MINUTES} phút trước khi làm lại.`, 'Đã hủy bài làm');
      onCancel?.(data);
    } catch (e: any) {
      onToast?.('error', e?.message || 'Lỗi khi hủy bài kiểm tra.', 'Lỗi');
    } finally {
      setCancelling(false);
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const questions = attempt?.questions || [];

  return (
    <Card className="p-6 border border-[#eff4ff] shadow-sm space-y-6">
      {/* Quiz Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-[#eff4ff] gap-3">
        <div>
          <h3
            className="text-base font-bold text-[#172554] flex items-center gap-2"
            style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}
          >
            <span>📝</span> {assessmentLabel}
          </h3>
          <p className="text-xs text-[#737686] mt-0.5">
            {attempt ? `${questions.length} câu hỏi trong lượt này` : 'Đang tải cấu hình đề'} · Cần đạt tối thiểu <strong>85%</strong> điểm để vượt qua bài học.
          </p>
        </div>

        {attempt && !result && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 bg-[#eff4ff] text-[#2563EB] px-3 py-1.5 rounded-xl text-xs font-bold border border-[#cbdbf5]" title="Số câu tổng của lượt làm bài">
              {questions.length} câu · {Math.round(timeLeft / 60)} phút còn lại
            </span>
            <div className="flex items-center gap-2 bg-red-50 text-red-700 px-3 py-1.5 rounded-xl text-xs font-bold border border-red-200">
              <span>⏱️</span>
              <span>Còn lại: {formatTimer(timeLeft)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 p-5 rounded-2xl text-center space-y-3">
          <p className="text-base font-bold">⚠️ Chưa thể làm bài kiểm tra</p>
          <p className="text-xs text-amber-800 leading-relaxed max-w-md mx-auto">{error}</p>
          <Button size="sm" variant="outline" onClick={() => onCancel?.()}>
            ← Quay lại
          </Button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-3">
          <div className="w-8 h-8 border-3 border-[#2563EB] border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs font-medium">Đang nạp đề kiểm tra...</span>
        </div>
      )}

      {/* Result Display Banner */}
      {result && (
        <div
          className={`p-6 rounded-2xl border-2 text-center space-y-3 animate-fadeIn ${
            result.passed
              ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950'
              : 'bg-orange-50/80 border-orange-300 text-orange-950'
          }`}
        >
          <span className="text-4xl block">{result.passed ? '🎉' : '📚'}</span>
          <h4 className="text-lg font-bold">
            {result.passed ? 'Chúc mừng! Bạn đã hoàn thành bài kiểm tra' : 'Chưa đạt điểm tối thiểu'}
          </h4>
          <div className="flex items-center justify-center gap-4 text-xs font-semibold">
            <span className="px-3 py-1 bg-white rounded-lg shadow-2xs">
              Điểm: <strong>{result.scorePercent}%</strong> ({result.score}/{result.totalPoints} điểm)
            </span>
            <span
              className={`px-3 py-1 rounded-lg ${
                result.passed ? 'bg-emerald-600 text-white' : 'bg-orange-600 text-white'
              }`}
            >
              {result.passed ? '✓ Đạt yêu cầu (Passed)' : '✗ Chưa đạt'}
            </span>
          </div>
          <p className="text-xs max-w-lg mx-auto opacity-90 leading-relaxed">
            {result.passed
              ? `Bạn đã vượt qua ${assessmentLabel.toLowerCase()}! Hãy quay lại lộ trình để tiếp tục.`
              : 'Bạn cần đạt từ 85% điểm trở lên để vượt qua bài học. Sau giãn cách ' + QUIZ_COOLDOWN_MINUTES + ' phút bạn có thể làm lại.'}
          </p>
        </div>
      )}

      {/* Questions list */}
      {!loading && !error && questions.length > 0 && (
        <div className="space-y-5">
          {questions.map((q: any, qIdx: number) => {
            const qId = q.questionId || q.id;
            const answerResult = result?.answers?.find((a: any) => a.questionId === qId);

            return (
              <div
                key={qId}
                className="p-5 bg-[#f8f9ff] border border-[#eff4ff] rounded-2xl space-y-3 transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <h4 className="font-bold text-sm text-[#172554] leading-relaxed">
                    <span className="text-[#2563EB] mr-1.5 whitespace-nowrap">Câu <span className="tabular-nums">{qIdx + 1}</span>/{questions.length}:</span>
                    <span>{q.questionText}</span>
                  </h4>
                  {answerResult && (
                    <span
                      className={`shrink-0 text-xs px-2.5 py-0.5 rounded-full font-bold ${
                        answerResult.isCorrect
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-rose-100 text-rose-700'
                      }`}
                    >
                      {answerResult.isCorrect ? '✓ Đúng' : '✗ Sai'}
                    </span>
                  )}
                </div>

                {/* Options list */}
                <div className="space-y-2 pt-1">
                  {q.options?.map((opt: any) => {
                    const oId = opt.optionId || opt.id;
                    const isSelected = selectedAnswers[qId] === oId;
                    const isCorrectAnswer = answerResult?.correctOptionId === oId;

                    let optStyle = 'border-[#eff4ff] bg-white hover:border-[#cbdbf5] text-[#434655]';
                    if (isSelected && !result) {
                      optStyle = 'border-[#2563EB] bg-[#eff4ff] text-[#172554] font-semibold';
                    } else if (result) {
                      if (isCorrectAnswer) {
                        optStyle = 'border-emerald-400 bg-emerald-50 text-emerald-900 font-semibold';
                      } else if (isSelected && !answerResult?.isCorrect) {
                        optStyle = 'border-rose-400 bg-rose-50 text-rose-900 font-semibold';
                      }
                    }

                    return (
                      <label
                        key={oId}
                        onClick={() => handleSelectOption(qId, oId)}
                        className={`flex items-center gap-3 p-3 rounded-xl border-2 text-xs transition cursor-pointer select-none ${optStyle}`}
                      >
                        <input
                          type="radio"
                          disabled={Boolean(result)}
                          name={`q-${qId}`}
                          checked={isSelected}
                          onChange={() => handleSelectOption(qId, oId)}
                          className="h-4 w-4 text-[#2563EB] shrink-0 cursor-pointer"
                        />
                        <span className="flex-1 leading-relaxed">{opt.optionText}</span>
                        {result && isCorrectAnswer && (
                          <span className="text-emerald-600 font-bold text-[11px]">✓ Đáp án đúng</span>
                        )}
                      </label>
                    );
                  })}
                </div>

                {/* Explanation on result */}
                {result && answerResult?.explanation && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-[#172554] space-y-1">
                    <span className="font-bold text-amber-800">💡 Giải thích:</span>
                    <p className="text-slate-700">{answerResult.explanation}</p>
                  </div>
                )}
              </div>
            );
          })}

          {/* Submit & Cancel Actions */}
          {!result && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-[#eff4ff]">
              <span className="text-xs text-[#737686]">
                Đã chọn: {Object.keys(selectedAnswers).length}/{questions.length} câu
              </span>
              <div className="flex items-center gap-2.5 w-full sm:w-auto">
                <Button
                  variant="outline"
                  size="md"
                  disabled={submitting || cancelling}
                  onClick={() => setShowCancelModal(true)}
                  className="!text-rose-600 hover:!bg-rose-50 !border-rose-200 px-4 py-2.5 rounded-xl font-bold flex-1 sm:flex-initial"
                >
                  ✕ Hủy bài kiểm tra
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  loading={submitting}
                  disabled={Object.keys(selectedAnswers).length === 0 || cancelling || submitting || isSubmittingRef.current || Boolean(result)}
                  onClick={handleSubmit}
                  className="px-6 py-2.5 rounded-xl shadow-md flex-1 sm:flex-initial"
                >
                  Nộp bài kiểm tra →
                </Button>
              </div>
            </div>
          )}

          {/* Sau khi đã nộp và có kết quả: liên kết quay về lớp học */}
          {result && (
            <div className="flex justify-center pt-4 border-t border-[#eff4ff]">
              <Link
                href={returnHref || `/student/learning/${lessonId}`}
                onClick={() => {
                  clearApiCache('/api/v1/courses');
                  clearApiCache('/api/v1/lessons');
                  clearApiCache('/api/v1/learning');
                  clearApiCache('/api/v1/members/me');
                  clearApiCache('/api/v1/stars/me');
                  clearApiCache('/api/v1/streak');
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('bbe-progress-updated', {
                      detail: { lessonId, assessmentId, passed: Boolean(result?.passed) }
                    }));
                  }
                }}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#2563EB] hover:bg-[#1d4ed8] text-white text-xs font-bold shadow-md transition hover:scale-[1.02] active:scale-[0.98]"
              >
                <span>← Trở về lớp học</span>
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Modal xác nhận Hủy bài kiểm tra — portal ra document.body nên luôn
          căn giữa viewport kể cả khi người học đã cuộn xuống sâu. */}
      <Modal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        maxWidth="max-w-md"
        closeOnBackdrop={false}
        className=""
      >
        <div className="p-6 space-y-4 border-t-8 border-rose-200">
          <div className="flex items-center gap-3 text-rose-600">
            <span className="text-2xl">⚠️</span>
            <h4 className="text-base font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              Xác nhận hủy bài kiểm tra?
            </h4>
          </div>
          <p className="text-xs text-[#434655] leading-relaxed">
              Nếu hủy, bài làm này sẽ <strong>không được tính kết quả</strong> và bạn sẽ chờ{' '}
            <strong>{QUIZ_COOLDOWN_MINUTES} phút</strong> nữa mới bắt đầu được lượt làm khác.
          </p>
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800">
            💡 Bạn nên làm tiếp và nộp bài để được ghi nhận điểm số thay vì hủy. Bấm Escape hoặc "Tiếp tục làm bài" sẽ giữ nguyên bài của bạn.
          </div>
          <div className="flex gap-2.5 pt-2">
            <Button
              variant="outline"
              className="flex-1 font-bold"
              onClick={() => setShowCancelModal(false)}
              disabled={cancelling}
            >
              Tiếp tục làm bài
            </Button>
            <Button
              variant="primary"
              className="flex-1 !bg-rose-600 hover:!bg-rose-700 !text-white font-bold"
              loading={cancelling}
              onClick={handleCancelQuiz}
            >
              Xác nhận hủy
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
