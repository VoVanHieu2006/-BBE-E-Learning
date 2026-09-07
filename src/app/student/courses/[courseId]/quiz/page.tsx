'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { apiFetch } from '@/lib/api/client';

export default function StudentQuizPage({ params }: { params: { courseId: string } }) {
  const router = useRouter();
  const [assessment, setAssessment] = useState<any>(null);
  const [attempt, setAttempt] = useState<any>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    initQuiz();
  }, [params.courseId]);

  async function initQuiz() {
    setLoading(true);
    setError('');

    // 1. Fetch course assessment
    const assessRes = await apiFetch(`/api/v1/courses/${params.courseId}/assessment`);
    if (!assessRes.ok || !assessRes.data) {
      setError(assessRes.error?.message || 'Không tìm thấy bài kiểm tra cho khóa học này.');
      setLoading(false);
      return;
    }

    const assessData = assessRes.data;
    setAssessment(assessData);

    const assessmentId = assessData.assessmentId || assessData.id;

    // 2. Start new attempt
    const attemptRes = await apiFetch(`/api/v1/assessments/${assessmentId}/attempts`, {
      method: 'POST',
    });

    if (!attemptRes.ok || !attemptRes.data) {
      setError(attemptRes.error?.message || 'Không thể bắt đầu lượt làm bài. Bạn có thể cần đợi 24h hoặc hoàn thành đủ bài học.');
      setLoading(false);
      return;
    }

    const attemptData = attemptRes.data;
    setAttempt(attemptData);

    const attemptId = attemptData.attemptId || attemptData.id;

    // 3. Load locally cached answers if reconnecting/reloading
    if (attemptId && typeof window !== 'undefined') {
      try {
        const cached = localStorage.getItem(`quiz_answers_${attemptId}`);
        if (cached) {
          setSelectedAnswers(JSON.parse(cached));
        }
      } catch {}
    }

    // 4. Calculate timer
    const questionCount = attemptData.questions?.length || assessData.questions?.length || 1;
    const totalMinutes = questionCount * 2;
    let initialSecs = totalMinutes * 60;

    if (attemptData.startedAt) {
      const elapsed = Math.floor((Date.now() - new Date(attemptData.startedAt).getTime()) / 1000);
      initialSecs = Math.max(0, initialSecs - elapsed);
    }
    setTimeLeft(initialSecs);
    setLoading(false);
  }

  // Timer countdown & Auto-submit
  useEffect(() => {
    if (loading || !attempt || timeLeft <= 0) return;

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
  }, [loading, attempt, timeLeft]);

  const handleSelectOption = (questionId: string, optionId: string) => {
    const updated = { ...selectedAnswers, [questionId]: optionId };
    setSelectedAnswers(updated);

    const attemptId = attempt?.attemptId || attempt?.id;
    if (attemptId && typeof window !== 'undefined') {
      try {
        localStorage.setItem(`quiz_answers_${attemptId}`, JSON.stringify(updated));
      } catch {}
    }

    // Send answer to server in background
    apiFetch(`/api/v1/attempts/${attemptId}/answers`, {
      method: 'POST',
      body: JSON.stringify({ questionId, selectedOptionId: optionId }),
    }).catch(() => null);
  };

  const handleAutoSubmit = async () => {
    const attemptId = attempt?.attemptId || attempt?.id;
    if (!attemptId) return;

    await apiFetch(`/api/v1/attempts/${attemptId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ autoSubmitted: true }),
    }).catch(() => null);

    if (typeof window !== 'undefined') {
      localStorage.removeItem(`quiz_answers_${attemptId}`);
    }
    router.push(`/final-quiz-result?attemptId=${attemptId}`);
  };

  const handleCancelQuiz = async () => {
    if (!window.confirm('Hủy bài kiểm tra? Lượt làm bài này sẽ không được tính điểm và bạn cần đợi 24h để làm lại.')) return;
    const attemptId = attempt?.attemptId || attempt?.id;
    if (attemptId) {
      await apiFetch(`/api/v1/attempts/${attemptId}`, { method: 'DELETE' }).catch(() => null);
      if (typeof window !== 'undefined') {
        localStorage.removeItem(`quiz_answers_${attemptId}`);
      }
    }
    router.push(`/student/courses/${params.courseId}`);
  };

  const handleSubmit = async () => {
    const attemptId = attempt?.attemptId || attempt?.id;
    if (!attemptId) return;

    setSubmitting(true);
    const res = await apiFetch(`/api/v1/attempts/${attemptId}/submit`, {
      method: 'POST',
    });

    if (res.ok) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(`quiz_answers_${attemptId}`);
      }
      router.push(`/final-quiz-result?attemptId=${attemptId}`);
    } else {
      setError(res.error?.message || 'Lỗi nộp bài kiểm tra.');
      setSubmitting(false);
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const questions = attempt?.questions || assessment?.questions || [];

  return (
    <main className="min-h-screen bg-[#f8f9ff] py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header Bar */}
        <div className="flex items-center justify-between bg-white px-6 py-4 rounded-2xl border border-[#eff4ff] shadow-sm sticky top-4 z-40">
          <Link
            href={`/student/courses/${params.courseId}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-[#eff4ff] border border-[#cbdbf5] text-xs font-bold text-[#172554] hover:text-[#2563EB] transition-all"
          >
            ← Quay lại khóa học
          </Link>
          <div className="text-center">
            <h1 className="font-bold text-[#172554] text-lg" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              {assessment?.title || 'Bài kiểm tra cuối khóa'}
            </h1>
            <p className="text-xs text-[#737686]">Lượt làm bài #{attempt?.attemptNumber || 1}</p>
          </div>
          <div className="bg-red-50 text-red-700 px-3 py-1.5 rounded-xl text-sm font-bold flex items-center gap-1.5 border border-red-200">
            <span>⏱️</span>
            <span>{formatTimer(timeLeft)}</span>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-6 rounded-2xl text-center space-y-4 shadow-sm">
            <p className="font-semibold text-lg">{error}</p>
            <Link href={`/student/courses/${params.courseId}`}>
              <Button variant="outline">Quay lại khóa học</Button>
            </Link>
          </div>
        )}

        {loading ? (
          <div className="text-center py-20 text-[#737686]">Đang tải bài kiểm tra...</div>
        ) : !error && (
          <div className="space-y-6">
            {questions.map((q: any, qIdx: number) => {
              const qId = q.questionId || q.id;
              return (
                <Card key={qId} className="p-6">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <h3 className="text-base font-bold text-[#172554]">
                      Câu {qIdx + 1}: {q.questionText}
                    </h3>
                    <span className="text-xs font-semibold px-2.5 py-1 bg-[#eff4ff] text-[#2563EB] rounded-full shrink-0">
                      {q.points || 10} điểm
                    </span>
                  </div>

                  <div className="space-y-3">
                    {q.options?.map((opt: any) => {
                      const oId = opt.optionId || opt.id;
                      const isSelected = selectedAnswers[qId] === oId;

                      return (
                        <label
                          key={oId}
                          onClick={() => handleSelectOption(qId, oId)}
                          className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all cursor-pointer select-none ${
                            isSelected
                              ? 'bg-[#eff4ff] border-[#2563EB] text-[#172554] font-semibold'
                              : 'bg-white border-[#cbdbf5]/60 text-[#434655] hover:bg-[#f8f9ff] hover:border-[#cbdbf5]'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`question-${qId}`}
                            checked={isSelected}
                            onChange={() => handleSelectOption(qId, oId)}
                            className="h-4 w-4 text-[#2563EB] shrink-0"
                          />
                          <span className="text-sm">{opt.optionText}</span>
                        </label>
                      );
                    })}
                  </div>
                </Card>
              );
            })}

            {/* Bottom Actions */}
            <div className="flex items-center justify-between p-6 bg-white rounded-2xl border border-[#eff4ff] shadow-sm">
              <Button variant="outline" onClick={handleCancelQuiz}>
                Hủy bài kiểm tra
              </Button>
              <Button loading={submitting} loadingText="Đang nộp bài..." onClick={handleSubmit} size="lg">
                Nộp bài kiểm tra →
              </Button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
