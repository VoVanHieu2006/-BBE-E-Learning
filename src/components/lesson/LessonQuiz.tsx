'use client';
import { useState, useEffect } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';

interface LessonQuizProps {
  lessonId: string;
  assessmentId: string;
  lessonTitle: string;
  accessToken: string;
  isCompleted: boolean;
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

  useEffect(() => {
    initQuiz();
  }, [assessmentId]);

  async function initQuiz() {
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
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message || 'Chưa thể bắt đầu bài kiểm tra. Hãy đảm bảo bạn đã xem video bài giảng.');
        setLoading(false);
        return;
      }

      setAttempt(data);

      // Restore cached answers if any
      const attemptId = data.attemptId || data.id;
      if (attemptId && typeof window !== 'undefined') {
        try {
          const cached = localStorage.getItem(`quiz_answers_${attemptId}`);
          if (cached) setSelectedAnswers(JSON.parse(cached));
        } catch {}
      }

      // Calculate timer
      const questionCount = data.questions?.length || 1;
      const totalMinutes = questionCount * 2;
      let initialSecs = totalMinutes * 60;
      if (data.startedAt) {
        const elapsed = Math.floor((Date.now() - new Date(data.startedAt).getTime()) / 1000);
        initialSecs = Math.max(0, initialSecs - elapsed);
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
    if (loading || !attempt || timeLeft <= 0 || result) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleAutoSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [loading, attempt, timeLeft, result]);

  // Tab close / navigation warning & auto cancel on page close
  useEffect(() => {
    if (!attempt || result) return;
    const attemptId = attempt.attemptId || attempt.id;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'Bạn đang làm bài kiểm tra. Nếu rời khỏi trang, bài thi sẽ bị hủy và bạn phải chờ 24h mới được làm lại!';
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
    if (result || submitting) return;
    onToast?.('info', 'Hết thời gian làm bài! Đang tự động nộp bài...', 'Hết giờ');
    handleSubmit();
  };

  const handleSubmit = async () => {
    const attemptId = attempt?.attemptId || attempt?.id;
    if (!attemptId || submitting) return;

    setSubmitting(true);
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
        setResult(data);
        if (typeof window !== 'undefined') {
          localStorage.removeItem(`quiz_answers_${attemptId}`);
        }

        onSubmitted?.(data);

        if (data.passed) {
          onQuizPassed();
          onToast?.('success', `Chúc mừng! Bạn đạt ${data.scorePercent}% và đã hoàn thành bài học!`, 'Đạt yêu cầu');
        } else {
          onToast?.('error', `Bạn đạt ${data.scorePercent}%. Cần đạt từ 85% để vượt qua bài học. Bạn có thể làm lại sau 24h!`, 'Chưa đạt');
        }
      } else {
        onToast?.('error', data?.error?.message || 'Lỗi nộp bài kiểm tra.', 'Lỗi');
      }
    } catch (e: any) {
      onToast?.('error', e?.message || 'Lỗi kết nối khi nộp bài.', 'Lỗi');
    } finally {
      setSubmitting(false);
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
      onToast?.('info', data.message || 'Đã hủy bài kiểm tra. Bạn cần đợi 24 giờ để làm lại.', 'Đã hủy bài làm');
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
            <span>📝</span> Bài kiểm tra bài học
          </h3>
          <p className="text-xs text-[#737686] mt-0.5">
            Cần đạt tối thiểu <strong>85%</strong> điểm để vượt qua bài học.
          </p>
        </div>

        {attempt && !result && (
          <div className="flex items-center gap-2 bg-red-50 text-red-700 px-3 py-1.5 rounded-xl text-xs font-bold border border-red-200 self-start sm:self-auto">
            <span>⏱️</span>
            <span>Thời gian còn lại: {formatTimer(timeLeft)}</span>
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
              ? 'Bạn đã hoàn thành xuất sắc bài học này! Hãy quay lại bài học để tiếp tục bài giảng tiếp theo.'
              : 'Bạn cần đạt từ 85% điểm trở lên để vượt qua bài học. Theo quy chế, bạn có thể làm lại sau 24 giờ.'}
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
                    <span className="text-[#2563EB] mr-1.5">Câu {qIdx + 1}:</span>
                    {q.questionText}
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
                  disabled={Object.keys(selectedAnswers).length === 0 || cancelling}
                  onClick={handleSubmit}
                  className="px-6 py-2.5 rounded-xl shadow-md flex-1 sm:flex-initial"
                >
                  Nộp bài kiểm tra →
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal xác nhận Hủy bài kiểm tra */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <Card className="max-w-md w-full p-6 space-y-4 shadow-2xl border border-red-200">
            <div className="flex items-center gap-3 text-red-600">
              <span className="text-2xl">⚠️</span>
              <h4 className="text-base font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                Xác nhận hủy bài kiểm tra?
              </h4>
            </div>
            <p className="text-xs text-[#434655] leading-relaxed">
              Nếu hủy, bài làm này sẽ <strong>không được tính kết quả</strong>. Bạn sẽ phải <strong>chờ 24 giờ</strong> nữa mới có thể bắt đầu làm lại bài kiểm tra này.
            </p>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800">
              💡 Bạn nên làm tiếp và nộp bài để được ghi nhận điểm số thay vì hủy.
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
          </Card>
        </div>
      )}
    </Card>
  );
}
