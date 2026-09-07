'use client';
import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Toast, { ToastMessage } from '@/components/ui/Toast';
import Modal from '@/components/ui/Modal';
import { apiFetch, clearApiCache, getCachedApiData } from '@/lib/api/client';

interface QuestionOptionForm {
  optionText: string;
  isCorrect: boolean;
}

interface QuestionForm {
  questionText: string;
  type: 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
  points: number;
  durationSeconds: number;
  explanation: string;
  options: QuestionOptionForm[];
}

export default function AdminEditCoursePage({ params }: { params: { courseId: string } }) {
  const [course, setCourse] = useState<any>(null);
  const [assessment, setAssessment] = useState<any>(null);

  const [form, setForm] = useState({
    title: '',
    description: '',
    visibility: 'PRIVATE' as 'PUBLIC' | 'PRIVATE',
    status: 'DRAFT' as 'DRAFT' | 'PUBLISHED',
  });

  const [loading, setLoading] = useState(true);
  const [savingInfo, setSavingInfo] = useState(false);
  const [publishLoading, setPublishLoading] = useState(false);

  // Toast
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = (type: 'success' | 'error' | 'info', message: string, title?: string) => {
    setToast({ type, message, title });
  };

  // Session Modal
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [sessionSaving, setSessionSaving] = useState(false);

  // Lesson Modal
  const [showLessonModal, setShowLessonModal] = useState<string | null>(null);
  const [lessonForm, setLessonForm] = useState({
    title: '',
    description: '',
    youtubeVideoId: '',
    durationSeconds: 180,
    durationFormatted: '',
  });
  const [lessonSaving, setLessonSaving] = useState(false);
  const [videoPreviewTitle, setVideoPreviewTitle] = useState('');
  const [fetchingDuration, setFetchingDuration] = useState(false);
  const [durationFetchError, setDurationFetchError] = useState('');
  const [isVideoVerified, setIsVideoVerified] = useState(false);
  const ytIdDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Document Upload State
  const [uploadingDocForLessonId, setUploadingDocForLessonId] = useState<string | null>(null);

  // Assessment State
  const [showAssessmentModal, setShowAssessmentModal] = useState(false);
  const [assessmentSaving, setAssessmentSaving] = useState(false);
  const [assessmentFormError, setAssessmentFormError] = useState('');
  const [assessmentForm, setAssessmentForm] = useState({
    title: 'Bài kiểm tra cuối khóa',
    description: 'Đạt từ 85% điểm để hoàn thành khóa học',
    questions: [
      {
        questionText: 'Câu hỏi 1: ',
        type: 'SINGLE_CHOICE' as 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE',
        points: 10,
        durationSeconds: 120,
        explanation: '',
        options: [
          { optionText: 'Đáp án A (Đúng)', isCorrect: true },
          { optionText: 'Đáp án B', isCorrect: false },
          { optionText: 'Đáp án C', isCorrect: false },
          { optionText: 'Đáp án D', isCorrect: false },
        ],
      },
    ] as QuestionForm[],
  });

  useEffect(() => {
    loadCourse();
  }, [params.courseId]);

  async function loadCourse() {
    const [courseRes, assessRes] = await Promise.all([
      apiFetch(`/api/v1/courses/${params.courseId}`),
      apiFetch(`/api/v1/courses/${params.courseId}/assessment`),
    ]);

    if (courseRes.ok && courseRes.data) {
      const c = courseRes.data;
      setCourse(c);
      setForm({
        title: c.title,
        description: c.description || '',
        visibility: c.visibility,
        status: c.status,
      });
    }

    if (assessRes.ok && assessRes.data) {
      setAssessment(assessRes.data);
    }

    setLoading(false);
  }

  // ─── Open Assessment Modal with Existing Questions ─────────────────────────────
  const openAssessmentEditor = () => {
    setAssessmentFormError('');
    if (assessment && Array.isArray(assessment.questions) && assessment.questions.length > 0) {
      setAssessmentForm({
        title: assessment.title || 'Bài kiểm tra cuối khóa',
        description: assessment.description || '',
        questions: assessment.questions.map((q: any, idx: number) => ({
          questionText: q.questionText || q.question_text || `Câu hỏi ${idx + 1}`,
          type: q.type || q.questionType || 'SINGLE_CHOICE',
          points: q.points || 10,
          durationSeconds: q.durationSeconds || q.duration_seconds || 120,
          explanation: q.explanation || '',
          options: (q.options || []).map((opt: any, oIdx: number) => ({
            optionText: opt.optionText || opt.option_text || `Đáp án ${oIdx + 1}`,
            isCorrect: Boolean(opt.isCorrect || opt.is_correct),
          })),
        })),
      });
    } else {
      setAssessmentForm({
        title: 'Bài kiểm tra cuối khóa',
        description: 'Đạt từ 85% điểm để hoàn thành khóa học',
        questions: [
          {
            questionText: 'Câu hỏi 1: ',
            type: 'SINGLE_CHOICE',
            points: 10,
            durationSeconds: 120,
            explanation: '',
            options: [
              { optionText: 'Đáp án A (Đúng)', isCorrect: true },
              { optionText: 'Đáp án B', isCorrect: false },
              { optionText: 'Đáp án C', isCorrect: false },
              { optionText: 'Đáp án D', isCorrect: false },
            ],
          },
        ],
      });
    }
    setShowAssessmentModal(true);
  };

  // ─── Course Info Form ──────────────────────────────────────────────────────────
  const handleSaveInfo = async (e: React.FormEvent) => {
    e.preventDefault();

    if (form.status === 'PUBLISHED') {
      showToast('error', 'Khóa học đang công khai. Hãy Bỏ công khai trước rồi mới chỉnh sửa.');
      return;
    }

    setSavingInfo(true);
    clearApiCache('/api/v1/courses');

    const res = await apiFetch(`/api/v1/courses/${params.courseId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: form.title.trim(),
        description: form.description.trim(),
        visibility: form.visibility,
      }),
    });

    if (res.ok) {
      showToast('success', 'Đã cập nhật thông tin khóa học thành công!');
      setCourse((prev: any) => ({ ...prev, ...res.data }));
    } else {
      showToast('error', res.error?.message || 'Không thể lưu thay đổi');
    }
    setSavingInfo(false);
  };

  const handlePublish = async () => {
    setPublishLoading(true);
    clearApiCache('/api/v1/courses');

    const res = await apiFetch(`/api/v1/courses/${params.courseId}/publish`, { method: 'POST' });
    if (res.ok) {
      setForm((prev) => ({ ...prev, status: 'PUBLISHED' }));
      setCourse((prev: any) => ({ ...prev, status: 'PUBLISHED' }));
      showToast('success', 'Đã công khai khóa học thành công!');
    } else {
      showToast('error', res.error?.message || 'Khóa học cần ít nhất 1 buổi học và mỗi buổi học có 1 bài học.');
    }
    setPublishLoading(false);
  };

  const handleUnpublish = async () => {
    setPublishLoading(true);
    clearApiCache('/api/v1/courses');

    const res = await apiFetch(`/api/v1/courses/${params.courseId}/unpublish`, { method: 'POST' });
    if (res.ok) {
      setForm((prev) => ({ ...prev, status: 'DRAFT' }));
      setCourse((prev: any) => ({ ...prev, status: 'DRAFT' }));
      showToast('info', 'Đã chuyển khóa học về bản nháp. Bạn có thể chỉnh sửa nội dung.');
    } else {
      showToast('error', res.error?.message || 'Không thể bỏ công khai khóa học.');
    }
    setPublishLoading(false);
  };

  // ─── Session Management ───────────────────────────────────────────────────────
  const handleAddSession = async () => {
    if (!newSessionTitle.trim()) return;
    setSessionSaving(true);
    clearApiCache('/api/v1/courses');

    const titleToAdd = newSessionTitle.trim();
    const tempId = 'temp-' + Date.now();
    const newSessionObj = {
      sessionId: tempId,
      id: tempId,
      title: titleToAdd,
      sortOrder: course?.sessions?.length || 0,
      lessons: [],
    };

    setCourse((prev: any) => ({
      ...prev,
      sessions: [...(prev?.sessions || []), newSessionObj],
    }));
    setNewSessionTitle('');
    setShowSessionModal(false);

    showToast('success', `Đã thêm buổi học "${titleToAdd}" thành công!`);

    const res = await apiFetch(`/api/v1/courses/${params.courseId}/sessions`, {
      method: 'POST',
      body: JSON.stringify({
        title: titleToAdd,
        sortOrder: course?.sessions?.length || 0,
      }),
    });

    if (res.ok && res.data) {
      const realSessionId = res.data.sessionId || res.data.id;
      setCourse((prev: any) => ({
        ...prev,
        sessions: prev.sessions.map((s: any) =>
          s.sessionId === tempId ? { ...s, sessionId: realSessionId, id: realSessionId } : s
        ),
      }));
    } else {
      showToast('error', res.error?.message || 'Lỗi thêm buổi học');
      loadCourse();
    }
    setSessionSaving(false);
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!window.confirm('Xóa buổi học này và tất cả bài học bên trong?')) return;
    clearApiCache('/api/v1/courses');

    setCourse((prev: any) => ({
      ...prev,
      sessions: prev.sessions.filter((s: any) => (s.sessionId || s.id) !== sessionId),
    }));
    showToast('success', 'Đã xóa buổi học thành công.');

    const res = await apiFetch(`/api/v1/sessions/${sessionId}`, { method: 'DELETE' });
    if (!res.ok) {
      showToast('error', res.error?.message || 'Lỗi xóa buổi học');
      loadCourse();
    }
  };

  const handleMoveSession = async (index: number, direction: 'up' | 'down') => {
    if (!course?.sessions) return;
    const newSessions = [...course.sessions];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newSessions.length) return;

    const temp = newSessions[index];
    newSessions[index] = newSessions[targetIndex];
    newSessions[targetIndex] = temp;

    const payload = newSessions.map((s, idx) => ({
      sessionId: s.sessionId || s.id,
      sortOrder: idx,
    }));

    setCourse({ ...course, sessions: newSessions });
    clearApiCache('/api/v1/courses');

    await apiFetch(`/api/v1/courses/${params.courseId}/sessions/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ sessions: payload }),
    });
  };

  // ─── Lesson Management & Reordering (Request 1) ────────────────────────────────
  const handleMoveLesson = async (sessionId: string, lessonIndex: number, direction: 'up' | 'down') => {
    if (!course?.sessions) return;
    const targetSession = course.sessions.find((s: any) => (s.sessionId || s.id) === sessionId);
    if (!targetSession || !targetSession.lessons) return;

    const newLessons = [...targetSession.lessons];
    const targetIndex = direction === 'up' ? lessonIndex - 1 : lessonIndex + 1;
    if (targetIndex < 0 || targetIndex >= newLessons.length) return;

    const temp = newLessons[lessonIndex];
    newLessons[lessonIndex] = newLessons[targetIndex];
    newLessons[targetIndex] = temp;

    setCourse((prev: any) => ({
      ...prev,
      sessions: prev.sessions.map((s: any) =>
        (s.sessionId || s.id) === sessionId ? { ...s, lessons: newLessons } : s
      ),
    }));

    clearApiCache('/api/v1/courses');

    await apiFetch(`/api/v1/sessions/${sessionId}/lessons`, {
      method: 'PATCH',
      body: JSON.stringify({
        lessons: newLessons.map((l, idx) => ({
          lessonId: l.lessonId || l.id,
          sortOrder: idx,
        })),
      }),
    });
  };

  const openAddLessonModal = (sessionId: string) => {
    setShowLessonModal(sessionId);
    setLessonForm({ title: '', description: '', youtubeVideoId: '', durationSeconds: 0, durationFormatted: '' });
    setVideoPreviewTitle('');
    setDurationFetchError('');
    setFetchingDuration(false);
    setIsVideoVerified(false);
  };

  const closeLessonModal = () => {
    setShowLessonModal(null);
    setLessonForm({ title: '', description: '', youtubeVideoId: '', durationSeconds: 0, durationFormatted: '' });
    setVideoPreviewTitle('');
    setDurationFetchError('');
    setFetchingDuration(false);
    setIsVideoVerified(false);
  };

  const parseYouTubeId = (rawVal: string): string => {
    const text = rawVal.trim();
    if (!text) return '';
    const match = text.match(
      /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?\/\s]{11})/i
    );
    if (match && match[1]) {
      return match[1];
    }
    if (/^[a-zA-Z0-9_-]{11}$/.test(text)) {
      return text;
    }
    return text;
  };

  const handleYtIdChange = (rawVal: string) => {
    const rawInput = rawVal.trim();
    const vidId = parseYouTubeId(rawInput);
    setLessonForm((prev) => ({ ...prev, youtubeVideoId: rawVal }));
    setDurationFetchError('');
    setVideoPreviewTitle('');
    setIsVideoVerified(false);

    if (ytIdDebounceRef.current) clearTimeout(ytIdDebounceRef.current);
    if (!vidId || vidId.length !== 11) {
      if (rawInput.length > 0) {
        setDurationFetchError('Link hoặc Video ID YouTube phải chứa 11 ký tự hợp lệ.');
      }
      return;
    }

    ytIdDebounceRef.current = setTimeout(async () => {
      setFetchingDuration(true);
      try {
        const infoRes = await apiFetch(`/api/v1/youtube/info?videoId=${vidId}`);
        if (infoRes.ok && infoRes.data) {
          const info = infoRes.data;
          setVideoPreviewTitle(info.title || 'Video YouTube');
          setDurationFetchError('');
          setIsVideoVerified(true);

          setLessonForm((prev) => ({
            ...prev,
            title: prev.title ? prev.title : info.title || prev.title,
            durationSeconds: info.durationSeconds || 180,
            durationFormatted: info.durationFormatted || '',
          }));
        } else {
          setDurationFetchError(
            infoRes.error?.message ||
              'Video YouTube không tồn tại, ở chế độ riêng tư hoặc không cho phép nhúng. Vui lòng kiểm tra lại link/ID.'
          );
          setIsVideoVerified(false);
        }
      } catch {
        setDurationFetchError('Lỗi kiểm tra thông tin video YouTube.');
        setIsVideoVerified(false);
      } finally {
        setFetchingDuration(false);
      }
    }, 400);
  };

  const handleAddLesson = async () => {
    if (!showLessonModal) return;
    if (!lessonForm.title.trim()) {
      showToast('error', 'Vui lòng nhập tiêu đề bài học');
      return;
    }

    const cleanVidId = parseYouTubeId(lessonForm.youtubeVideoId);
    if (!cleanVidId || cleanVidId.length !== 11) {
      showToast('error', 'Vui lòng nhập Video ID hoặc link YouTube hợp lệ (11 ký tự)');
      return;
    }

    if (durationFetchError) {
      showToast('error', durationFetchError);
      return;
    }

    if (!isVideoVerified && !fetchingDuration) {
      showToast('error', 'Đang xác minh video YouTube, vui lòng đợi giây lát...');
      return;
    }

    setLessonSaving(true);
    clearApiCache('/api/v1/courses');

    const targetSessionId = showLessonModal;
    const tempLessonId = 'temp-lesson-' + Date.now();
    const lessonTitle = lessonForm.title.trim();
    const durationSec = Math.max(1, Number(lessonForm.durationSeconds) || 180);

    const tempLessonObj = {
      lessonId: tempLessonId,
      id: tempLessonId,
      title: lessonTitle,
      description: lessonForm.description.trim(),
      youtubeVideoId: cleanVidId,
      video: {
        youtubeVideoId: cleanVidId,
        durationSeconds: durationSec,
      },
      documents: [],
    };

    setCourse((prev: any) => ({
      ...prev,
      sessions: prev.sessions.map((s: any) =>
        (s.sessionId || s.id) === targetSessionId
          ? { ...s, lessons: [...(s.lessons || []), tempLessonObj] }
          : s
      ),
    }));

    closeLessonModal();

    showToast('success', `Đã thêm bài học "${lessonTitle}" thành công!`);

    const res = await apiFetch(`/api/v1/sessions/${targetSessionId}/lessons`, {
      method: 'POST',
      body: JSON.stringify({
        title: lessonTitle,
        description: tempLessonObj.description,
        youtubeVideoId: cleanVidId,
        durationSeconds: durationSec,
      }),
    });

    if (res.ok && res.data) {
      const realLessonId = res.data.lessonId || res.data.id;
      setCourse((prev: any) => ({
        ...prev,
        sessions: prev.sessions.map((s: any) =>
          (s.sessionId || s.id) === targetSessionId
            ? {
                ...s,
                lessons: s.lessons.map((l: any) =>
                  (l.lessonId || l.id) === tempLessonId
                    ? {
                        ...l,
                        lessonId: realLessonId,
                        id: realLessonId,
                        video: res.data.video || l.video,
                      }
                    : l
                ),
              }
            : s
        ),
      }));
    } else {
      showToast('error', res.error?.message || 'Lỗi thêm bài học');
      loadCourse();
    }
    setLessonSaving(false);
  };

  const handleDeleteLesson = async (sessionId: string, lessonId: string) => {
    if (!window.confirm('Xóa bài học này?')) return;
    clearApiCache('/api/v1/courses');

    setCourse((prev: any) => ({
      ...prev,
      sessions: prev.sessions.map((s: any) =>
        (s.sessionId || s.id) === sessionId
          ? { ...s, lessons: (s.lessons || []).filter((l: any) => (l.lessonId || l.id) !== lessonId) }
          : s
      ),
    }));
    showToast('success', 'Đã xóa bài học thành công.');

    const res = await apiFetch(`/api/v1/lessons/${lessonId}`, { method: 'DELETE' });
    if (!res.ok) {
      showToast('error', res.error?.message || 'Lỗi xóa bài học');
      loadCourse();
    }
  };

  // ─── Document Upload (Max 25MB with clear validation) ─────────────────────────
  const handleDirectUploadDoc = async (
    sessionId: string,
    lessonId: string,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const MAX_DOC_SIZE_MB = 25;
    const MAX_DOC_BYTES = MAX_DOC_SIZE_MB * 1024 * 1024;

    if (file.size > MAX_DOC_BYTES) {
      showToast('error', `Tài liệu vượt quá dung lượng cho phép (tối đa ${MAX_DOC_SIZE_MB}MB). Vui lòng chọn file nhỏ hơn.`);
      e.target.value = '';
      return;
    }

    setUploadingDocForLessonId(lessonId);
    clearApiCache('/api/v1/courses');

    const formData = new FormData();
    formData.append('file', file);

    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : '';
    const res = await fetch(`/api/v1/lessons/${lessonId}/documents/upload`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });

    const data = await res.json().catch(() => null);

    if (res.ok && data) {
      setCourse((prev: any) => ({
        ...prev,
        sessions: prev.sessions.map((s: any) =>
          (s.sessionId || s.id) === sessionId
            ? {
                ...s,
                lessons: s.lessons.map((l: any) =>
                  (l.lessonId || l.id) === lessonId
                    ? {
                        ...l,
                        documents: [
                          ...(l.documents || []),
                          {
                            documentId: data.documentId || data.id,
                            id: data.documentId || data.id,
                            fileName: data.fileName || file.name,
                            fileSize: data.fileSize || file.size,
                            mimeType: data.mimeType || file.type,
                          },
                        ],
                      }
                    : l
                ),
              }
            : s
        ),
      }));
      showToast('success', `Đã tải lên tài liệu "${file.name}" (${(file.size / 1024 / 1024).toFixed(1)}MB) thành công!`);
    } else {
      showToast('error', data?.error?.message || 'Lỗi khi tải tài liệu lên');
    }
    setUploadingDocForLessonId(null);
    e.target.value = '';
  };

  const handleDeleteDocument = async (
    sessionId: string,
    lessonId: string,
    documentId: string,
    fileName: string
  ) => {
    if (!window.confirm(`Xóa tài liệu "${fileName}"?`)) return;
    clearApiCache('/api/v1/courses');

    setCourse((prev: any) => ({
      ...prev,
      sessions: prev.sessions.map((s: any) =>
        (s.sessionId || s.id) === sessionId
          ? {
              ...s,
              lessons: s.lessons.map((l: any) =>
                (l.lessonId || l.id) === lessonId
                  ? {
                      ...l,
                      documents: (l.documents || []).filter((d: any) => (d.documentId || d.id) !== documentId),
                    }
                  : l
              ),
            }
          : s
      ),
    }));

    const res = await apiFetch(`/api/v1/documents/${documentId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('success', `Đã xóa tài liệu "${fileName}".`);
    } else {
      showToast('error', res.error?.message || 'Lỗi xóa tài liệu');
      loadCourse();
    }
  };

  // ─── Assessment Builder (Add/Remove/Move Questions & Options) ──────────────────
  const handleAddQuestion = () => {
    setAssessmentForm((prev) => ({
      ...prev,
      questions: [
        ...prev.questions,
        {
          questionText: `Câu hỏi ${prev.questions.length + 1}: `,
          type: 'SINGLE_CHOICE',
          points: 10,
          durationSeconds: 120,
          explanation: '',
          options: [
            { optionText: 'Đáp án A (Đúng)', isCorrect: true },
            { optionText: 'Đáp án B', isCorrect: false },
            { optionText: 'Đáp án C', isCorrect: false },
            { optionText: 'Đáp án D', isCorrect: false },
          ],
        },
      ],
    }));
  };

  const handleRemoveQuestion = (idx: number) => {
    if (assessmentForm.questions.length <= 1) {
      setAssessmentFormError('Bài kiểm tra phải có ít nhất 1 câu hỏi');
      showToast('error', 'Bài kiểm tra phải có ít nhất 1 câu hỏi');
      return;
    }
    setAssessmentForm((prev) => ({
      ...prev,
      questions: prev.questions.filter((_, i) => i !== idx),
    }));
  };

  const handleMoveQuestion = (idx: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= assessmentForm.questions.length) return;

    const newQuestions = [...assessmentForm.questions];
    const temp = newQuestions[idx];
    newQuestions[idx] = newQuestions[targetIdx];
    newQuestions[targetIdx] = temp;

    setAssessmentForm({ ...assessmentForm, questions: newQuestions });
  };

  const handleQuestionTypeChange = (
    qIdx: number,
    newType: 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE'
  ) => {
    const updated = [...assessmentForm.questions];
    const q = updated[qIdx];
    q.type = newType;

    if (newType === 'TRUE_FALSE') {
      q.options = [
        { optionText: 'Đúng', isCorrect: true },
        { optionText: 'Sai', isCorrect: false },
      ];
    } else if (newType === 'SINGLE_CHOICE') {
      if (q.options.length < 2) {
        q.options = [
          { optionText: 'Đáp án A (Đúng)', isCorrect: true },
          { optionText: 'Đáp án B', isCorrect: false },
        ];
      } else {
        const firstCorrect = q.options.findIndex((o) => o.isCorrect);
        q.options = q.options.map((o, idx) => ({
          ...o,
          isCorrect: idx === (firstCorrect >= 0 ? firstCorrect : 0),
        }));
      }
    }
    setAssessmentForm({ ...assessmentForm, questions: updated });
  };

  const handleAddOption = (qIdx: number) => {
    const updated = [...assessmentForm.questions];
    updated[qIdx].options.push({
      optionText: `Đáp án ${String.fromCharCode(65 + updated[qIdx].options.length)}`,
      isCorrect: false,
    });
    setAssessmentForm({ ...assessmentForm, questions: updated });
  };

  const handleRemoveOption = (qIdx: number, oIdx: number) => {
    const updated = [...assessmentForm.questions];
    if (updated[qIdx].options.length <= 2) {
      setAssessmentFormError('Mỗi câu hỏi phải có ít nhất 2 đáp án lựa chọn');
      showToast('error', 'Mỗi câu hỏi phải có ít nhất 2 đáp án lựa chọn');
      return;
    }
    updated[qIdx].options = updated[qIdx].options.filter((_, i) => i !== oIdx);
    setAssessmentForm({ ...assessmentForm, questions: updated });
  };

  const handleSaveAssessment = async () => {
    setAssessmentFormError('');

    if (!assessmentForm.title.trim()) {
      setAssessmentFormError('Vui lòng nhập tiêu đề bài kiểm tra');
      showToast('error', 'Vui lòng nhập tiêu đề bài kiểm tra');
      return;
    }

    for (let i = 0; i < assessmentForm.questions.length; i++) {
      const q = assessmentForm.questions[i];
      if (!q.questionText.trim()) {
        const msg = `Vui lòng nhập nội dung câu hỏi số ${i + 1}`;
        setAssessmentFormError(msg);
        showToast('error', msg);
        return;
      }
      const hasCorrect = q.options.some((o) => o.isCorrect);
      if (!hasCorrect) {
        const msg = `Câu hỏi số ${i + 1} phải có ít nhất 1 đáp án đúng`;
        setAssessmentFormError(msg);
        showToast('error', msg);
        return;
      }
    }

    setAssessmentSaving(true);
    clearApiCache('/api/v1/courses');

    const res = await apiFetch(`/api/v1/courses/${params.courseId}/assessment`, {
      method: 'POST',
      body: JSON.stringify({
        title: assessmentForm.title.trim(),
        description: assessmentForm.description.trim(),
        questions: assessmentForm.questions.map((q, idx) => ({
          questionText: q.questionText.trim(),
          questionType: q.type,
          points: q.points,
          durationSeconds: q.durationSeconds,
          ...(q.explanation.trim() ? { explanation: q.explanation.trim() } : {}),
          sortOrder: idx,
          options: q.options.map((opt, oIdx) => ({
            optionText: opt.optionText.trim(),
            isCorrect: opt.isCorrect,
            sortOrder: oIdx,
          })),
        })),
      }),
    });

    if (res.ok) {
      showToast('success', `Đã lưu thành công bài kiểm tra (${assessmentForm.questions.length} câu hỏi)!`);
      setShowAssessmentModal(false);
      setAssessment(res.data);
    } else {
      const errMsg = res.error?.message || 'Lỗi khi lưu bài kiểm tra';
      setAssessmentFormError(errMsg);
      showToast('error', errMsg);
    }
    setAssessmentSaving(false);
  };

  const handleDeleteAssessment = async () => {
    if (!window.confirm('Bạn có chắc muốn xóa bài kiểm tra cuối khóa?')) return;
    if (!assessment?.assessmentId && !assessment?.id) return;

    clearApiCache('/api/v1/courses');
    const aId = assessment.assessmentId || assessment.id;
    const res = await apiFetch(`/api/v1/assessments/${aId}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('success', 'Đã xóa bài kiểm tra thành công.');
      setAssessment(null);
    } else {
      showToast('error', res.error?.message || 'Lỗi khi xóa bài kiểm tra');
    }
  };

  const isPublished = course?.status === 'PUBLISHED';

  return (
    <>
        <Toast toast={toast} onClose={() => setToast(null)} />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <Link
            href="/admin/courses"
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white border border-[#cbdbf5] text-xs font-bold text-[#172554] hover:bg-[#eff4ff] hover:text-[#2563EB] hover:border-[#2563EB] shadow-xs transition-all w-fit"
          >
            ← Quay lại danh sách khóa học
          </Link>
          <div className="flex items-center gap-3">
            <span
              className={`whitespace-nowrap inline-flex items-center text-xs font-bold px-3 py-1 rounded-full ${
                isPublished ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
              }`}
            >
              {isPublished ? '✓ Đang công khai (Published)' : 'Bản nháp (Draft)'}
            </span>

            {isPublished ? (
              <Button variant="secondary" loading={publishLoading} onClick={handleUnpublish}>
                Hạ về bản nháp
              </Button>
            ) : (
              <Button loading={publishLoading} onClick={handlePublish}>
                Công khai khóa học
              </Button>
            )}
          </div>
        </div>

        {loading && !course ? (
          <div className="space-y-6 animate-pulse">
            <div className="h-44 bg-white rounded-3xl border border-[#eff4ff]"></div>
            <div className="h-64 bg-white rounded-3xl border border-[#eff4ff]"></div>
          </div>
        ) : !course ? (
          <Card className="text-center py-16">
            <p className="text-lg font-semibold text-[#172554] mb-2">Không tìm thấy khóa học</p>
            <Link href="/admin/courses">
              <Button>Quay lại danh sách</Button>
            </Link>
          </Card>
        ) : (
          <div className="space-y-8">
            {/* 1. Basic Info Form */}
            <Card className="p-6 border border-[#eff4ff] shadow-sm">
              <h2 className="text-xl font-bold text-[#172554] mb-4" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                Thông tin chung khóa học
              </h2>
              <form onSubmit={handleSaveInfo} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-[#172554] mb-1">Tiêu đề khóa học *</label>
                  <input
                    type="text"
                    required
                    disabled={isPublished}
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] disabled:bg-slate-100 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#172554] mb-1">Mô tả</label>
                  <textarea
                    rows={3}
                    disabled={isPublished}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] disabled:bg-slate-100 disabled:cursor-not-allowed"
                  />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
                  <div className="flex items-center gap-6">
                    <label className="flex items-center gap-2 text-sm font-medium text-[#172554] cursor-pointer">
                      <input
                        type="radio"
                        name="visibility"
                        value="PUBLIC"
                        disabled={isPublished}
                        checked={form.visibility === 'PUBLIC'}
                        onChange={() => setForm({ ...form, visibility: 'PUBLIC' })}
                        className="text-[#2563EB]"
                      />
                      Công khai (Public — Xem không cần đăng nhập)
                    </label>
                    <label className="flex items-center gap-2 text-sm font-medium text-[#172554] cursor-pointer">
                      <input
                        type="radio"
                        name="visibility"
                        value="PRIVATE"
                        disabled={isPublished}
                        checked={form.visibility === 'PRIVATE'}
                        onChange={() => setForm({ ...form, visibility: 'PRIVATE' })}
                        className="text-[#2563EB]"
                      />
                      Nội bộ (Private — Chỉ thành viên đăng nhập)
                    </label>
                  </div>

                  {!isPublished && (
                    <Button type="submit" loading={savingInfo} loadingText="Đang lưu...">
                      Lưu thông tin
                    </Button>
                  )}
                </div>
              </form>
            </Card>

            {/* 2. Sessions & Lessons Outline Builder with Up/Down buttons (Request 1) */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                    Chương trình & Buổi học ({course.sessions?.length || 0})
                  </h2>
                  <p className="text-xs text-[#737686]">
                    Quản lý các buổi học, bài giảng video YouTube và tài liệu đính kèm (tối đa 25MB/tài liệu)
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={isPublished}
                  onClick={() => setShowSessionModal(true)}
                >
                  ＋ Thêm buổi học
                </Button>
              </div>

              {course.sessions?.length === 0 ? (
                <Card className="text-center py-12 border-dashed border-2 border-slate-200">
                  <p className="text-base font-semibold text-[#172554] mb-2">Chưa có buổi học nào</p>
                  <p className="text-xs text-[#737686] mb-4">Khóa học cần ít nhất 1 buổi học trước khi có thể công khai.</p>
                  <Button size="sm" disabled={isPublished} onClick={() => setShowSessionModal(true)}>
                    ＋ Tạo buổi học đầu tiên
                  </Button>
                </Card>
              ) : (
                <div className="space-y-4">
                  {course.sessions?.map((session: any, sIdx: number) => {
                    const sId = session.sessionId || session.id;

                    return (
                      <Card key={sId} className="p-6 border border-[#eff4ff] shadow-sm">
                        <div className="flex items-center justify-between pb-4 mb-4 border-b border-[#eff4ff]">
                          <div className="flex items-center gap-3">
                            <span className="w-7 h-7 bg-[#2563EB] text-white rounded-lg flex items-center justify-center font-bold text-xs">
                              {sIdx + 1}
                            </span>
                            <h3 className="text-base font-bold text-[#172554]">{session.title}</h3>
                          </div>

                          {!isPublished && (
                            <div className="flex items-center gap-2">
                              {sIdx > 0 && (
                                <button
                                  onClick={() => handleMoveSession(sIdx, 'up')}
                                  className="p-1 text-slate-400 hover:text-[#2563EB]"
                                  title="Di chuyển buổi học lên"
                                >
                                  ▲
                                </button>
                              )}
                              {sIdx < course.sessions.length - 1 && (
                                <button
                                  onClick={() => handleMoveSession(sIdx, 'down')}
                                  className="p-1 text-slate-400 hover:text-[#2563EB]"
                                  title="Di chuyển buổi học xuống"
                                >
                                  ▼
                                </button>
                              )}
                              <Button size="sm" variant="secondary" onClick={() => openAddLessonModal(sId)}>
                                ＋ Thêm bài học
                              </Button>
                              <button
                                onClick={() => handleDeleteSession(sId)}
                                className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                                title="Xóa buổi học"
                              >
                                🗑️
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Lessons in session with Move Up/Down (Request 1) */}
                        {session.lessons?.length === 0 ? (
                          <div className="py-6 text-center text-xs text-[#737686] bg-[#f8f9ff] rounded-xl">
                            Chưa có bài học nào trong buổi này.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {session.lessons?.map((lesson: any, lIdx: number) => {
                              const lId = lesson.lessonId || lesson.id;
                              const vidId = lesson.video?.youtubeVideoId || lesson.youtubeVideoId;
                              const durSec = lesson.video?.durationSeconds || lesson.durationSeconds || 180;
                              const durMin = Math.floor(durSec / 60);
                              const durRemSec = durSec % 60;

                              return (
                                <div
                                  key={lId}
                                  className="p-4 bg-[#f8f9ff] rounded-2xl border border-[#eff4ff] space-y-3"
                                >
                                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                      <div className="flex flex-col items-center gap-0.5 shrink-0">
                                        <span className="text-xs font-bold text-[#737686]">
                                          {sIdx + 1}.{lIdx + 1}
                                        </span>
                                        {!isPublished && (
                                          <div className="flex flex-col gap-0.5">
                                            {lIdx > 0 && (
                                              <button
                                                type="button"
                                                onClick={() => handleMoveLesson(sId, lIdx, 'up')}
                                                className="text-[9px] text-slate-400 hover:text-[#2563EB] px-1 bg-white border border-[#cbdbf5] rounded"
                                                title="Di chuyển bài học lên"
                                              >
                                                ▲
                                              </button>
                                            )}
                                            {lIdx < (session.lessons?.length || 0) - 1 && (
                                              <button
                                                type="button"
                                                onClick={() => handleMoveLesson(sId, lIdx, 'down')}
                                                className="text-[9px] text-slate-400 hover:text-[#2563EB] px-1 bg-white border border-[#cbdbf5] rounded"
                                                title="Di chuyển bài học xuống"
                                              >
                                                ▼
                                              </button>
                                            )}
                                          </div>
                                        )}
                                      </div>

                                      {vidId && (
                                        <img
                                          src={`https://i.ytimg.com/vi/${vidId}/hqdefault.jpg`}
                                          alt="Thumb"
                                          className="w-14 h-9 object-cover rounded-md shrink-0 shadow-sm"
                                        />
                                      )}
                                      <div>
                                        <h4 className="text-sm font-bold text-[#172554]">{lesson.title}</h4>
                                        <p className="text-xs text-[#737686]">
                                          Video YouTube: <span className="font-mono">{vidId}</span> • Thời lượng:{' '}
                                          {durMin}:{durRemSec.toString().padStart(2, '0')} ({durSec}s)
                                        </p>
                                      </div>
                                    </div>

                                    {!isPublished && (
                                      <div className="flex items-center gap-2">
                                        <label className="cursor-pointer">
                                          <input
                                            type="file"
                                            className="hidden"
                                            onChange={(e) => handleDirectUploadDoc(sId, lId, e)}
                                          />
                                          <span className="px-2.5 py-1 bg-white border border-[#cbdbf5] hover:bg-[#eff4ff] text-[#2563EB] rounded-lg text-xs font-semibold inline-block transition">
                                            {uploadingDocForLessonId === lId ? '⏳ Đang tải...' : '📎 Thêm tài liệu (max 25MB)'}
                                          </span>
                                        </label>

                                        <button
                                          onClick={() => handleDeleteLesson(sId, lId)}
                                          className="p-1 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50"
                                          title="Xóa bài học"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    )}
                                  </div>

                                  {/* Documents List */}
                                  {lesson.documents?.length > 0 && (
                                    <div className="pt-2 border-t border-[#cbdbf5]/50 space-y-1.5">
                                      <span className="text-[11px] font-bold text-[#737686] uppercase tracking-wider">
                                        Tài liệu học tập ({lesson.documents.length}):
                                      </span>
                                      <div className="flex flex-wrap gap-2">
                                        {lesson.documents.map((doc: any) => {
                                          const dId = doc.documentId || doc.id;
                                          return (
                                            <div
                                              key={dId}
                                              className="flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-200 rounded-xl text-xs text-[#172554] shadow-xs"
                                            >
                                              <span>📄</span>
                                              <span className="font-medium truncate max-w-[180px]">{doc.fileName}</span>
                                              {!isPublished && (
                                                <button
                                                  onClick={() => handleDeleteDocument(sId, lId, dId, doc.fileName)}
                                                  className="ml-1 text-slate-400 hover:text-red-600"
                                                >
                                                  ✕
                                                </button>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 3. Final Quiz Assessment Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                    Bài kiểm tra cuối khóa (Assessment)
                  </h2>
                  <p className="text-xs text-[#737686]">
                    Thiết lập bài kiểm tra trắc nghiệm cuối khóa để cấp chứng chỉ / ghi nhận hoàn thành
                  </p>
                </div>
                {assessment && !isPublished && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={openAssessmentEditor}>
                      ✏️ Chỉnh sửa Quiz
                    </Button>
                    <Button size="sm" variant="secondary" onClick={handleDeleteAssessment}>
                      Xóa Quiz
                    </Button>
                  </div>
                )}
              </div>

              {assessment ? (
                <Card className="p-6 border border-[#eff4ff] shadow-sm">
                  <div className="flex items-start justify-between pb-4 border-b border-[#eff4ff] mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-[#172554]">{assessment.title}</h3>
                      <p className="text-sm text-[#737686]">{assessment.description || 'Chưa có mô tả'}</p>
                    </div>
                    <span className="text-xs font-bold px-3 py-1 bg-blue-100 text-[#2563EB] rounded-full">
                      {assessment.questions?.length || 0} câu hỏi
                    </span>
                  </div>

                  <div className="space-y-3">
                    {assessment.questions?.map((q: any, qIdx: number) => (
                      <div key={q.questionId || q.id || qIdx} className="p-4 bg-[#f8f9ff] rounded-xl border border-[#eff4ff] space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-bold text-sm text-[#172554]">
                            Câu {qIdx + 1}: {q.questionText}
                          </span>
                          <span className="text-xs font-bold px-2 py-0.5 bg-[#eff4ff] text-[#2563EB] rounded-full shrink-0">
                            {q.points || 10} điểm
                          </span>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-2 pt-1">
                          {q.options?.map((opt: any, oIdx: number) => (
                            <div
                              key={opt.optionId || opt.id || oIdx}
                              className={`p-2.5 rounded-lg border text-xs flex items-center justify-between ${
                                opt.isCorrect ? 'bg-green-50 border-green-300 text-green-800 font-semibold' : 'bg-white border-slate-200 text-slate-700'
                              }`}
                            >
                              <span>{opt.optionText}</span>
                              {opt.isCorrect && <span className="text-green-600 font-bold">✓ Đáp án đúng</span>}
                            </div>
                          ))}
                        </div>
                        {q.explanation && (
                          <p className="text-xs text-[#434655] bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                            💡 Giải thích: {q.explanation}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              ) : (
                <Card className="text-center py-10 shadow-sm">
                  <p className="text-[#172554] font-semibold mb-1">Khóa học này chưa có bài kiểm tra cuối khóa</p>
                  <p className="text-xs text-[#737686] mb-4">Học viên sẽ chỉ cần xem video nếu không có bài kiểm tra.</p>
                  <Button size="sm" disabled={isPublished} onClick={openAssessmentEditor}>
                    ＋ Thêm bài kiểm tra ngay
                  </Button>
                </Card>
              )}
            </div>
          </div>
        )}

        {/* Modal: Add Session */}
        <Modal
          isOpen={showSessionModal}
          onClose={() => setShowSessionModal(false)}
          maxWidth="max-w-md"
        >
          <div className="p-6 space-y-4">
            <h3 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
              Thêm buổi học mới
            </h3>
            <div>
              <label className="block text-sm font-semibold text-[#172554] mb-1.5">Tiêu đề buổi học *</label>
              <input
                type="text"
                required
                value={newSessionTitle}
                onChange={(e) => setNewSessionTitle(e.target.value)}
                placeholder="Ví dụ: Buổi 1 — Tổng quan kiến thức BBE"
                className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setShowSessionModal(false)}>
                Hủy
              </Button>
              <Button loading={sessionSaving} loadingText="Đang thêm..." onClick={handleAddSession}>
                Thêm buổi học
              </Button>
            </div>
          </div>
        </Modal>

        {/* Modal: Add Lesson */}
        <Modal
          isOpen={Boolean(showLessonModal)}
          onClose={closeLessonModal}
          maxWidth="max-w-lg"
        >
          <div className="p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-[#eff4ff] pb-3">
              <h3 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                Thêm bài học & Video YouTube
              </h3>
              <button onClick={closeLessonModal} className="text-[#737686] hover:text-[#172554] text-xl font-bold p-1 rounded-lg hover:bg-slate-100 transition">
                ✕
              </button>
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#172554] mb-1">
                Link YouTube hoặc Video ID (11 ký tự) *
              </label>
              <input
                type="text"
                required
                value={lessonForm.youtubeVideoId}
                onChange={(e) => handleYtIdChange(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=... hoặc dQw4w9WgXcQ"
                className={`w-full px-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] ${
                  durationFetchError ? 'border-red-400 bg-red-50' : 'border-[#cbdbf5]'
                }`}
              />
              {fetchingDuration && (
                <p className="text-xs text-[#2563EB] mt-1.5 flex items-center gap-1.5">
                  <span className="inline-block animate-spin">⏳</span> Đang tự động nhận diện video và thời lượng...
                </p>
              )}
              {durationFetchError && (
                <p className="text-xs text-red-600 mt-1.5 font-medium">⚠️ {durationFetchError}</p>
              )}
              {isVideoVerified && videoPreviewTitle && (
                <div className="mt-2.5 p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-3">
                  <img
                    src={`https://i.ytimg.com/vi/${parseYouTubeId(lessonForm.youtubeVideoId)}/hqdefault.jpg`}
                    alt="Thumbnail"
                    className="w-20 h-12 object-cover rounded-xl shrink-0 shadow-sm"
                  />
                  <div className="overflow-hidden flex-1">
                    <p className="text-xs font-bold text-[#172554] truncate">{videoPreviewTitle}</p>
                    <p className="text-xs text-emerald-700 font-semibold mt-0.5">
                      ✓ Tự động nhận diện: {lessonForm.durationFormatted || `${lessonForm.durationSeconds} giây`}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#172554] mb-1">Tiêu đề bài học *</label>
              <input
                type="text"
                required
                value={lessonForm.title}
                onChange={(e) => setLessonForm({ ...lessonForm, title: e.target.value })}
                placeholder="Ví dụ: Bài 1.1: Giới thiệu văn hóa BBE"
                className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#172554] mb-1">Mô tả bài học</label>
              <textarea
                rows={2}
                value={lessonForm.description}
                onChange={(e) => setLessonForm({ ...lessonForm, description: e.target.value })}
                placeholder="Mô tả nội dung bài học (tùy chọn)"
                className="w-full px-4 py-2 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-[#eff4ff]">
              <Button variant="outline" onClick={closeLessonModal}>
                Hủy
              </Button>
              <Button
                loading={lessonSaving}
                loadingText="Đang tạo..."
                disabled={!isVideoVerified || fetchingDuration}
                onClick={handleAddLesson}
              >
                Tạo bài học
              </Button>
            </div>
          </div>
        </Modal>

        {/* Modal: Assessment Multi-Type Question Builder with Question Reordering */}
        <Modal
          isOpen={showAssessmentModal}
          onClose={() => setShowAssessmentModal(false)}
          maxWidth="max-w-2xl"
        >
          <div className="p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-[#eff4ff] pb-3">
              <h3 className="text-xl font-bold text-[#172554]" style={{ fontFamily: 'Be Vietnam Pro, sans-serif' }}>
                Thiết lập bài kiểm tra cuối khóa
              </h3>
              <button
                onClick={() => setShowAssessmentModal(false)}
                className="text-[#737686] hover:text-[#172554] font-bold text-xl p-1 rounded-lg hover:bg-slate-100 transition"
              >
                ✕
              </button>
            </div>

              {assessmentFormError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-semibold flex items-center gap-2">
                  <span>⚠️</span>
                  <span>{assessmentFormError}</span>
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-semibold text-[#172554] mb-1">Tiêu đề bài kiểm tra *</label>
                  <input
                    type="text"
                    required
                    value={assessmentForm.title}
                    onChange={(e) => setAssessmentForm({ ...assessmentForm, title: e.target.value })}
                    className="w-full px-4 py-2.5 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#172554] mb-1">Mô tả / Yêu cầu đạt</label>
                  <textarea
                    rows={2}
                    value={assessmentForm.description}
                    onChange={(e) => setAssessmentForm({ ...assessmentForm, description: e.target.value })}
                    className="w-full px-4 py-2 border border-[#cbdbf5] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                  />
                </div>
              </div>

              {/* Dynamic Questions Builder with Up/Down buttons (Request 8) */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm text-[#172554]">
                    Danh sách câu hỏi ({assessmentForm.questions.length})
                  </h4>
                  <Button size="sm" variant="secondary" onClick={handleAddQuestion}>
                    ＋ Thêm câu hỏi
                  </Button>
                </div>

                {assessmentForm.questions.map((q, qIdx) => (
                  <div key={qIdx} className="p-4 bg-[#f8f9ff] rounded-2xl border border-[#eff4ff] space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-1.5 shrink-0 mt-1">
                        <span className="font-bold text-sm text-[#2563EB]">Câu {qIdx + 1}</span>
                        {/* Reorder Up/Down buttons */}
                        <div className="flex flex-col gap-0.5">
                          {qIdx > 0 && (
                            <button
                              type="button"
                              onClick={() => handleMoveQuestion(qIdx, 'up')}
                              className="text-[9px] text-[#737686] hover:text-[#2563EB] px-1 bg-white border border-[#cbdbf5] rounded hover:bg-blue-50"
                              title="Di chuyển câu hỏi lên"
                            >
                              ▲
                            </button>
                          )}
                          {qIdx < assessmentForm.questions.length - 1 && (
                            <button
                              type="button"
                              onClick={() => handleMoveQuestion(qIdx, 'down')}
                              className="text-[9px] text-[#737686] hover:text-[#2563EB] px-1 bg-white border border-[#cbdbf5] rounded hover:bg-blue-50"
                              title="Di chuyển câu hỏi xuống"
                            >
                              ▼
                            </button>
                          )}
                        </div>
                      </div>

                      <input
                        type="text"
                        required
                        value={q.questionText}
                        onChange={(e) => {
                          const qs = [...assessmentForm.questions];
                          qs[qIdx].questionText = e.target.value;
                          setAssessmentForm({ ...assessmentForm, questions: qs });
                        }}
                        placeholder="Nhập nội dung câu hỏi..."
                        className="flex-1 px-3 py-2 border border-[#cbdbf5] rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                      />
                      <button
                        onClick={() => handleRemoveQuestion(qIdx)}
                        className="p-1.5 text-[#737686] hover:text-red-600 rounded-lg hover:bg-red-50 shrink-0"
                        title="Xóa câu hỏi này"
                      >
                        🗑️
                      </button>
                    </div>

                    {/* Question Config: Type, Points, Duration */}
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <div>
                        <label className="font-semibold text-[#434655] mr-1.5">Loại câu:</label>
                        <select
                          value={q.type}
                          onChange={(e) => handleQuestionTypeChange(qIdx, e.target.value as any)}
                          className="px-2.5 py-1.5 border border-[#cbdbf5] rounded-lg bg-white"
                        >
                          <option value="SINGLE_CHOICE">Trắc nghiệm 1 đáp án</option>
                          <option value="MULTIPLE_CHOICE">Trắc nghiệm nhiều đáp án</option>
                          <option value="TRUE_FALSE">Đúng / Sai</option>
                        </select>
                      </div>

                      <div>
                        <label className="font-semibold text-[#434655] mr-1.5">Điểm số:</label>
                        <input
                          type="number"
                          min={1}
                          value={q.points}
                          onChange={(e) => {
                            const qs = [...assessmentForm.questions];
                            qs[qIdx].points = Math.max(1, parseInt(e.target.value, 10) || 1);
                            setAssessmentForm({ ...assessmentForm, questions: qs });
                          }}
                          className="w-16 px-2 py-1 border border-[#cbdbf5] rounded-lg bg-white"
                        />
                      </div>
                    </div>

                    {/* Explanation (hiện cho học viên khi đạt ≥85 điểm) */}
                    <div>
                      <label className="block text-xs font-semibold text-[#434655] mb-1">
                        💡 Giải thích đáp án (hiện cho học viên khi đạt điểm)
                      </label>
                      <textarea
                        rows={2}
                        value={q.explanation}
                        onChange={(e) => {
                          const qs = [...assessmentForm.questions];
                          qs[qIdx].explanation = e.target.value;
                          setAssessmentForm({ ...assessmentForm, questions: qs });
                        }}
                        placeholder="Giải thích tại sao đáp án đúng (tùy chọn)"
                        className="w-full px-3 py-2 border border-[#cbdbf5] rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                      />
                    </div>

                    {/* Options Editor */}
                    <div className="space-y-2 pt-2 border-t border-[#eff4ff]">
                      <span className="text-xs font-semibold text-[#737686]">
                        {q.type === 'SINGLE_CHOICE'
                          ? 'Chọn 1 nút tròn làm đáp án đúng:'
                          : q.type === 'MULTIPLE_CHOICE'
                          ? 'Tích chọn các đáp án đúng:'
                          : 'Chọn Đúng hoặc Sai:'}
                      </span>

                      {q.options.map((opt, oIdx) => (
                        <div key={oIdx} className="flex items-center gap-2">
                          <input
                            type={q.type === 'SINGLE_CHOICE' || q.type === 'TRUE_FALSE' ? 'radio' : 'checkbox'}
                            name={`correct-${qIdx}`}
                            checked={opt.isCorrect}
                            onChange={() => {
                              const qs = [...assessmentForm.questions];
                              if (q.type === 'SINGLE_CHOICE' || q.type === 'TRUE_FALSE') {
                                qs[qIdx].options = qs[qIdx].options.map((o, idx) => ({
                                  ...o,
                                  isCorrect: idx === oIdx,
                                }));
                              } else {
                                qs[qIdx].options[oIdx].isCorrect = !qs[qIdx].options[oIdx].isCorrect;
                              }
                              setAssessmentForm({ ...assessmentForm, questions: qs });
                            }}
                            className="h-4 w-4 text-[#2563EB] shrink-0 cursor-pointer"
                          />
                          <input
                            type="text"
                            required
                            disabled={q.type === 'TRUE_FALSE'}
                            value={opt.optionText}
                            onChange={(e) => {
                              const qs = [...assessmentForm.questions];
                              qs[qIdx].options[oIdx].optionText = e.target.value;
                              setAssessmentForm({ ...assessmentForm, questions: qs });
                            }}
                            className="flex-1 px-3 py-1.5 border border-[#cbdbf5] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#2563EB] disabled:bg-slate-100"
                          />
                          {q.type !== 'TRUE_FALSE' && q.options.length > 2 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveOption(qIdx, oIdx)}
                              className="text-[#737686] hover:text-red-600 font-bold px-1.5"
                              title="Xóa đáp án này"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}

                      {q.type !== 'TRUE_FALSE' && (
                        <button
                          type="button"
                          onClick={() => handleAddOption(qIdx)}
                          className="text-xs text-[#2563EB] hover:underline font-semibold pt-1 block"
                        >
                          ＋ Thêm đáp án lựa chọn
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-[#eff4ff]">
                <Button variant="outline" onClick={() => setShowAssessmentModal(false)}>
                  Hủy
                </Button>
                <Button loading={assessmentSaving} loadingText="Đang lưu..." onClick={handleSaveAssessment}>
                  Lưu bài đánh giá
                </Button>
              </div>
            </div>
        </Modal>
    </>
  );
}
