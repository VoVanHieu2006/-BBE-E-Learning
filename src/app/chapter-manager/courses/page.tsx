'use client';
import { useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import YouTubePlayer from '@/components/YouTubePlayer';
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

  // Modal: Xem video (có thể tua)
  const [videoModal, setVideoModal] = useState<{ title: string; youtubeVideoId?: string } | null>(null);

  // Modal: Xem quiz / câu hỏi & kết quả
  const [quizModal, setQuizModal] = useState<{ assessmentId: string; title: string } | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [quizData, setQuizData] = useState<any | null>(null);
  const [quizSearch, setQuizSearch] = useState('');

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
    const chapterId = user?.chapterId || JSON.parse(localStorage.getItem('user') || '{}')?.chapterId;
    const url = `/api/v1/courses/${course.courseId || course.id}/students?chapterId=${encodeURIComponent(chapterId || '')}`;
    const cached = getCachedApiData<any>(url);
    if (cached) {
      setStudents(cached.items || []);
      setStudentsSummary(cached.summary || null);
      setStudentsLoading(false);
    } else {
      setStudents([]);
      setStudentsSummary(null);
      setStudentsLoading(true);
    }
    const res = await apiFetch(url);
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

  function extractYouTubeId(raw?: string): string {
    if (!raw) return '';
    const text = raw.trim();
    const match = text.match(
      /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?\/\s]{11})/i
    );
    if (match && match[1]) return match[1];
    if (/^[a-zA-Z0-9_-]{11}$/.test(text)) return text;
    return text;
  }

  const openVideoModal = (lesson: any) => {
    const vidId = lesson.video?.youtubeVideoId || lesson.youtubeVideoId || '';
    setVideoModal({
      title: lesson.title,
      youtubeVideoId: vidId,
    });
  };

  const openQuizModal = async (assessment: any, title?: string) => {
    const aId = assessment.assessmentId || assessment.id;
    if (!aId) return;
    setQuizModal({ assessmentId: aId, title: title || assessment.title || 'Bài kiểm tra' });
    setQuizSearch('');
    setQuizLoading(true);
    setQuizData(null);
    const res = await apiFetch(`/api/v1/assessments/${aId}`);
    if (res.ok && res.data) {
      setQuizData(res.data);
    }
    setQuizLoading(false);
  };

  const filteredQuestions = (quizData?.questions || []).filter((q: any) => {
    if (!quizSearch.trim()) return true;
    const term = quizSearch.toLowerCase().trim();
    const inQuestion = (q.questionText || '').toLowerCase().includes(term);
    const inOptions = (q.options || []).some((o: any) => (o.optionText || '').toLowerCase().includes(term));
    const inExplanation = (q.explanation || '').toLowerCase().includes(term);
    return inQuestion || inOptions || inExplanation;
  });

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
            <p className="font-semibold text-[#172554] truncate">{st.displayName || 'Chưa cập nhật tên'}</p>
            <p className="text-[11px] text-[#737686] truncate">{st.email}</p>
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
                              <div className="flex flex-wrap items-center gap-2 shrink-0">
                                {lesson.hasVideo && (
                                  <button
                                    type="button"
                                    onClick={() => openVideoModal(lesson)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-[#2563EB] hover:bg-blue-100 transition shadow-sm border border-blue-200/60"
                                    title="Xem video bài học (cho phép tua)"
                                  >
                                    <span>▶</span> Xem video
                                  </button>
                                )}
                                {lesson.assessment && (
                                  <button
                                    type="button"
                                    onClick={() => openQuizModal(lesson.assessment, lesson.title)}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 text-amber-700 hover:bg-amber-100 transition shadow-sm border border-amber-200/60"
                                    title="Xem toàn bộ câu hỏi và kết quả quiz"
                                  >
                                    <span>📝</span> Xem quiz ({lesson.assessment.questionCount || lesson.assessment._count?.questions || 0} câu)
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
                {contentModal.finalAssessment && (
                  <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 bg-amber-200/80 px-2 py-0.5 rounded-md">
                          Đánh giá cuối khóa
                        </span>
                        <h4 className="font-bold text-sm text-[#172554]">{contentModal.finalAssessment.title || 'Bài kiểm tra cuối khóa'}</h4>
                      </div>
                      <p className="text-xs text-[#737686] mt-1">
                        {contentModal.finalAssessment.questionCount || contentModal.finalAssessment._count?.questions || 0} câu hỏi đánh giá tổng hợp khóa học
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openQuizModal(contentModal.finalAssessment, 'Bài kiểm tra cuối khóa')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 transition shadow-sm shrink-0"
                    >
                      <span>📝</span> Xem quiz cuối khóa
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-[#eff4ff]">
              <Button variant="secondary" onClick={() => setContentModal(null)}>
                Đóng
              </Button>
            </div>
          </div>
        </Modal>

        {/* Modal: Xem video (có thể tua) */}
        <Modal
          isOpen={!!videoModal}
          onClose={() => setVideoModal(null)}
          maxWidth="max-w-3xl"
        >
          <div className="p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-[#eff4ff] pb-3">
              <div>
                <span className="text-[11px] font-bold px-2 py-0.5 bg-blue-100 text-[#2563EB] rounded-md">
                  Chế độ BĐHU (Có thể tua video)
                </span>
                <h3 className="text-lg font-bold text-[#172554] mt-1" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                  ▶ {videoModal?.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setVideoModal(null)}
                className="text-[#737686] hover:text-[#172554] text-xl font-bold p-1 rounded-lg hover:bg-slate-100 transition"
              >
                ✕
              </button>
            </div>

            {videoModal && (
              <div className="space-y-3">
                {extractYouTubeId(videoModal.youtubeVideoId) ? (
                  <div className="w-full rounded-2xl overflow-hidden shadow-lg border border-[#cbdbf5]">
                    <YouTubePlayer
                      youtubeVideoId={extractYouTubeId(videoModal.youtubeVideoId)}
                      lessonId="chapter-preview"
                      allowFreeSeek={true}
                    />
                  </div>
                ) : (
                  <div className="p-12 text-center text-[#737686] bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    <p className="text-3xl mb-2">📹</p>
                    <p className="font-semibold text-[#172554]">Chưa cấu hình Video ID cho bài học này</p>
                    <p className="text-xs text-[#737686] mt-1">Vui lòng cập nhật YouTube Video ID trong trang quản trị khóa học.</p>
                  </div>
                )}
                <p className="text-xs text-[#737686] flex items-center gap-1.5">
                  <span>💡</span> Video trong chế độ xem trước dành cho Ban Định Hướng, hỗ trợ tua thời gian và chỉnh tốc độ tự do.
                </p>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-[#eff4ff]">
              <Button variant="secondary" onClick={() => setVideoModal(null)}>
                Đóng
              </Button>
            </div>
          </div>
        </Modal>

        {/* Modal: Xem toàn bộ câu hỏi và kết quả quiz */}
        <Modal
          isOpen={!!quizModal}
          onClose={() => setQuizModal(null)}
          maxWidth="max-w-3xl"
        >
          <div className="p-6 space-y-4 max-h-[88vh] flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center border-b border-[#eff4ff] pb-3 shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold px-2 py-0.5 bg-amber-100 text-amber-800 rounded-md">
                    Ngân hàng câu hỏi & Đáp án
                  </span>
                  {quizData && (
                    <span className="text-xs font-semibold text-[#737686]">
                      {quizData.questions?.length || 0} câu hỏi
                    </span>
                  )}
                </div>
                <h3 className="text-lg font-bold text-[#172554] mt-1" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                  📝 {quizModal?.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setQuizModal(null)}
                className="text-[#737686] hover:text-[#172554] text-xl font-bold p-1 rounded-lg hover:bg-slate-100 transition"
              >
                ✕
              </button>
            </div>

            {/* Search Box */}
            <div className="shrink-0">
              <div className="relative">
                <input
                  type="text"
                  value={quizSearch}
                  onChange={(e) => setQuizSearch(e.target.value)}
                  placeholder="🔍 Tìm kiếm câu hỏi, nội dung đáp án hoặc giải thích..."
                  className="w-full px-4 py-2.5 text-sm border border-[#cbdbf5] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2563EB] pr-10"
                />
                {quizSearch && (
                  <button
                    type="button"
                    onClick={() => setQuizSearch('')}
                    className="absolute right-3 top-3 text-xs text-[#737686] hover:text-[#172554] font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>
              {quizData && quizSearch && (
                <p className="text-xs text-[#737686] mt-1.5">
                  Tìm thấy <strong className="text-[#172554]">{filteredQuestions.length}</strong> câu hỏi phù hợp với từ khóa &ldquo;{quizSearch}&rdquo;
                </p>
              )}
            </div>

            {/* Content / Question List */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-4">
              {quizLoading ? (
                <div className="py-16 text-center text-[#737686] space-y-2">
                  <div className="animate-spin text-2xl">⏳</div>
                  <p className="text-sm">Đang tải câu hỏi và kết quả quiz...</p>
                </div>
              ) : !quizData?.questions || quizData.questions.length === 0 ? (
                <div className="py-12 text-center text-[#737686]">
                  <p className="text-2xl mb-1">📋</p>
                  <p className="font-medium text-[#172554]">Quiz này chưa có câu hỏi nào.</p>
                </div>
              ) : filteredQuestions.length === 0 ? (
                <div className="py-12 text-center text-[#737686]">
                  <p className="text-2xl mb-1">🔍</p>
                  <p className="font-medium text-[#172554]">Không tìm thấy câu hỏi phù hợp</p>
                  <p className="text-xs text-[#737686] mt-1">Thử tìm kiếm bằng từ khóa khác.</p>
                </div>
              ) : (
                filteredQuestions.map((q: any, qIdx: number) => {
                  const letterList = ['A', 'B', 'C', 'D', 'E', 'F'];
                  return (
                    <div
                      key={q.questionId || q.id || qIdx}
                      className="p-4 rounded-2xl border border-[#eff4ff] bg-white shadow-sm space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="w-7 h-7 rounded-lg bg-[#eff4ff] text-[#2563EB] font-bold text-xs flex items-center justify-center shrink-0">
                            {qIdx + 1}
                          </span>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-[#434655]">
                            {q.points || 1} điểm
                          </span>
                          {q.durationSeconds ? (
                            <span className="text-xs text-[#737686]">
                              ⏱️ {q.durationSeconds}s
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <p className="text-sm font-semibold text-[#172554] whitespace-pre-wrap leading-relaxed">
                        {q.questionText}
                      </p>

                      {/* Options */}
                      <div className="space-y-2 pt-1">
                        {q.options?.map((opt: any, oIdx: number) => {
                          const isCorrect = Boolean(opt.isCorrect);
                          return (
                            <div
                              key={opt.optionId || opt.id || oIdx}
                              className={`p-3 rounded-xl border text-xs flex items-start justify-between gap-3 transition ${
                                isCorrect
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-950 font-medium'
                                  : 'border-slate-200 bg-slate-50/50 text-[#434655]'
                              }`}
                            >
                              <div className="flex items-start gap-2.5 min-w-0">
                                <span
                                  className={`w-5 h-5 rounded-md flex items-center justify-center font-bold text-[11px] shrink-0 ${
                                    isCorrect
                                      ? 'bg-emerald-600 text-white'
                                      : 'bg-slate-200 text-slate-700'
                                  }`}
                                >
                                  {letterList[oIdx] || oIdx + 1}
                                </span>
                                <span className="leading-relaxed whitespace-pre-wrap pt-0.5">{opt.optionText}</span>
                              </div>
                              {isCorrect && (
                                <span className="shrink-0 px-2 py-0.5 bg-emerald-600 text-white rounded-md text-[10px] font-bold flex items-center gap-1">
                                  ✓ Đáp án đúng
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Explanation */}
                      {q.explanation && (
                        <div className="p-3 bg-amber-50/80 rounded-xl border border-amber-200/80 text-xs text-amber-900 leading-relaxed">
                          <span className="font-bold">💡 Giải thích đáp án:</span> {q.explanation}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end pt-3 border-t border-[#eff4ff] shrink-0">
              <Button variant="secondary" onClick={() => setQuizModal(null)}>
                Đóng
              </Button>
            </div>
          </div>
        </Modal>

      </main>
    </div>
  );
}
