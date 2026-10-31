'use client';
import Link from 'next/link';
import { useState, useEffect, useRef, useCallback } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { QUIZ_COOLDOWN_MINUTES } from '@/lib/config/quiz';
import { clearApiCache } from '@/lib/api/client';
import {
  QuestionNavState,
  countAnswered,
  formatCountdown,
  questionNavState,
  quizDeadlineMs,
  secondsUntil,
  toggleFlag,
} from '@/lib/quiz-navigator';

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

const LONG_PRESS_MS = 500;
const AUTOSAVE_DELAY_MS = 700;

const NAV_STYLES: Record<QuestionNavState, string> = {
  unanswered: 'bg-white text-[#434655] border-slate-300 hover:border-[#2563EB]',
  answered: 'bg-[#2563EB] text-white border-[#2563EB] hover:bg-[#1d4ed8]',
  flagged: 'bg-amber-100 text-amber-900 border-amber-500 hover:bg-amber-200',
};

const NAV_LABELS: Record<QuestionNavState, string> = {
  unanswered: 'chưa làm',
  answered: 'đã trả lời',
  flagged: 'đã gắn cờ',
};

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
  const [flagged, setFlagged] = useState<Set<string>>(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [hasDeadline, setHasDeadline] = useState(false);
  const [timeUp, setTimeUp] = useState(false);
  const [stickyTop, setStickyTop] = useState(0);
  const [showMobileNav, setShowMobileNav] = useState(false);

  const isSubmittingRef = useRef(false);
  const deadlineRef = useRef<number | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredAtRef = useRef(0);

  const attemptId: string | undefined = attempt?.attemptId || attempt?.id;
  const questions: any[] = attempt?.questions || [];
  const questionIds = questions.map((q: any) => q.questionId || q.id);
  const answeredCount = countAnswered(questionIds, selectedAnswers);
  const locked = Boolean(result) || timeUp;

  useEffect(() => {
    initQuiz();
  }, [assessmentId]);

  async function initQuiz() {
    isSubmittingRef.current = false;
    setLoading(true);
    setError('');
    setResult(null);
    setSelectedAnswers({});
    setFlagged(new Set());
    setTimeUp(false);
    deadlineRef.current = null;

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

      const newAttemptId = data.attemptId || data.id;

      // BR-04: Phân biệt rõ giữa khôi phục bài đang làm dở (data.isResumed === true)
      // và bắt đầu một lượt làm bài mới (không tự động điền đáp án của lượt trước)
      if (data.isResumed && newAttemptId) {
        let draftAnswers: Record<string, string> = data.existingAnswers || {};
        if (typeof window !== 'undefined') {
          try {
            const cached = localStorage.getItem(`quiz_answers_${newAttemptId}`);
            if (cached) {
              draftAnswers = { ...draftAnswers, ...JSON.parse(cached) };
            }
            const cachedFlags = localStorage.getItem(`quiz_flags_${newAttemptId}`);
            if (cachedFlags) setFlagged(new Set(JSON.parse(cachedFlags)));
          } catch {}
        }
        setSelectedAnswers(draftAnswers);
      } else {
        // Lượt làm mới hoàn toàn: reset về rỗng và dọn dẹp bộ nhớ nháp cũ
        setSelectedAnswers({});
      }

      // The backend's expiresAt is authoritative. It is derived from the
      // assessment's configured duration, never from the number of bank
      // questions or a hard-coded frontend value. The countdown is recomputed
      // from this deadline on every tick so throttled background tabs stay exact.
      const deadline = quizDeadlineMs(data.expiresAt, data.durationMinutes, Date.now());
      deadlineRef.current = deadline;
      setHasDeadline(deadline !== null);
      setTimeLeft(deadline === null ? 0 : secondsUntil(deadline, Date.now()));
    } catch (e: any) {
      setError(e?.message || 'Lỗi kết nối khi khởi tạo bài kiểm tra.');
    } finally {
      setLoading(false);
    }
  }

  // Countdown: when it reaches zero, answers are locked and the time-up modal opens.
  useEffect(() => {
    if (loading || !attempt || result || timeUp || deadlineRef.current === null) return;
    const tick = () => {
      const left = secondsUntil(deadlineRef.current!, Date.now());
      setTimeLeft(left);
      if (left <= 0) setTimeUp(true);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [loading, attempt, result, timeUp]);

  // Save answers on the server while the learner works, so a late time-up submit
  // (or the scheduled auto-submit) still grades what was chosen before expiry.
  useEffect(() => {
    if (!attemptId || locked || isSubmittingRef.current || !Object.keys(selectedAnswers).length) return;
    const timer = setTimeout(() => {
      fetch(`/api/v1/attempts/${attemptId}/answers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: selectedAnswers }),
      }).catch(() => {});
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [attemptId, selectedAnswers, locked, accessToken]);

  // Keep the timer/navigator just below the page's sticky header.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const header = document.querySelector('[data-quiz-header]');
        const bottom = header ? Math.max(0, Math.round(header.getBoundingClientRect().bottom)) : 0;
        setStickyTop((prev) => (prev === bottom ? prev : bottom));
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, []);

  // Tab close / navigation warning & auto cancel on page close
  useEffect(() => {
    if (!attempt || result) return;
    const currentAttemptId = attempt.attemptId || attempt.id;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'Bạn đang làm bài kiểm tra. Nếu rời khỏi trang, bài thi sẽ bị hủy.';
      return e.returnValue;
    };

    const handlePageHide = () => {
      if (currentAttemptId && !result) {
        // Tự động gửi tín hiệu hủy khi đóng tab/trình duyệt
        try {
          navigator.sendBeacon(`/api/v1/attempts/${currentAttemptId}/cancel`, JSON.stringify({ reason: 'TAB_CLOSED' }));
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
    if (locked) return; // Frozen after submit or when time is up
    const updated = { ...selectedAnswers, [questionId]: optionId };
    setSelectedAnswers(updated);

    if (attemptId && typeof window !== 'undefined') {
      try {
        localStorage.setItem(`quiz_answers_${attemptId}`, JSON.stringify(updated));
      } catch {}
    }
  };

  const handleToggleFlag = useCallback((questionId: string) => {
    if (result) return;
    setFlagged((prev) => {
      const next = toggleFlag(prev, questionId);
      if (attemptId && typeof window !== 'undefined') {
        try {
          localStorage.setItem(`quiz_flags_${attemptId}`, JSON.stringify(Array.from(next)));
        } catch {}
      }
      return next;
    });
  }, [attemptId, result]);

  const scrollToQuestion = (index: number) => {
    const el = document.getElementById(`quiz-question-${index + 1}`);
    if (!el) return;
    const sideBySide = window.matchMedia('(min-width: 1024px)').matches;
    const asideHeight = !sideBySide && asideRef.current ? asideRef.current.getBoundingClientRect().height : 0;
    const top = el.getBoundingClientRect().top + window.scrollY - stickyTop - asideHeight - 12;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'auto' : 'smooth' });
    if (!sideBySide) setShowMobileNav(false);
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleNavPointerDown = (e: React.PointerEvent, questionId: string) => {
    if (e.pointerType === 'mouse') return;
    clearLongPress();
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      longPressFiredAtRef.current = Date.now();
      handleToggleFlag(questionId);
      try { navigator.vibrate?.(15); } catch {}
    }, LONG_PRESS_MS);
  };

  const recentLongPress = () => Date.now() - longPressFiredAtRef.current < 900;

  const handleSubmit = async () => {
    if (!attemptId || submitting || result || isSubmittingRef.current) return;

    // Synchronous mutex to prevent race conditions and double-submits
    isSubmittingRef.current = true;
    setSubmitting(true);

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
            localStorage.removeItem(`quiz_flags_${attemptId}`);
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
        localStorage.removeItem(`quiz_flags_${attemptId}`);
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

  const lowTime = hasDeadline && timeLeft <= 60;
  const showWorkspace = !loading && !error && questions.length > 0;

  const timerBadge = (
    <div
      role="timer"
      aria-live={lowTime ? 'polite' : 'off'}
      data-testid="quiz-timer"
      className={`flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-bold border tabular-nums ${
        timeUp
          ? 'bg-rose-600 text-white border-rose-600'
          : lowTime
          ? 'bg-rose-50 text-rose-700 border-rose-300 animate-pulse'
          : 'bg-red-50 text-red-700 border-red-200'
      }`}
    >
      <span aria-hidden>⏱️</span>
      <span>{timeUp ? 'Hết giờ' : `Còn lại ${formatCountdown(timeLeft)}`}</span>
    </div>
  );

  const navigator_ = (
    <div className="space-y-3">
      <div
        className="grid grid-cols-6 sm:grid-cols-8 lg:grid-cols-5 gap-1.5"
        role="list"
        aria-label="Danh sách câu hỏi"
        data-testid="quiz-navigator"
      >
        {questionIds.map((qId, index) => {
          const state = questionNavState(qId, selectedAnswers, flagged);
          return (
            <button
              key={qId}
              type="button"
              role="listitem"
              data-state={state}
              data-testid={`quiz-nav-${index + 1}`}
              aria-label={`Câu ${index + 1}, ${NAV_LABELS[state]}${state === 'flagged' && selectedAnswers[qId] ? ', đã trả lời' : ''}`}
              title="Bấm để tới câu hỏi · Chuột phải hoặc nhấn giữ để gắn cờ"
              onClick={() => {
                if (recentLongPress()) return;
                scrollToQuestion(index);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (recentLongPress()) return;
                handleToggleFlag(qId);
              }}
              onPointerDown={(e) => handleNavPointerDown(e, qId)}
              onPointerUp={clearLongPress}
              onPointerLeave={clearLongPress}
              onPointerCancel={clearLongPress}
              style={{ WebkitTouchCallout: 'none' }}
              className={`relative h-9 rounded-lg border-2 text-xs font-bold tabular-nums select-none transition ${NAV_STYLES[state]}`}
            >
              {index + 1}
              {state === 'flagged' && (
                <span aria-hidden className="absolute -top-1.5 -right-1.5 text-[11px] leading-none">🚩</span>
              )}
              {state === 'flagged' && selectedAnswers[qId] && (
                <span aria-hidden className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-[#2563EB]" />
              )}
            </button>
          );
        })}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#434655]" aria-label="Chú thích màu">
        <li className="flex items-center gap-1"><span className="h-3 w-3 rounded border-2 border-slate-300 bg-white" />Chưa làm</li>
        <li className="flex items-center gap-1"><span className="h-3 w-3 rounded border-2 border-[#2563EB] bg-[#2563EB]" />Đã trả lời</li>
        <li className="flex items-center gap-1"><span className="h-3 w-3 rounded border-2 border-amber-500 bg-amber-100" />Gắn cờ</li>
      </ul>
      <p className="text-[10px] text-[#737686] leading-relaxed">
        Bấm vào ô để tới câu. Chuột phải (hoặc nhấn giữ trên điện thoại) để gắn/bỏ cờ.
      </p>
    </div>
  );

  return (
    <Card className="p-4 sm:p-6 border border-[#eff4ff] shadow-sm space-y-6">
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

      {showWorkspace && (
        <div className={result ? '' : 'lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-6 lg:items-start'}>
          {/* Timer + question navigator: sticky bar on mobile, sticky side panel on desktop */}
          {!result && (
            <aside
              ref={asideRef}
              aria-label="Thời gian và danh sách câu hỏi"
              data-testid="quiz-sidebar"
              style={{ top: stickyTop }}
              className="sticky z-20 -mx-4 sm:-mx-6 lg:mx-0 mb-4 lg:mb-0 lg:order-2 bg-white/95 backdrop-blur border-b lg:border border-[#eff4ff] lg:rounded-2xl px-4 sm:px-6 lg:p-4 py-2.5 shadow-sm space-y-3"
            >
              <div className="flex items-center gap-2 lg:flex-col lg:items-stretch">
                <div className="flex-1 lg:flex-none">{timerBadge}</div>
                <span className="text-xs font-semibold text-[#434655] whitespace-nowrap lg:text-center" data-testid="quiz-answered-count">
                  Đã làm {answeredCount}/{questions.length}
                </span>
                <button
                  type="button"
                  onClick={() => setShowMobileNav((open) => !open)}
                  aria-expanded={showMobileNav}
                  aria-controls="quiz-mobile-navigator"
                  className="lg:hidden shrink-0 px-3 py-2 rounded-xl border border-[#cbdbf5] bg-[#eff4ff] text-[#172554] text-xs font-bold"
                >
                  {showMobileNav ? 'Ẩn' : 'Câu hỏi'} {flagged.size > 0 ? `· 🚩${flagged.size}` : ''}
                </button>
              </div>
              <div id="quiz-mobile-navigator" className={`${showMobileNav ? 'block' : 'hidden'} lg:block max-h-[50vh] lg:max-h-[calc(100vh-14rem)] overflow-y-auto pt-1`}>
                {navigator_}
              </div>
            </aside>
          )}

          <div className="space-y-5 lg:order-1 min-w-0">
            {questions.map((q: any, qIdx: number) => {
              const qId = q.questionId || q.id;
              const answerResult = result?.answers?.find((a: any) => a.questionId === qId);
              const isFlagged = flagged.has(qId);

              return (
                <div
                  key={qId}
                  id={`quiz-question-${qIdx + 1}`}
                  className={`p-4 sm:p-5 bg-[#f8f9ff] border rounded-2xl space-y-3 transition ${
                    isFlagged && !result ? 'border-amber-400 ring-1 ring-amber-300' : 'border-[#eff4ff]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="font-bold text-sm text-[#172554] leading-relaxed">
                      <span className="text-[#2563EB] mr-1.5 whitespace-nowrap">Câu <span className="tabular-nums">{qIdx + 1}</span>/{questions.length}:</span>
                      <span>{q.questionText}</span>
                    </h4>
                    {answerResult ? (
                      <span
                        className={`shrink-0 text-xs px-2.5 py-0.5 rounded-full font-bold ${
                          answerResult.isCorrect
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        {answerResult.isCorrect ? '✓ Đúng' : '✗ Sai'}
                      </span>
                    ) : !result && (
                      <button
                        type="button"
                        onClick={() => handleToggleFlag(qId)}
                        aria-pressed={isFlagged}
                        data-testid={`quiz-flag-${qIdx + 1}`}
                        className={`shrink-0 text-[11px] px-2.5 py-1 rounded-full font-bold border transition ${
                          isFlagged
                            ? 'bg-amber-100 text-amber-900 border-amber-400'
                            : 'bg-white text-[#737686] border-slate-200 hover:border-amber-400'
                        }`}
                      >
                        🚩 {isFlagged ? 'Bỏ cờ' : 'Gắn cờ'}
                      </button>
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
                          className={`flex items-center gap-3 p-3 rounded-xl border-2 text-xs transition select-none ${optStyle} ${
                            locked ? 'cursor-default' : 'cursor-pointer'
                          } ${timeUp && !result ? 'opacity-70' : ''}`}
                        >
                          <input
                            type="radio"
                            disabled={locked}
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
                  Đã chọn: {answeredCount}/{questions.length} câu
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
                    disabled={(answeredCount === 0 && !timeUp) || cancelling || submitting || isSubmittingRef.current || Boolean(result)}
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
        </div>
      )}

      {/* Modal xác nhận Hủy bài kiểm tra — portal ra document.body nên luôn
          căn giữa viewport kể cả khi người học đã cuộn xuống sâu. */}
      <Modal
        isOpen={showCancelModal && !timeUp}
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

      {/* Hết giờ: đáp án bị khóa, chỉ còn Nộp bài hoặc Hủy bài (không đóng được bằng Escape/backdrop). */}
      <Modal
        isOpen={timeUp && !result && Boolean(attempt)}
        onClose={() => {}}
        maxWidth="max-w-md"
        closeOnBackdrop={false}
        className=""
      >
        <div className="p-6 space-y-4 border-t-8 border-rose-300" data-testid="quiz-timeup-modal">
          <div className="flex items-center gap-3 text-rose-600">
            <span className="text-3xl" aria-hidden>⏰</span>
            <h4 className="text-base font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              Bạn đã hết thời gian
            </h4>
          </div>
          <p className="text-xs text-[#434655] leading-relaxed">
            Thời gian làm bài đã kết thúc, bạn không thể sửa đáp án nữa. Bạn đã trả lời{' '}
            <strong>{answeredCount}/{questions.length}</strong> câu.
          </p>
          <ul className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-[#434655] space-y-1">
            <li>• <strong>Nộp bài</strong>: chấm điểm với các đáp án bạn đã chọn.</li>
            <li>• <strong>Hủy bài</strong>: lượt này không được tính kết quả, cần chờ {QUIZ_COOLDOWN_MINUTES} phút để làm lại.</li>
          </ul>
          <div className="flex gap-2.5 pt-2">
            <Button
              variant="outline"
              className="flex-1 font-bold !text-rose-600 !border-rose-200 hover:!bg-rose-50"
              loading={cancelling}
              disabled={submitting}
              onClick={handleCancelQuiz}
            >
              Hủy bài
            </Button>
            <Button
              variant="primary"
              className="flex-1 font-bold shadow-md"
              loading={submitting}
              loadingText="Đang nộp..."
              disabled={cancelling}
              onClick={handleSubmit}
            >
              Nộp bài
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
