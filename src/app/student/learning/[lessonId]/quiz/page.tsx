'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import LessonQuiz from '@/components/lesson/LessonQuiz';
import { apiFetch } from '@/lib/api/client';
import { QUIZ_COOLDOWN_MS, QUIZ_COOLDOWN_HOURS } from '@/lib/config/quiz';

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
  const [showConfirmStartModal, setShowConfirmStartModal] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [cooldownRemainingMs, setCooldownRemainingMs] = useState<number>(0);

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
      if (progressRes.data.completed) setQuizCompleted(true);
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

  // ─── Derived data ────────────────────────────────────────────────────────────
  const assessment = lesson?.assessment;
  const assessmentId = assessment?.assessmentId || assessment?.id;
  const questionCount = Number(assessment?.questionCount || 0);
  const durationMinutes = questionCount * 2;

  // Video watch status check (phải xem ≥ 85% video bài học)
  const videoDuration = lesson?.video?.durationSeconds || lesson?.video?.duration_seconds || 0;
  const watchedPercent = progress?.progressPercentage ?? 0;
  const canAccessQuiz = role === 'ADMIN' || role === 'CHAPTER_LEADER' || Boolean(progress?.completed) || watchedPercent >= 85 || videoDuration === 0;

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

  // Chặn ngay nếu chưa hoàn thành xem ≥ 85% video bài học
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
              Bạn cần xem tối thiểu <strong>85%</strong> thời lượng video bài giảng trước khi được phép làm bài kiểm tra.
            </p>
            <div className="p-3 bg-[#eff4ff] rounded-xl text-xs font-semibold text-[#172554]">
              Tiến độ xem hiện tại của bạn: <span className="text-[#2563EB]">{watchedPercent}% / 85%</span>
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
      <header className="bg-white border-b border-[#e5eeff] px-6 py-3.5 flex items-center justify-between sticky top-0 z-30 shadow-xs">
        <div className="min-w-0">
          <h1 className="text-sm md:text-base font-bold text-[#172554] truncate" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
            📝 {assessment.title || 'Bài kiểm tra bài học'}
          </h1>
          <p className="text-[11px] text-[#737686] truncate">
            {lesson.session?.courseTitle ? `${lesson.session.courseTitle} • ` : ''}
            <span className="text-[#2563EB] font-bold">{lesson.title}</span>
          </p>
        </div>

        {/* Nút quay lại CHỈ hiện khi chưa bấm Bắt đầu làm bài */}
        {!started && (
          <Link
            href={`/student/learning/${params.lessonId}`}
            className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#eff4ff] hover:bg-[#cbdbf5] text-[#172554] text-xs font-bold transition shadow-xs"
          >
            ← Bài học
          </Link>
        )}
      </header>

      <div className="max-w-3xl mx-auto p-4 md:p-8">
        {started ? (
          <div className="space-y-4">
            <LessonQuiz
              lessonId={params.lessonId}
              assessmentId={assessmentId}
              lessonTitle={lesson.title}
              accessToken={token}
              isCompleted={quizCompleted}
              onQuizPassed={() => {
                setQuizCompleted(true);
              }}
              onSubmitted={() => {
                load(token, role);
              }}
              onCancel={() => {
                setStarted(false);
                load(token, role);
              }}
              onToast={showToast}
            />

            {/* Sau khi đã nộp hoặc vượt qua, cho phép quay về bài học */}
            {quizCompleted && (
              <div className="text-center pt-2">
                <Link
                  href={`/student/learning/${params.lessonId}`}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md transition"
                >
                  ✓ Quay lại bài học để tiếp tục →
                </Link>
              </div>
            )}
          </div>
        ) : (
          <Card className="p-6 md:p-8 space-y-6 shadow-sm border border-[#eff4ff]">
            {/* Quy tắc & Quy chế bài kiểm tra */}
            <div className="space-y-3">
              <h2 className="text-lg font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                Sẵn sàng làm bài kiểm tra?
              </h2>
              <div className="flex flex-wrap gap-2 text-xs font-semibold">
                <span className="px-3 py-1.5 bg-[#eff4ff] text-[#2563EB] rounded-xl">{questionCount} câu hỏi</span>
                <span className="px-3 py-1.5 bg-[#eff4ff] text-[#2563EB] rounded-xl">Thời gian: {durationMinutes} phút</span>
                <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl">
                  Đạt từ 85% để vượt qua bài học
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
                  <li>Mỗi lần làm bài (kể cả Nộp hay Hủy), bạn cần <strong>đợi {QUIZ_COOLDOWN_HOURS} giờ</strong> mới có thể làm lại lượt tiếp theo.</li>
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
                    Theo quy định, bạn cần chờ đủ <strong>{QUIZ_COOLDOWN_HOURS} giờ</strong> giữa các lần làm bài (kể cả Nộp bài hay Hủy bài).
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
            {attemptsAvailable && (
              <div className="p-4 bg-[#f8f9ff] border border-[#eff4ff] rounded-2xl space-y-2.5">
                <h3 className="text-xs font-bold text-[#172554] uppercase tracking-wide">Kết quả của bạn</h3>

                {submittedCount === 0 ? (
                  <p className="text-xs text-[#737686]">Bạn chưa hoàn thành lượt nộp bài nào.</p>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {latestSubmitted && (
                        <div
                          className={`p-3 rounded-xl border ${
                            latestSubmitted.passed
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                              : 'bg-orange-50 border-orange-200 text-orange-950'
                          }`}
                        >
                          <p className="text-[11px] font-semibold text-[#737686]">Điểm lần gần nhất:</p>
                          <p className="text-base font-extrabold mt-0.5">
                            {Math.round(latestSubmitted.score || 0)}% —{' '}
                            <span className="text-xs font-bold">
                              {latestSubmitted.passed ? '✓ Đạt' : '✗ Chưa đạt'}
                            </span>
                          </p>
                          <p className="text-[10px] text-[#737686] mt-1">{formatDate(latestSubmitted.submittedAt)}</p>
                        </div>
                      )}

                      {highestScore !== null && (
                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-950">
                          <p className="text-[11px] font-semibold text-blue-700">Điểm cao nhất đạt được:</p>
                          <p className="text-base font-extrabold text-[#2563EB] mt-0.5">{highestScore}%</p>
                          <p className="text-[10px] text-[#737686] mt-1">Tổng cộng đã nộp: {submittedCount} lượt</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Hành động */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              {isCooldownActive ? (
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
                  onClick={() => setShowConfirmStartModal(true)}
                >
                  {quizCompleted ? '🔄 Làm lại bài kiểm tra' : '▶ Bắt đầu làm bài'}
                </Button>
              )}

              <Link href={`/student/learning/${params.lessonId}`} className="flex-1">
                <Button variant="outline" size="lg" className="w-full font-bold">
                  ← Quay lại bài học
                </Button>
              </Link>
            </div>
          </Card>
        )}
      </div>

      {/* Modal Xác nhận trước khi vào làm bài */}
      {showConfirmStartModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <Card className="max-w-md w-full p-6 space-y-4 shadow-2xl border border-blue-200">
            <div className="flex items-center gap-3 text-[#2563EB]">
              <span className="text-3xl">⏱️</span>
              <h4 className="text-base font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                Xác nhận bắt đầu bài kiểm tra?
              </h4>
            </div>
            <div className="text-xs text-[#434655] space-y-2 leading-relaxed">
              <p>
                Đồng hồ đếm ngược sẽ bắt đầu chạy ngay khi bạn xác nhận.
              </p>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1 text-amber-900 font-medium">
                <p>⚠️ <strong>Lưu ý:</strong></p>
                <p>• Trong khi làm bài, bạn <strong>không thể quay lại</strong> nếu chưa <strong>Nộp</strong> hoặc <strong>Hủy bài</strong>.</p>
                <p>• Đóng trình duyệt sẽ được tính là <strong>Hủy bài</strong>.</p>
                <p>• Mỗi lần làm (dù Nộp hay Hủy) đều phải đợi <strong>{QUIZ_COOLDOWN_HOURS} giờ</strong> mới có thể làm lại.</p>
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
                  setStarted(true);
                }}
              >
                Tôi đã hiểu, Bắt đầu!
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
