'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import { apiFetch } from '@/lib/api/client';

export default function OrganizationMemberProgressPage() {
  const params = useParams<{ unitId: string; userId: string }>();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/v1/organization/units/${params.unitId}/members/${params.userId}/progress`, { noCache: true }).then((result) => {
      if (cancelled) return;
      if (result.ok) setData(result.data);
      else if (result.status === 401) router.replace('/login');
      else setError(result.error?.message || 'Không thể tải chi tiết tiến trình trong phạm vi này.');
    }).catch(() => { if (!cancelled) setError('Không thể kết nối để tải tiến trình.'); });
    return () => { cancelled = true; };
  }, [params.unitId, params.userId, router]);

  if (error) return <Card className="p-8"><p className="text-sm text-red-700">{error}</p><Link href="/organization-manager" className="mt-4 inline-block text-sm font-semibold text-blue-700">← Quay lại danh sách</Link></Card>;
  if (!data) return <div className="text-sm text-[#737686]">Đang tải tiến trình…</div>;

  return <div className="mx-auto max-w-6xl space-y-6">
    <Link href="/organization-manager" className="text-sm font-semibold text-blue-700">← Quay lại thành viên</Link>
    <header><p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">Member learning detail</p><h1 className="mt-1 text-3xl font-bold text-[#172554]">{data.user.email}</h1><p className="mt-1 text-sm text-[#737686]">Tham gia {new Date(data.user.joinedAt).toLocaleDateString('vi-VN')} · Trạng thái {data.user.status}</p></header>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card><p className="text-xs text-[#737686]">Tiến độ tổng</p><p className="mt-1 text-2xl font-bold text-blue-700">{data.summary.avgProgress}%</p></Card>
      <Card><p className="text-xs text-[#737686]">Khóa hoàn tất</p><p className="mt-1 text-2xl font-bold text-[#172554]">{data.summary.completedCourses}/{data.summary.totalCourses}</p></Card>
      <Card><p className="text-xs text-[#737686]">Bài hoàn tất</p><p className="mt-1 text-2xl font-bold text-[#172554]">{data.summary.completedLessons}/{data.summary.totalLessons}</p></Card>
      <Card><p className="text-xs text-[#737686]">Star</p><p className="mt-1 text-2xl font-bold text-amber-600">⭐ {data.summary.stars}</p></Card>
    </div>
    <div className="space-y-5">{data.learningDetail.map((course: any) => <Card key={course.courseId} className="space-y-5 border border-[#eff4ff]">
      <h2 className="text-xl font-bold text-[#172554]">{course.title}</h2>
      {course.finalAssessment && <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-sm"><p className="font-semibold text-[#172554]">Bài thi cuối khóa: {course.finalAssessment.title}</p><p className="mt-1 text-xs text-[#596174]">{course.finalAssessment.latestAttempt ? `Lần ${course.finalAssessment.latestAttempt.number}/${course.finalAssessment.attemptCount} · ${course.finalAssessment.latestAttempt.scorePercent ?? '—'}% · ${course.finalAssessment.latestAttempt.passed ? 'Đạt' : 'Chưa đạt'} · ${course.finalAssessment.latestAttempt.status}` : `Chưa nộp bài (${course.finalAssessment.attemptCount} lần)`} · ⭐ {course.finalAssessment.stars || 0}</p>{course.finalAssessment.latestAttempt?.submittedAt && <p className="mt-1 text-[11px] text-[#737686]">Nộp lúc {new Date(course.finalAssessment.latestAttempt.submittedAt).toLocaleString('vi-VN')}</p>}</div>}
      {course.modules.map((module: any) => <section key={module.moduleId} className="space-y-3">
        <h3 className="border-b border-[#eff4ff] pb-2 text-sm font-bold text-blue-800">Module: {module.title}</h3>
        {module.lessons.map((lesson: any) => <div key={lesson.lessonId} className="rounded-xl border border-[#eff4ff] bg-[#fbfcff] p-4">
          <p className="font-semibold text-[#172554]">{lesson.title}</p>
          <div className="mt-2 grid gap-3 text-sm md:grid-cols-2">
            {lesson.video && <div className="rounded-lg bg-white p-3"><p className="font-semibold">Video: {lesson.video.title}</p><p className="mt-1 text-xs text-[#737686]">{lesson.video.watchedSeconds}s / {lesson.video.durationSeconds}s · {lesson.video.watchedPercent}% · {lesson.video.completed ? 'Hoàn thành' : 'Chưa hoàn thành'}</p><p className="mt-1 text-xs text-amber-700">⭐ {lesson.video.stars}</p>{lesson.video.completedAt && <p className="text-[11px] text-[#737686]">Hoàn tất {new Date(lesson.video.completedAt).toLocaleString('vi-VN')}</p>}</div>}
            {lesson.quiz && <div className="rounded-lg bg-white p-3"><p className="font-semibold">Quiz: {lesson.quiz.title}</p><p className="mt-1 text-xs text-[#737686]">{lesson.quiz.attemptCount} lần nộp · ⭐ {lesson.quiz.stars}</p>{lesson.quiz.latestAttempt ? <p className="mt-1 text-xs text-[#596174]">Điểm {lesson.quiz.latestAttempt.scorePercent ?? '—'}% · {lesson.quiz.latestAttempt.passed ? 'Đạt' : 'Chưa đạt'} · {lesson.quiz.latestAttempt.status}</p> : <p className="mt-1 text-xs text-[#737686]">Chưa có lần nộp</p>}</div>}
          </div>
        </div>)}
      </section>)}
    </Card>)}</div>
  </div>;
}
