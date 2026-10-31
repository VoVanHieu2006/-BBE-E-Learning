'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import LessonQuiz from '@/components/lesson/LessonQuiz';
import StarRewardCelebration from '@/components/StarRewardCelebration';
import { apiFetch } from '@/lib/api/client';

export default function StudentCourseFinalExamPage({ params }: { params: { courseId: string } }) {
  const [token, setToken] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [started, setStarted] = useState(false);
  const [attemptKey, setAttemptKey] = useState(0);
  const [starReward, setStarReward] = useState<number | null>(null);
  const seenRewardKeysRef = useRef<Set<string>>(new Set());
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [clockNow, setClockNow] = useState(0);

  const showToast = (type: 'success' | 'error' | 'info', message: string, title?: string) => {
    setToast({ type, message, title });
  };

  useEffect(() => {
    const accessToken = typeof window !== 'undefined' ? localStorage.getItem('accessToken') || '' : '';
    if (!accessToken) {
      window.location.href = '/login?callbackUrl=' + encodeURIComponent(window.location.pathname);
      return;
    }
    setToken(accessToken);
    void load(accessToken);
  }, [params.courseId]);

  useEffect(() => {
    if (!data?.cooldownUntil) return;
    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [data?.cooldownUntil]);

  async function load(accessToken: string) {
    setLoading(true);
    setLoadError('');
    const result = await apiFetch(`/api/v1/courses/${params.courseId}/final-assessment`, { noCache: true, token: accessToken });
    if (!result.ok || !result.data) {
      setLoadError(result.error?.message || 'Không tải được bài thi cuối khóa.');
      setData(null);
    } else {
      setData(result.data);
    }
    setLoading(false);
  }

  const assessment = data?.assessment;
  const assessmentId = assessment?.assessmentId || assessment?.id;
  const cooldownRemainingMs = data?.cooldownUntil
    ? Math.max(0, new Date(data.cooldownUntil).getTime() - clockNow)
    : 0;
  const cooldownSeconds = Math.ceil(cooldownRemainingMs / 1000);
  const cooldownLabel = `${Math.floor(cooldownSeconds / 3600).toString().padStart(2, '0')}:${Math.floor((cooldownSeconds % 3600) / 60).toString().padStart(2, '0')}:${(cooldownSeconds % 60).toString().padStart(2, '0')}`;
  const canStart = Boolean(data?.canStart && !data?.alreadyPassed);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-[#f8f9ff]"><p className="text-sm text-slate-500">Đang tải bài thi cuối khóa…</p></div>;
  }

  return (
    <div className="min-h-screen bg-[#f8f9ff] text-[#0b1c30]">
      <Toast toast={toast} onClose={() => setToast(null)} />
      {starReward && <StarRewardCelebration amount={starReward} message="Bạn đã vượt qua bài thi cuối khóa!" />}
      <header data-quiz-header className="sticky top-0 z-30 flex items-center justify-between border-b border-[#e5eeff] bg-white px-5 py-4 shadow-sm">
        <div>
          <h1 className="font-bold text-[#172554]">Bài thi cuối khóa</h1>
          <p className="text-xs text-slate-500">{data?.courseTitle || 'Khóa học'}</p>
        </div>
        {!started && <Link href={`/student/courses/${params.courseId}`} className="text-sm font-semibold text-blue-700">← Về khóa học</Link>}
      </header>

      <main className={`mx-auto ${started ? 'max-w-5xl' : 'max-w-3xl'} p-4 md:p-8`}>
        {loadError ? (
          <Card className="space-y-4 p-8 text-center">
            <h2 className="font-bold text-[#172554]">Chưa thể tải bài thi</h2>
            <p className="text-sm text-slate-600">{loadError}</p>
            <Link href={`/student/courses/${params.courseId}`}><Button variant="outline">Quay về khóa học</Button></Link>
          </Card>
        ) : !assessmentId ? (
          <Card className="space-y-4 p-8 text-center">
            <h2 className="font-bold text-[#172554]">Khóa học chưa có bài thi cuối khóa</h2>
            <p className="text-sm text-slate-600">Hãy tiếp tục học các video và quiz từng bài trong khóa học.</p>
            <Link href={`/student/courses/${params.courseId}`}><Button>Về danh sách bài học</Button></Link>
          </Card>
        ) : started ? (
          <LessonQuiz
            key={`course-final-${attemptKey}`}
            lessonId={params.courseId}
            assessmentId={assessmentId}
            lessonTitle={data.courseTitle || 'Khóa học'}
            accessToken={token}
            isCompleted={Boolean(data.alreadyPassed)}
            assessmentLabel="Bài thi cuối khóa"
            returnHref={`/student/courses/${params.courseId}`}
            onQuizPassed={() => setData((previous: any) => previous ? { ...previous, alreadyPassed: true, canStart: false } : previous)}
            onSubmitted={(result) => {
              if (result?.starReward?.awarded && Number(result.starReward.amount) > 0) {
                const rewardKey = result.starReward.rewardKey || `final:${result.attemptId}:${result.starReward.amount}`;
                if (!seenRewardKeysRef.current.has(rewardKey)) {
                  seenRewardKeysRef.current.add(rewardKey);
                  setStarReward(Number(result.starReward.amount));
                  window.setTimeout(() => setStarReward(null), 3600);
                }
              }
              if (result?.passed) setData((previous: any) => previous ? { ...previous, alreadyPassed: true, canStart: false } : previous);
            }}
            onCancel={() => {
              setStarted(false);
              void load(token);
            }}
            onToast={showToast}
          />
        ) : (
          <Card className="space-y-6 border border-amber-100 p-6 shadow-sm md:p-8">
            <div className="space-y-2">
              <p className="text-sm font-bold uppercase tracking-wide text-amber-600">Thiết lập hoàn thành khóa học</p>
              <h2 className="text-2xl font-extrabold text-[#172554]">{assessment.title || 'Bài thi cuối khóa'}</h2>
              <p className="text-sm leading-relaxed text-slate-600">{assessment.description || 'Bạn cần đạt tối thiểu 85% để hoàn thành khóa học.'}</p>
            </div>

            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-xl bg-blue-50 px-3 py-2 text-blue-700">{assessment.questionCount || 0} câu hỏi</span>
              <span className="rounded-xl bg-blue-50 px-3 py-2 text-blue-700">{assessment.durationMinutes || 0} phút</span>
              <span className="rounded-xl bg-blue-50 px-3 py-2 text-blue-700">Đạt từ 85%</span>
              <span className="rounded-xl bg-amber-50 px-3 py-2 text-amber-800">Thưởng tối đa 5 ⭐, một lần</span>
            </div>

            {data.alreadyPassed ? (
              <div className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
                <p className="font-bold">Bạn đã vượt qua bài thi cuối khóa 🎉</p>
                <p className="text-sm">Kết quả và Star đã được ghi nhận. Có thể xem lại tiến trình trong khóa học.</p>
              </div>
            ) : !canStart ? (
              <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
                <p className="font-bold">{cooldownRemainingMs > 0 ? 'Đang trong thời gian giãn cách' : 'Bài thi hiện đang khóa'}</p>
                <p className="text-sm leading-relaxed">
                  {cooldownRemainingMs > 0
                    ? `Bạn có thể làm lại sau ${cooldownLabel}.`
                    : data.gateMessage || 'Hoàn thành các nội dung bắt buộc trước khi bắt đầu.'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">Bài thi mở sau khi bạn hoàn tất 100% video và đạt mọi quiz từng bài học. Điều kiện được xác minh khi bắt đầu; lượt đang làm tiếp tục theo phiên bản đề đã nhận.</p>
                <Button onClick={() => { setAttemptKey((key) => key + 1); setStarted(true); }} className="w-full sm:w-auto">Bắt đầu bài thi cuối khóa</Button>
              </div>
            )}

            {Array.isArray(data.attempts) && data.attempts.length > 0 && (
              <div className="border-t border-slate-100 pt-4">
                <h3 className="mb-2 text-sm font-bold text-[#172554]">Lịch sử làm bài</h3>
                <ul className="space-y-2">
                  {data.attempts.map((attempt: any) => (
                    <li key={attempt.attemptId} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs">
                      <span>Lần {attempt.attemptNumber}{attempt.versionNumber ? ` · Đề v${attempt.versionNumber}` : ''} · {attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleDateString('vi-VN') : 'Đang làm'}</span>
                      <span className={attempt.passed ? 'font-bold text-emerald-700' : 'text-slate-600'}>
                        {attempt.score === null ? attempt.status : `${attempt.score}%${attempt.passed ? ' · Đạt' : ' · Chưa đạt'}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}
      </main>
    </div>
  );
}
