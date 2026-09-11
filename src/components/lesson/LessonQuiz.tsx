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
  onToast?: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
}

export default function LessonQuiz({
  lessonId,
  assessmentId,
  lessonTitle,
  accessToken,
  isCompleted,
  onQuizPassed,
  onToast,
}: LessonQuizProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState<any>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
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

        if (data.passed) {
          onQuizPassed();
        } else {
          onToast?.('error', `Bạn đạt ${data.scorePercent}%. Cần đạt từ 85% để qua bài. Hãy thử lại!`, 'Chưa đạt');
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
            Cần đạt tối thiểu <strong>85%</strong> điểm để mở khóa bài học tiếp theo.
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
          <Button size="sm" variant="outline" onClick={initQuiz}>
            Thử lại
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
              {result.passed ? '✓ Đạt yêu cầu (Passed)' : '✗ Cần làm lại'}
            </span>
          </div>
          <p className="text-xs max-w-lg mx-auto opacity-90 leading-relaxed">
            {result.passed
              ? 'Bạn đã hoàn thành xuất sắc bài học này! Nút "Bài tiếp theo →" đã được kích hoạt để bạn tiếp tục bài giảng tiếp theo.'
              : 'Bạn cần đạt từ 85% điểm trở lên để hoàn thành bài giảng này và sang bài tiếp theo. Hãy xem lại video và thử lại nhé!'}
          </p>
          {!result.passed && (
            <div className="pt-2">
              <Button variant="primary" size="sm" onClick={initQuiz}>
                🔄 Làm lại bài kiểm tra ngay
              </Button>
            </div>
          )}
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
                className="p-5 bg-[#f8f9ff] rounded-2xl border border-[#eff4ff] space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <h4 className="text-xs md:text-sm font-bold text-[#172554] leading-relaxed">
                    Câu {qIdx + 1}: {q.questionText}
                  </h4>
                  <span className="text-[11px] font-bold px-2 py-0.5 bg-[#eff4ff] text-[#2563EB] rounded-lg shrink-0">
                    {q.points || 10} điểm
                  </span>
                </div>

                {/* Options */}
                <div className="space-y-2">
                  {q.options?.map((opt: any) => {
                    const oId = opt.optionId || opt.id;
                    const isSelected = selectedAnswers[qId] === oId;
                    const isCorrectAnswer = answerResult?.correctOptionId === oId;

                    let optStyle =
                      'bg-white border-[#cbdbf5]/70 text-[#434655] hover:bg-[#eff4ff] hover:border-[#2563EB]';

                    if (isSelected) {
                      optStyle = 'bg-[#eff4ff] border-[#2563EB] text-[#172554] font-bold';
                    }

                    if (result) {
                      if (isCorrectAnswer) {
                        optStyle = 'bg-emerald-50 border-emerald-400 text-emerald-800 font-bold';
                      } else if (isSelected && !answerResult?.isCorrect) {
                        optStyle = 'bg-red-50 border-red-300 text-red-700 font-semibold';
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

          {/* Submit Action */}
          {!result && (
            <div className="flex items-center justify-between pt-4 border-t border-[#eff4ff]">
              <span className="text-xs text-[#737686]">
                Đã chọn: {Object.keys(selectedAnswers).length}/{questions.length} câu
              </span>
              <Button
                variant="primary"
                size="md"
                loading={submitting}
                disabled={Object.keys(selectedAnswers).length === 0}
                onClick={handleSubmit}
                className="px-6 py-2.5 rounded-xl shadow-md"
              >
                Nộp bài kiểm tra →
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
