'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import LessonQuiz from '@/components/lesson/LessonQuiz';
import { apiFetch } from '@/lib/api/client';

interface AttemptItem {
  attemptId: string;
  attemptNumber: number;
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'CANCELLED';
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
  const [attempts, setAttempts] = useState<AttemptItem[]>([]);
  const [attemptsAvailable, setAttemptsAvailable] = useState(false);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [started, setStarted] = useState(false);
  const [passedNow, setPassedNow] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

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

    const lessonRes = await apiFetch(`/api/v1/lessons/${params.lessonId}`, { noCache: true, token: accessToken });
    if (!lessonRes.ok || !lessonRes.data) {
      setLoadError(lessonRes.error?.message || 'Không tải được bài học này.');
      setLoading(false);
      return;
    }
    setLesson(lessonRes.data);

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

    if (userRole === 'MEMBER') {
      const progressRes = await apiFetch(`/api/v1/lessons/${params.lessonId}/progress`, {
        noCache: true,
        token: accessToken,
      });
      if (progressRes.ok && progressRes.data?.completed) setQuizCompleted(true);
    }

    setLoading(false);
  }

  // ─── Derived data for the start screen ───────────────────────────────────────
  const assessment = lesson?.assessment;
  const assessmentId = assessment?.assessmentId || assessment?.id;
  const questionCount = Number(assessment?.questionCount || 0);
  const durationMinutes = questionCount * 2;
  const inProgressAttempt = attempts.find((a) => a.status === 'IN_PROGRESS');
  const latestSubmitted = attempts.find((a) => a.status === 'SUBMITTED');
  const submittedCount = attempts.filter((a) => a.status === 'SUBMITTED').length;

  const formatDate = (value: string | null) =>
    value ? new Date(value).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '';

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

  return (
    <div className="min-h-screen bg-[#f8f9ff] text-[#0b1c30]">
      <Toast toast={toast} onClose={() => setToast(null)} />

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
        <Link
          href={`/student/learning/${params.lessonId}`}
          className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#eff4ff] hover:bg-[#cbdbf5] text-[#172554] text-xs font-bold transition shadow-xs"
        >
          ← Bài học
        </Link>
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
                setPassedNow(true);
              }}
              onToast={showToast}
            />
            <Link
              href={`/student/learning/${params.lessonId}`}
              className="block text-center text-xs font-bold text-[#2563EB] hover:underline"
            >
              ← Quay lại bài học
            </Link>
          </div>
        ) : (
          <Card className="p-6 md:p-8 space-y-6">
            {/* Quy tắc bài kiểm tra */}
            <div className="space-y-3">
              <h2 className="text-lg font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                Sẵn sàng làm bài kiểm tra?
              </h2>
              <div className="flex flex-wrap gap-2 text-xs font-semibold">
                <span className="px-3 py-1.5 bg-[#eff4ff] text-[#2563EB] rounded-xl">{questionCount} câu hỏi</span>
                <span className="px-3 py-1.5 bg-[#eff4ff] text-[#2563EB] rounded-xl">Thời gian: {durationMinutes} phút</span>
                <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl">
                  Đạt từ 85% để hoàn thành
                </span>
              </div>
              <p className="text-xs text-[#737686] leading-relaxed">
                Bấm "Bắt đầu làm bài" là đồng hồ đếm ngược bắt đầu chạy. Hết thời gian hệ thống sẽ tự động nộp bài.
              </p>
            </div>

            {/* Lịch sử làm bài của chính thành viên này */}
            {attemptsAvailable && (
              <div className="p-4 bg-[#f8f9ff] border border-[#eff4ff] rounded-2xl space-y-2">
                <h3 className="text-xs font-bold text-[#172554] uppercase tracking-wide">Kết quả của bạn</h3>

                {attempts.length === 0 ? (
                  <p className="text-xs text-[#737686]">Bạn chưa làm bài kiểm tra này.</p>
                ) : (
                  <div className="space-y-2">
                    {inProgressAttempt && (
                      <p className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                        ⏳ Bạn có bài đang làm dở (đã làm {inProgressAttempt.attemptNumber} lượt tính cả bài này).
                      </p>
                    )}

                    {latestSubmitted && (
                      <div
                        className={`p-3 rounded-xl border text-xs space-y-1 ${
                          latestSubmitted.passed
                            ? 'bg-emerald-50 border-emerald-200'
                            : 'bg-orange-50 border-orange-200'
                        }`}
                      >
                        <p className="font-bold text-[#172554]">
                          Lần gần nhất: {Math.round(latestSubmitted.score || 0)}% —{' '}
                          {latestSubmitted.passed ? '✓ Đạt' : '✗ Chưa đạt'}
                        </p>
                        <p className="text-[#737686]">Nộp lúc: {formatDate(latestSubmitted.submittedAt)}</p>
                      </div>
                    )}

                    <p className="text-[11px] text-[#737686]">Đã làm {submittedCount} lượt.</p>
                  </div>
                )}
              </div>
            )}

            {/* Hành động */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                variant="primary"
                size="lg"
                className="flex-1"
                onClick={() => setStarted(true)}
              >
                {inProgressAttempt ? '▶ Tiếp tục bài đang làm' : quizCompleted ? '🔄 Làm lại bài kiểm tra' : '▶ Bắt đầu làm bài'}
              </Button>
              <Link href={`/student/learning/${params.lessonId}`} className="flex-1">
                <Button variant="outline" size="lg" className="w-full">
                  ← Quay lại bài học
                </Button>
              </Link>
            </div>

            {passedNow && (
              <p className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-center">
                🎉 Bạn đã hoàn thành bài kiểm tra này! Có thể quay lại bài học để học bài tiếp theo.
              </p>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
