'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import NewContentChip from '@/components/learning/NewContentChip';
import Modal from '@/components/ui/Modal';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import LessonQuiz from '@/components/lesson/LessonQuiz';
import StarRewardCelebration from '@/components/StarRewardCelebration';
import MonthlyReviewButton from '@/components/learning/MonthlyReviewButton';
import MonthStarParts, { MonthPartLabel } from '@/components/learning/MonthStarParts';
import { needsMonthlyQuiz, monthlyQuizLocked, thisMonthQuizLabel, monthHistoryLabel, monthHistoryParts } from '@/lib/monthly-review-state';
import { apiFetch, clearApiCache } from '@/lib/api/client';
import { QUIZ_COOLDOWN_MS, QUIZ_COOLDOWN_MINUTES } from '@/lib/config/quiz';
import { getNextLearningTarget, NextLearningTarget } from '@/lib/lesson-navigation';

interface AttemptItem {
  attemptId: string;
  attemptNumber: number;
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'AUTO_SUBMITTED' | 'CANCELLED';
  score: number | null;
  passed: boolean | null;
  submittedAt: string | null;
}

export default function LessonQuizPage({ params }: { params: { lessonId: string } }) {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [role, setRole] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [lesson, setLesson] = useState<any>(null);
  const [progress, setProgress] = useState<any>(null);
  const [attempts, setAttempts] = useState<AttemptItem[]>([]);
  const [attemptsAvailable, setAttemptsAvailable] = useState(false);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [started, setStarted] = useState(false);
  const [attemptKey, setAttemptKey] = useState(0);
  const [isNewAttempt, setIsNewAttempt] = useState(false);
  const [showConfirmStartModal, setShowConfirmStartModal] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [cooldownRemainingMs, setCooldownRemainingMs] = useState<number>(0);
  const [starReward, setStarReward] = useState<number | null>(null);
  // Result of the last submit this visit: stars earned, or why a pass earned none.
  const [rewardNote, setRewardNote] = useState<{ passed: boolean; amount: number; message: string } | null>(null);
  const seenRewardKeysRef = useRef<Set<string>>(new Set());
  const [nextTarget, setNextTarget] = useState<NextLearningTarget | null>(null);

  const courseId: string = lesson?.session?.courseId || '';

  // Once the lesson is completed, work out where "next" is so the back button can skip the finished quiz.
  useEffect(() => {
    if (!quizCompleted || !courseId || !token) return;
    let cancelled = false;
    apiFetch(`/api/v1/courses/${courseId}`, { token }).then((res: any) => {
      if (cancelled || !res?.ok || !res.data) return;
      setNextTarget(getNextLearningTarget(res.data, courseId, params.lessonId));
    });
    return () => {
      cancelled = true;
    };
  }, [quizCompleted, courseId, token, params.lessonId]);

  const showToast = (type: 'success' | 'error' | 'info', message: string, title?: string) => {
    setToast({ type, message, title });
  };

  useEffect(() => {
    const t = typeof window !== 'undefined' ? localStorage.getItem('accessToken') || '' : '';
    const u = typeof window !== 'undefined' ? localStorage.getItem('user') : null;
    if (!t) {
      if (typeof window !== 'undefined') {
        window.location.href = '/login?callbackUrl=' + encodeURIComponent(window.location.pathname);
      }
      return;
    }
    let parsedRole = 'MEMBER';
    try {
      parsedRole = JSON.parse(u || '{}')?.role || 'MEMBER';
    } catch {}
    setRole(parsedRole);
    setToken(t);
    load(t, parsedRole);
  }, [params.lessonId]);

  async function load(accessToken: string, userRole: string) {
    setLoading(true);
    setLoadError('');

    const [lessonRes, progressRes] = await Promise.all([
      apiFetch(`/api/v1/lessons/${params.lessonId}`, { noCache: true, token: accessToken }),
      apiFetch(`/api/v1/lessons/${params.lessonId}/progress`, { noCache: true, token: accessToken }),
    ]);

    if (!lessonRes.ok || !lessonRes.data) {
      setLoadError(lessonRes.error?.message || 'Không tải được bài học này.');
      setLoading(false);
      return;
    }
    setLesson(lessonRes.data);

    if (progressRes.ok && progressRes.data) {
      setProgress(progressRes.data);
      setQuizCompleted(progressRes.data.assessmentPassed === true);
    }

    const assessmentId = lessonRes.data.assessment?.assessmentId || lessonRes.data.assessment?.id;
    if (assessmentId && userRole === 'MEMBER') {
      const attemptsRes = await apiFetch(`/api/v1/assessments/${assessmentId}/attempts/me`, {
        noCache: true,
        token: accessToken,
      });
      if (attemptsRes.ok && attemptsRes.data?.items) {
        setAttempts(attemptsRes.data.items);
        setAttemptsAvailable(true);
      }
    }

    setLoading(false);
  }

  // Refresh attempts & progress in background WITHOUT unmounting LessonQuiz or resetting its result UI
  async function refreshDataSilently(accessToken: string, userRole: string) {
    const assessmentId = lesson?.assessment?.assessmentId || lesson?.assessment?.id;
    const [progressRes, attemptsRes] = await Promise.all([
      apiFetch(`/api/v1/lessons/${params.lessonId}/progress`, { noCache: true, token: accessToken }),
      assessmentId && userRole === 'MEMBER'
        ? apiFetch(`/api/v1/assessments/${assessmentId}/attempts/me`, { noCache: true, token: accessToken })
        : Promise.resolve<any>({ ok: false, data: null }),
    ]);

    if (progressRes.ok && progressRes.data) {
      setProgress(progressRes.data);
      setQuizCompleted(progressRes.data.assessmentPassed === true);
    }

    if (attemptsRes?.ok && attemptsRes.data?.items) {
      setAttempts(attemptsRes.data.items);
      setAttemptsAvailable(true);
    }
  }

  // ─── Derived data ────────────────────────────────────────────────────────────
  const assessment = lesson?.assessment;
  const assessmentId = assessment?.assessmentId || assessment?.id;
  const questionCount = Number(assessment?.questionCount || 0);
  const bankQuestionCount = Number(assessment?.bankQuestionCount || 0);
  const durationMinutes = Number(assessment?.durationMinutes || 0);
  const passingPercent = Number(assessment?.passingPercent || 85);

  // Video watch status check. Backend also verifies this before creating an attempt.
  const videoDuration = lesson?.video?.durationSeconds || lesson?.video?.duration_seconds || 0;
  const watchedPercent = progress?.progressPercentage ?? 0;
  const canAccessQuiz = progress?.canAssess ?? (Boolean(progress?.completed) || Boolean(progress?.videoCompleted) || videoDuration === 0);

  // Lịch sử bài làm: CHỈ tính bài đã nộp thành công
  const submittedAttempts = attempts.filter((a) => a.status === 'SUBMITTED' || a.status === 'AUTO_SUBMITTED');
  const submittedCount = submittedAttempts.length;
  const latestSubmitted = submittedAttempts[0] || null;
  const highestScore = submittedAttempts.length > 0
    ? Math.max(...submittedAttempts.map((a) => Math.round(a.score || 0)))
    : null;

  // Cooldown check (tính từ lần nộp hoặc hủy gần nhất)
  const lastAttemptWithCooldown = attempts.find(
    (a) => a.status === 'SUBMITTED' || a.status === 'AUTO_SUBMITTED' || a.status === 'CANCELLED'
  );

  useEffect(() => {
    if (!lastAttemptWithCooldown || !lastAttemptWithCooldown.submittedAt || QUIZ_COOLDOWN_MS <= 0) {
      setCooldownRemainingMs(0);
      return;
    }
    const lastTime = new Date(lastAttemptWithCooldown.submittedAt).getTime();
    const update = () => {
      const elapsed = Date.now() - lastTime;
      const rem = Math.max(0, QUIZ_COOLDOWN_MS - elapsed);
      setCooldownRemainingMs(rem);
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [lastAttemptWithCooldown]);

  const isCooldownActive = cooldownRemainingMs > 0;
  // "Xem lại tháng này" resets the video and the quiz together; the month needs a new pass.
  const monthlyPending = needsMonthlyQuiz(
    progress?.replay,
    Boolean(progress?.cycleProgress?.videoCompleted ?? progress?.videoCompleted),
    progress?.assessmentPassed === true,
    progress?.monthlyQuizPassed === true,
  );
  const monthlyVideoDone = progress?.replay?.completed === true;
  const monthKey = String(progress?.replay?.competitionMonth || '');
  const monthLabel = /^\d{4}-\d{2}$/.test(monthKey) ? `Tháng ${Number(monthKey.slice(5))}/${monthKey.slice(0, 4)}` : 'Tháng này';
  const formatMonthKey = (key: string) => /^\d{4}-\d{2}$/.test(key) ? `${Number(key.slice(5))}/${key.slice(0, 4)}` : key;
  // Video → quiz: mirrors the server gate on starting an attempt (admins are never gated).
  const quizLock = role === 'ADMIN' ? null : monthlyQuizLocked(progress?.monthlyQuizBlock, monthlyVideoDone);
  const monthPercentNow = Math.floor(Number(progress?.monthPercent ?? 0));
  const monthVideoStars = Number(progress?.videoStarsThisMonth?.awardedStars || 0);
  const quizThisMonth = progress?.quizThisMonth || null;
  const monthHistory: any[] = (progress?.replayHistory || []).filter((row: any) => row.quiz);

  const formatCooldown = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hours > 0) {
      return `${hours} giờ ${mins.toString().padStart(2, '0')} phút ${secs.toString().padStart(2, '0')} giây`;
    }
    return `${mins} phút ${secs.toString().padStart(2, '0')} giây`;
  };

  const formatDate = (value: string | null) =>
    value ? new Date(value).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f8f9ff] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <div className="w-10 h-10 border-4 border-[#2563EB] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs font-medium">Đang nạp bài kiểm tra...</p>
        </div>
      </div>
    );
  }

  if (loadError || !lesson) {
    return (
      <div className="min-h-screen bg-[#f8f9ff] flex items-center justify-center p-6">
        <Card className="p-8 text-center max-w-md w-full space-y-4">
          <p className="text-base font-bold text-[#172554]">⚠️ {loadError || 'Không tìm thấy bài học'}</p>
          <Link href="/student/courses">
            <Button variant="outline" className="w-full">
              ← Về danh sách khóa học
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  if (!assessment || !assessmentId) {
    return (
      <div className="min-h-screen bg-[#f8f9ff] flex items-center justify-center p-6">
        <Card className="p-8 text-center max-w-md w-full space-y-4">
          <p className="text-base font-bold text-[#172554]">Bài học này không có bài kiểm tra.</p>
          <Link href={`/student/learning/${params.lessonId}`}>
            <Button variant="outline" className="w-full">
              ← Quay lại bài học
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  // Chặn ngay nếu chưa hoàn thành xem 100% video bài học
  if (!canAccessQuiz) {
    return (
      <div className="min-h-screen bg-[#f8f9ff] flex items-center justify-center p-6">
        <Card className="p-8 text-center max-w-md w-full space-y-5 border border-amber-200 shadow-md">
          <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center text-3xl mx-auto shadow-inner">
            🔒
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              Bài kiểm tra đang bị khóa
            </h2>
            <p className="text-xs text-[#737686] leading-relaxed">
              Bạn cần xem đủ <strong>100%</strong> thời lượng video bài giảng trước khi được phép làm bài kiểm tra.
            </p>
            <div className="p-3 bg-[#eff4ff] rounded-xl text-xs font-semibold text-[#172554]">
              Tiến độ xem hiện tại của bạn: <span className="text-[#2563EB]">{watchedPercent}% / 100%</span>
            </div>
          </div>
          <Link href={`/student/learning/${params.lessonId}`}>
            <Button variant="primary" className="w-full shadow-sm font-bold">
              ← Quay lại xem video bài học
            </Button>
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9ff] text-[#0b1c30]">
      <Toast toast={toast} onClose={() => setToast(null)} />

      {/* Header: Khi đang làm bài (started === true), ẨN TOÀN BỘ nút quay lại */}
      <header data-quiz-header className="bg-white border-b border-[#e5eeff] px-6 py-3.5 flex items-center justify-between sticky top-0 z-30 shadow-xs">
        <div className="min-w-0">
          <h1 className="text-sm md:text-base font-bold text-[#172554] truncate" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            📝 {assessment.title || 'Bài kiểm tra bài học'} <NewContentChip show={progress?.quizIsNew && !quizCompleted} />
          </h1>
          <p className="text-[11px] text-[#737686] truncate">
            {lesson.session?.courseTitle ? `${lesson.session.courseTitle} • ` : ''}
            <span className="text-[#2563EB] font-bold">{lesson.title} <NewContentChip show={progress?.isNew} /></span>
          </p>
        </div>

        {/* Nút quay lại hiện khi chưa bấm Bắt đầu hoặc sau khi đã hoàn thành */}
        {(!started || quizCompleted) && (
          <Link
            href={`/student/learning/${params.lessonId}`}
            onClick={() => {
              clearApiCache('/api/v1/courses');
              clearApiCache('/api/v1/lessons');
              clearApiCache('/api/v1/learning');
              clearApiCache('/api/v1/members/me');
              clearApiCache('/api/v1/stars/me');
              clearApiCache('/api/v1/streak');
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('bbe-progress-updated', {
                  detail: { lessonId: params.lessonId, assessmentId, passed: quizCompleted }
                }));
              }
            }}
            className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#eff4ff] hover:bg-[#cbdbf5] text-[#172554] text-xs font-bold transition shadow-xs"
          >
            ← Bài học
          </Link>
        )}
      </header>

      <div className={`${started ? 'max-w-5xl' : 'max-w-3xl'} mx-auto p-4 md:p-8`}>
        {started ? (
          <div className="space-y-4">
            {rewardNote?.passed && (
              <div
                role="status"
                className={`p-3 rounded-2xl border text-xs font-semibold leading-relaxed ${
                  rewardNote.amount > 0 ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
              >
                {rewardNote.amount > 0 ? rewardNote.message : `Đạt yêu cầu, nhưng không cộng Star: ${rewardNote.message}`}
              </div>
            )}
            <LessonQuiz
              key={`attempt-${attemptKey}`}
              lessonId={params.lessonId}
              assessmentId={assessmentId}
              lessonTitle={lesson.title}
              accessToken={token}
              isCompleted={quizCompleted}
              returnHref={quizCompleted && nextTarget ? nextTarget.href : undefined}
              returnLabel={quizCompleted && nextTarget ? `${nextTarget.label} →` : undefined}
              returnReplace={Boolean(quizCompleted && nextTarget)}
              forceNew={isNewAttempt}
              onQuizPassed={() => {
                setQuizCompleted(true);
              }}
              onSubmitted={(resultData) => {
                if (resultData?.passed) {
                  setQuizCompleted(true);
                }
                if (resultData?.starReward?.reasonCode) {
                  const amount = Number(resultData.starReward.amount || 0);
                  setRewardNote({
                    passed: Boolean(resultData.passed),
                    amount,
                    message: amount > 0 ? `+${amount} ⭐ Star bài kiểm tra của ${monthLabel.toLowerCase()}.` : String(resultData.starReward.message || ''),
                  });
                }
                if (resultData?.starReward?.awarded && Number(resultData.starReward.amount) > 0) {
                  const key = resultData.starReward.rewardKey || `quiz:${resultData.attemptId}:${resultData.starReward.amount}`;
                  if (!seenRewardKeysRef.current.has(key)) {
                    seenRewardKeysRef.current.add(key);
                    setStarReward(Number(resultData.starReward.amount));
                    window.setTimeout(() => setStarReward(null), 3600);
                  }
                }
                refreshDataSilently(token, role);
              }}
              onCancel={() => {
                setStarted(false);
                setIsNewAttempt(false);
                load(token, role);
              }}
              onToast={showToast}
            />
          </div>
        ) : (
          <Card className="p-6 md:p-8 space-y-6 shadow-sm border border-[#eff4ff]">
            {/* Quy tắc & Quy chế bài kiểm tra */}
            <div className="space-y-3">
              <h2 className="text-lg font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                Sẵn sàng làm bài kiểm tra?
              </h2>
              <div className="flex flex-wrap gap-2 text-xs font-semibold">
                {role === 'ADMIN' && (
                  <span className="px-3 py-1.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl" title="Chỉ quản trị viên nhìn thấy">
                    Ngân hàng: {bankQuestionCount} câu
                  </span>
                )}
                <span className="px-3 py-1.5 bg-[#eff4ff] text-[#2563EB] rounded-xl">
                  {questionCount > 0 ? `${questionCount} câu hỏi mỗi lượt` : 'Theo cấu hình đề'}
                </span>
                <span className="px-3 py-1.5 bg-[#eff4ff] text-[#2563EB] rounded-xl">
                  {durationMinutes > 0 ? `${durationMinutes} phút` : 'Thời gian theo cấu hình'}
                </span>
                <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl">
                  Đạt từ {passingPercent}% để vượt qua bài học
                </span>
              </div>

              {/* Thông báo quy định nghiêm ngặt */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-xs text-[#434655]">
                <p className="font-bold text-[#172554] flex items-center gap-1.5 uppercase tracking-wide text-[11px]">
                  <span>📌</span> Quy định khi vào làm bài:
                </p>
                <ul className="list-disc pl-5 space-y-1 text-slate-600">
                  <li>Khi đã bấm làm bài, bạn chỉ có 2 lựa chọn: <strong>Nộp bài</strong> hoặc <strong>Hủy bài</strong>.</li>
                  <li>Nếu đóng tab hoặc rời khỏi trang, bài thi sẽ <strong>tự động bị hủy</strong>.</li>
                  <li>Mỗi lần làm bài (kể cả Nộp hay Hủy), bạn cần <strong>đợi {QUIZ_COOLDOWN_MINUTES} phút</strong> mới có thể làm lại lượt tiếp theo.</li>
                </ul>
              </div>
            </div>

            {/* Cảnh báo Cooldown nếu đang trong thời gian chờ */}
            {isCooldownActive && (
              <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex items-start gap-3">
                <span className="text-2xl shrink-0 mt-0.5">⏳</span>
                <div className="space-y-1 text-xs text-amber-900">
                  <p className="font-bold text-sm">Đang trong thời gian giãn cách làm bài</p>
                  <p className="text-amber-800">
                    Theo quy định, bạn cần chờ đủ <strong>{QUIZ_COOLDOWN_MINUTES} phút</strong> giữa các lần làm bài (kể cả Nộp bài hay Hủy bài).
                  </p>
                  <div className="pt-1.5 flex items-center gap-2">
                    <span className="text-[#172554] font-semibold">Thời gian còn lại:</span>
                    <span className="font-mono text-sm font-bold bg-white text-amber-900 px-3 py-1 rounded-xl border border-amber-300 shadow-2xs">
                      {formatCooldown(cooldownRemainingMs)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Lịch sử làm bài: CHỈ hiển thị bài đã nộp thành công */}
            {monthlyPending && (
              <div role="status" className="p-3 rounded-2xl border border-amber-200 bg-amber-50 text-xs text-amber-900 leading-relaxed">
                <p className="font-bold">{monthLabel}: bài kiểm tra chưa đạt</p>
                <p className="mt-0.5">
                  {monthlyVideoDone
                    ? 'Bạn đã xem lại video tháng này. Làm lại bài kiểm tra để được ghi nhận đạt của tháng (kết quả nhiệm kỳ vẫn giữ).'
                    : 'Bạn đã bấm "Xem lại tháng này": video và bài kiểm tra được làm lại cùng nhau. Hãy xem hết video tháng này trước.'}
                </p>
              </div>
            )}
            {!monthlyPending && progress?.monthlyQuizPassed && progress?.replay?.started && (
              <div role="status" className="p-3 rounded-2xl border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-900">
                {monthLabel}: ✓ đã đạt bài kiểm tra
              </div>
            )}

            {quizLock === 'REVIEW_NOT_STARTED' && (
              <div role="status" className="p-4 rounded-2xl border border-blue-200 bg-blue-50 text-xs text-[#172554] leading-relaxed space-y-3">
                <p>
                  <span className="font-bold">Bạn đã làm bài kiểm tra này ở tháng trước.</span>{' '}
                  Muốn làm lại để nhận Star {monthLabel.toLowerCase()}, hãy bấm &quot;Xem lại tháng này&quot;: video về 0% và bài kiểm tra về &quot;chưa làm&quot;.
                  Xem hết video rồi mới làm lại bài kiểm tra.
                </p>
                {progress?.reviewState && (
                  <MonthlyReviewButton
                    key={`${params.lessonId}:${monthKey}`}
                    state={progress.reviewState}
                    scope={{ lessonId: params.lessonId }}
                    monthLabel={monthKey ? formatMonthKey(monthKey) : undefined}
                    label="Xem lại tháng này"
                    onDone={() => router.push(`/student/learning/${params.lessonId}`)}
                  />
                )}
              </div>
            )}

            {/* Kết quả theo tháng: tháng này + những tháng trước (video và bài kiểm tra) */}
            {attemptsAvailable && (
              <div className="p-4 bg-[#f8f9ff] border border-[#eff4ff] rounded-2xl space-y-3">
                <div className="space-y-1.5">
                  <h3 className="text-xs font-bold text-[#172554] uppercase tracking-wide">{monthLabel}</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="p-3 rounded-xl border border-blue-200 bg-blue-50 text-blue-950">
                      <p className="text-[11px] text-blue-700"><MonthPartLabel kind="video" /> tháng này</p>
                      <p className="text-sm font-extrabold mt-0.5">
                        {monthlyVideoDone ? '✓ Hoàn thành' : progress?.replay?.reviewAvailable ? 'Chưa bấm xem lại' : `${monthPercentNow}%`}
                        {monthVideoStars > 0 && <span className="ml-1.5 text-amber-700">+{monthVideoStars} ⭐</span>}
                      </p>
                    </div>
                    <div
                      className={`p-3 rounded-xl border ${
                        (quizThisMonth?.stars || 0) > 0 || (progress?.replay?.started && progress?.monthlyQuizPassed)
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                          : 'bg-white border-[#e5eeff] text-[#172554]'
                      }`}
                    >
                      <p className="text-[11px] text-[#737686]"><MonthPartLabel kind="quiz" /> tháng này</p>
                      <p className="text-sm font-extrabold mt-0.5">
                        {thisMonthQuizLabel({
                          quiz: quizThisMonth, locked: quizLock, monthlyPending,
                          reviewStarted: Boolean(progress?.replay?.started), monthlyPassed: progress?.monthlyQuizPassed === true,
                        })}
                      </p>
                      {(quizThisMonth?.attempted || 0) > 0 && (
                        <p className="text-[10px] text-[#737686] mt-1">
                          {quizThisMonth.attempted} lượt nộp trong tháng · điểm cao nhất {quizThisMonth.bestScorePercent}%
                        </p>
                      )}
                    </div>
                  </div>
                  {latestSubmitted && (
                    <p className="text-[10px] text-[#737686]">
                      Lần nộp gần nhất: {Math.round(latestSubmitted.score || 0)}% — {latestSubmitted.passed ? 'đạt' : 'chưa đạt'} · {formatDate(latestSubmitted.submittedAt)}
                    </p>
                  )}
                </div>

                <div className="pt-2 border-t border-dashed border-[#e5eeff] space-y-1.5">
                  <h3 className="text-[10px] font-bold text-[#737686] uppercase tracking-wide">Những tháng trước</h3>
                  {monthHistory.length === 0 ? (
                    <p className="text-xs text-[#737686]">Chưa có tháng nào trước đó.</p>
                  ) : (
                    <ul className="space-y-1">
                      {monthHistory.map((row: any) => (
                        <li key={row.competitionMonthId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-xl border border-[#eff4ff] bg-white px-3 py-2 text-xs">
                          <span className="font-bold text-[#172554]">{formatMonthKey(row.competitionMonth)}</span>
                          <span className="text-[#434655]" title={monthHistoryLabel(row)}><MonthStarParts {...monthHistoryParts(row)} /></span>
                          {row.quiz?.attempted > 0 && (
                            <span className="w-full text-[10px] text-[#737686]">{row.quiz.attempted} lượt nộp · điểm cao nhất {row.quiz.bestScorePercent}%</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {/* Hành động */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              {quizLock ? (
                // Monthly retake not open yet: no "Làm lại" button that the server would refuse.
                <Button
                  variant="primary"
                  size="lg"
                  className="flex-1 !bg-slate-200 !text-slate-600 cursor-not-allowed font-bold"
                  disabled
                >
                  {quizLock === 'MONTHLY_VIDEO_INCOMPLETE'
                    ? `🔒 Xem hết video tháng này trước (${monthPercentNow}%)`
                    : '🔒 Bấm "Xem lại tháng này" để làm lại'}
                </Button>
              ) : isCooldownActive ? (
                <Button
                  variant="primary"
                  size="lg"
                  className="flex-1 !bg-slate-200 !text-slate-500 cursor-not-allowed font-bold"
                  disabled
                >
                  ⏳ Đang chờ thời gian làm lại ({formatCooldown(cooldownRemainingMs)})
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="lg"
                  className="flex-1 font-bold shadow-md"
                  disabled={monthlyPending && !monthlyVideoDone}
                  onClick={() => setShowConfirmStartModal(true)}
                >
                  {monthlyPending
                    ? monthlyVideoDone ? '🔄 Làm lại bài kiểm tra tháng này' : 'Xem hết video tháng này trước'
                    : quizCompleted ? '🔄 Làm lại bài kiểm tra' : '▶ Bắt đầu làm bài'}
                </Button>
              )}

              {quizCompleted && nextTarget ? (
                <Link href={nextTarget.href} replace className="flex-1">
                  <Button variant="outline" size="lg" className="w-full font-bold">
                    {nextTarget.label} →
                  </Button>
                </Link>
              ) : (
                <Link href={`/student/learning/${params.lessonId}`} className="flex-1">
                  <Button variant="outline" size="lg" className="w-full font-bold">
                    ← Quay lại bài học
                  </Button>
                </Link>
              )}
            </div>
          </Card>
        )}
      </div>
      {starReward !== null && <StarRewardCelebration amount={starReward} message="Quiz đạt yêu cầu — phần thưởng của bạn!" />}

      {/* Modal Xác nhận trước khi vào làm bài — portal, căn giữa viewport */}
      <Modal
        isOpen={showConfirmStartModal}
        onClose={() => setShowConfirmStartModal(false)}
        maxWidth="max-w-md"
        closeOnBackdrop={false}
      >
        <div className="p-6 space-y-4 border-t-8 border-blue-200">
          <div className="flex items-center gap-3 text-[#2563EB]">
            <span className="text-3xl">⏱️</span>
            <h4 className="text-base font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              Xác nhận bắt đầu bài kiểm tra?
            </h4>
          </div>
          <div className="text-xs text-[#434655] space-y-2 leading-relaxed">
            <p>
              Đồng hồ đếm ngược sẽ bắt đầu chạy ngay khi bạn xác nhận ({durationMinutes > 0 ? `${durationMinutes} phút` : 'theo cấu hình'} · {questionCount > 0 ? `${questionCount} câu` : 'theo đề'}).
            </p>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1 text-amber-900 font-medium">
              <p>⚠️ <strong>Lưu ý:</strong></p>
              <p>• Trong khi làm bài, bạn <strong>không thể quay lại</strong> nếu chưa <strong>Nộp</strong> hoặc <strong>Hủy bài</strong>.</p>
              <p>• Đóng trình duyệt sẽ được tính là <strong>Hủy bài</strong>.</p>
              <p>• Mỗi lần làm (dù Nộp hay Hủy) đều phải đợi <strong>{QUIZ_COOLDOWN_MINUTES} phút</strong> mới có thể làm lại.</p>
            </div>
          </div>
          <div className="flex gap-2.5 pt-2">
            <Button
              variant="outline"
              className="flex-1 font-bold"
              onClick={() => setShowConfirmStartModal(false)}
            >
              Chưa sẵn sàng
            </Button>
            <Button
              variant="primary"
              className="flex-1 font-bold shadow-md"
              onClick={() => {
                setShowConfirmStartModal(false);
                setIsNewAttempt(true);
                setAttemptKey((prev) => prev + 1);
                setRewardNote(null);
                setStarted(true);
              }}
            >
              Tôi đã hiểu, Bắt đầu!
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
