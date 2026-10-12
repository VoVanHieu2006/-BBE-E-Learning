'use client';
import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { apiFetch, getCachedApiData } from '@/lib/api/client';

const STATE_META: Record<string, { label: string; badge: string; bar: string }> = {
  COMPLETED: { label: '✓ Đã hoàn thành', badge: 'bg-green-100 text-green-700', bar: 'bg-green-500' },
  IN_PROGRESS: { label: 'Đang học', badge: 'bg-blue-100 text-blue-700', bar: 'bg-[#2563EB]' },
  NOT_STARTED: { label: 'Chưa học', badge: 'bg-slate-100 text-slate-600', bar: 'bg-slate-300' },
};

export default function ChapterManagerCoursesPage() {
  const [user, setUser] = useState<any>(null);
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal: Học viên của khóa
  const [studentsModal, setStudentsModal] = useState<any | null>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [studentsSummary, setStudentsSummary] = useState<any>(null);
  const [studentsLoading, setStudentsLoading] = useState(false);

  // Modal: Nội dung khóa học + xem trước video
  const [contentModal, setContentModal] = useState<any | null>(null);
  const [contentLoading, setContentLoading] = useState(false);

  useEffect(() => {
    let currentChapter = 'me';
    if (typeof window !== 'undefined') {
      const u = localStorage.getItem('user');
      if (u) {
        try {
          const parsed = JSON.parse(u);
          setUser(parsed);
          currentChapter = parsed.chapterId || 'me';
        } catch {}
      }

      // Read cache immediately on client mount
      const url = `/api/v1/chapters/${currentChapter}/dashboard/courses`;
      const cached = getCachedApiData<any>(url);
      if (cached?.items) {
        setCourses(cached.items);
        setLoading(false);
      }
    }
    loadCourses();
  }, []);

  async function loadCourses(noCache = false) {
    const targetChapter = user?.chapterId || (typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('user') || 'null')?.chapterId : null) || 'me';
    const url = `/api/v1/chapters/${targetChapter}/dashboard/courses`;

    const cached = noCache ? null : getCachedApiData<any>(url);
    if (cached?.items) {
      setCourses(cached.items);
    } else {
      setLoading(true);
    }

    const res = await apiFetch(url, { noCache });
    if (res.ok && res.data) {
      setCourses(res.data.items || []);
    }
    setLoading(false);
  }

  // ─── Modal 1: Học viên trong khóa ─────────────────────────────────────────────
  const openStudents = async (course: any) => {
    setStudentsModal(course);
    setStudents([]);
    setStudentsSummary(null);
    setStudentsLoading(true);
    const res = await apiFetch(`/api/v1/courses/${course.courseId || course.id}/students`);
    if (res.ok && res.data) {
      setStudents(res.data.items || []);
      setStudentsSummary(res.data.summary || null);
    }
    setStudentsLoading(false);
  };

  // ─── Modal 2: Nội dung khóa + preview video ───────────────────────────────────
  const openContent = async (course: any) => {
    setContentModal(course);
    setContentLoading(true);
    const res = await apiFetch(`/api/v1/courses/${course.courseId || course.id}`);
    if (res.ok && res.data) {
      setContentModal(res.data);
    }
    setContentLoading(false);
  };

  const formatDuration = (sec?: number) => {
    const s = Number(sec) || 0;
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  };

  const renderStudentRow = (st: any) => {
    const meta = STATE_META[st.state] || STATE_META.NOT_STARTED;
    return (
      <div key={st.userId} className="px-5 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-[#172554] truncate">{st.email}</p>
            <p className="text-xs text-[#737686]">
              {st.completedLessons}/{st.totalLessons} bài học
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.badge}`}>{meta.label}</span>
            <span className="font-bold text-[#2563EB] w-11 text-right">{st.progressPercent}%</span>
          </div>
        </div>
        <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2 overflow-hidden">
          <div className={`${meta.bar} h-full rounded-full`} style={{ width: `${st.progressPercent}%` }} />
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#f8f9ff]">
      <main className="max-w-5xl mx-auto px-8 py-10">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              Thống kê khóa học Chapter
            </h1>
            <p className="text-[#737686] mt-1">Tỷ lệ hoàn thành, học viên, nội dung và bài kiểm tra của từng khóa học</p>
          </div>
          <button
            onClick={() => loadCourses(true)}
            className="px-4 py-2 bg-white border border-[#cbdbf5] hover:bg-[#eff4ff] text-[#172554] text-sm font-medium rounded-xl shadow-sm transition"
          >
            🔄 Làm mới
          </button>
        </div>

        {loading && courses.length === 0 ? (
          <div className="text-center py-12 text-[#737686]">Đang tải dữ liệu...</div>
        ) : courses.length === 0 ? (
          <Card className="text-center py-12">
            <p className="text-[#172554] font-semibold text-lg mb-2">Chưa có khóa học nào được công khai</p>
            <p className="text-sm text-[#737686]">Các khóa học do Admin công khai sẽ hiển thị tại đây.</p>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {courses.map((c) => {
              const cId = c.courseId || c.id;
              return (
                <Card key={cId} className="p-6">
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="text-lg font-bold text-[#172554]">{c.title}</h3>
                    <span className="bg-[#eff4ff] text-[#2563EB] text-xs font-bold px-2.5 py-1 rounded-full">
                      {c.completionRate || 0}% hoàn thành
                    </span>
                  </div>
                  {c.description && <p className="text-sm text-[#434655] mb-4 line-clamp-2">{c.description}</p>}
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-xs text-[#737686]">
                      <span>Số thành viên hoàn thành 100%</span>
                      <span className="font-bold text-[#172554]">
                        {c.completedCount || 0} / {c.totalMembers || 0} học viên
                      </span>
                    </div>
                    <div className="h-2.5 bg-[#eff4ff] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#2563EB] rounded-full transition-all"
                        style={{ width: `${c.completionRate || 0}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-[#eff4ff]">
                    <Button size="sm" variant="secondary" onClick={() => openStudents(c)}>
                      👥 Học viên
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => openContent(c)}>
                      ▶ Nội dung & Quiz
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Modal: Học viên trong khóa */}
        <Modal
          isOpen={!!studentsModal}
          onClose={() => setStudentsModal(null)}
          maxWidth="max-w-2xl"
        >
          <div className="p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-[#eff4ff] pb-3">
              <div>
                <h3 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                  👥 Học viên — {studentsModal?.title}
                </h3>
                {studentsSummary && (
                  <p className="text-xs text-[#737686] mt-1">
                    {studentsSummary.totalStudents} thành viên • {studentsSummary.completed} hoàn thành •{' '}
                    {studentsSummary.inProgress} đang học • {studentsSummary.notStarted} chưa học
                  </p>
                )}
              </div>
              <button
                onClick={() => setStudentsModal(null)}
                className="text-[#737686] hover:text-[#172554] text-xl font-bold p-1 rounded-lg hover:bg-slate-100 transition"
              >
                ✕
              </button>
            </div>

            {studentsLoading ? (
              <div className="py-12 text-center text-[#737686]">Đang tải danh sách học viên...</div>
            ) : students.length === 0 ? (
              <div className="text-center py-10 text-[#737686]">Chưa có thành viên nào trong chapter.</div>
            ) : (
              <div className="divide-y divide-[#eff4ff]">{students.map(renderStudentRow)}</div>
            )}

            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={() => setStudentsModal(null)}>
                Đóng
              </Button>
            </div>
          </div>
        </Modal>

        {/* Modal: Nội dung khóa học (outline only; media is progression-gated) */}
        <Modal
          isOpen={!!contentModal}
          onClose={() => setContentModal(null)}
          maxWidth="max-w-2xl"
        >
          <div className="p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-[#eff4ff] pb-3">
              <div>
                <h3 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                  📚 Nội dung — {contentModal?.title}
                </h3>
                <p className="text-xs text-[#737686] mt-1">
                  Video và tài liệu được mở trong lộ trình học theo thứ tự.
                </p>
              </div>
              <button
                onClick={() => setContentModal(null)}
                className="text-[#737686] hover:text-[#172554] text-xl font-bold p-1 rounded-lg hover:bg-slate-100 transition"
              >
                ✕
              </button>
            </div>

            {contentLoading ? (
              <div className="py-12 text-center text-[#737686]">Đang tải nội dung khóa học...</div>
            ) : !contentModal?.sessions || contentModal.sessions.length === 0 ? (
              <div className="text-center py-10 text-[#737686]">Khóa học chưa có buổi học nào.</div>
            ) : (
              <div className="space-y-4">
                {contentModal.sessions.map((session: any, sIdx: number) => (
                  <div key={session.sessionId || session.id} className="border border-[#eff4ff] rounded-2xl overflow-hidden">
                    <div className="px-4 py-2.5 bg-[#f8f9ff] border-b border-[#eff4ff] flex items-center gap-2">
                      <span className="w-6 h-6 bg-[#2563EB] text-white rounded-lg flex items-center justify-center font-bold text-[11px]">
                        {sIdx + 1}
                      </span>
                      <h4 className="font-bold text-sm text-[#172554]">{session.title}</h4>
                    </div>
                    {!session.lessons || session.lessons.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-[#737686]">Chưa có bài học.</p>
                    ) : (
                      <div className="divide-y divide-[#eff4ff]">
                        {session.lessons.map((lesson: any, lIdx: number) => {
                          const lId = lesson.lessonId || lesson.id;
                          const durSec = lesson.video?.durationSeconds || lesson.durationSeconds || 0;
                          return (
                            <div key={lId} className="px-4 py-3 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-semibold text-sm text-[#172554] truncate">
                                  {sIdx + 1}.{lIdx + 1} {lesson.title}
                                </p>
                                <p className="text-xs text-[#737686]">
                                  Thời lượng: {formatDuration(durSec)}
                                  {lesson.documents?.length > 0 ? ` • ${lesson.documents.length} tài liệu` : ''}
                                </p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {lesson.assessment && (
                                  <span className="text-xs text-slate-500">
                                    📝 Quiz: {lesson.assessment.questionCount || lesson.assessment._count?.questions || 0} câu
                                  </span>
                                )}
                                {lesson.hasVideo && (
                                  <span className="text-xs text-slate-500">▶ Video</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={() => setContentModal(null)}>
                Đóng
              </Button>
            </div>
          </div>
        </Modal>

      </main>
    </div>
  );
}
