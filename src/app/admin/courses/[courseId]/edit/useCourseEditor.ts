'use client';
import { useEffect, useState, useRef } from 'react';
import type { ToastMessage } from '@/components/ui/Toast';
import { apiFetch, clearApiCache, getCachedApiData } from '@/lib/api/client';
import { normalizeDurationSeconds, parseDurationInput } from '@/lib/validation/duration';

interface QuestionOptionForm {
  optionText: string;
  isCorrect: boolean;
}

interface QuestionForm {
  questionText: string;
  type: 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE';
  points: number;
  durationSeconds: number;
  explanation: string;
  poolIndex?: number;
  options: QuestionOptionForm[];
}

export function useCourseEditor(params: { courseId: string }) {
  const [course, setCourse] = useState<any>(null);
  const [assessment, setAssessment] = useState<any>(null);
  const [finalAvailableQuestions, setFinalAvailableQuestions] = useState(0);

  const [form, setForm] = useState({
    title: '',
    description: '',
    visibility: 'PRIVATE' as 'PUBLIC' | 'PRIVATE',
    status: 'DRAFT' as 'DRAFT' | 'PUBLISHED',
  });

  const [loading, setLoading] = useState(true);
  const [savingInfo, setSavingInfo] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [publishLoading, setPublishLoading] = useState(false);
  const [showUnpublishConfirm, setShowUnpublishConfirm] = useState(false);

  // Toast
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = (type: 'success' | 'error' | 'info', message: string, title?: string) => {
    setToast({ type, message, title });
  };

  // Session Modal (Add & Edit)
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [sessionModalMode, setSessionModalMode] = useState<'create' | 'edit'>('create');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sessionForm, setSessionForm] = useState({ title: '', description: '' });
  const [sessionSaving, setSessionSaving] = useState(false);

  // Lesson Modal (Add & Edit)
  const [showLessonModal, setShowLessonModal] = useState<string | null>(null);
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [lessonForm, setLessonForm] = useState({
    title: '',
    description: '',
    youtubeVideoId: '',
    durationSeconds: 0,
    durationFormatted: '',
    durationKnown: false,
    manualDuration: '',
  });
  const [lessonSaving, setLessonSaving] = useState(false);
  const [videoPreviewTitle, setVideoPreviewTitle] = useState('');
  const [fetchingDuration, setFetchingDuration] = useState(false);
  const [durationFetchError, setDurationFetchError] = useState('');
  const [durationWarning, setDurationWarning] = useState('');
  const [isVideoVerified, setIsVideoVerified] = useState(false);
  const ytIdDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Document Upload State
  const [uploadingDocForLessonId, setUploadingDocForLessonId] = useState<string | null>(null);

  // Assessment State
  const [showAssessmentModal, setShowAssessmentModal] = useState(false);
  const [activeAssessmentMode, setActiveAssessmentMode] = useState<'LESSON' | 'COURSE_FINAL'>('LESSON');
  const [activeLessonForAssessment, setActiveLessonForAssessment] = useState<{
    sessionId: string;
    lessonId: string;
    lessonTitle: string;
    assessment: any;
  } | null>(null);
  const [assessmentSaving, setAssessmentSaving] = useState(false);
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const assessmentLoadIdRef = useRef(0);
  const [assessmentFormError, setAssessmentFormError] = useState('');
  const [quizImportUrl, setQuizImportUrl] = useState('');
  const [quizImporting, setQuizImporting] = useState(false);
  const [quizImportErrors, setQuizImportErrors] = useState<{ row: number; message: string }[]>([]);
  const [quizPoolNames, setQuizPoolNames] = useState(['Nhóm 1']);
  const [assessmentForm, setAssessmentForm] = useState({
    title: 'Bài kiểm tra bài học',
    description: 'Đạt từ 85% điểm để hoàn thành bài học',
    questionCount: 10,
    durationMinutes: 30,
    questions: [
      {
        questionText: 'Câu hỏi 1: ',
        type: 'SINGLE_CHOICE' as 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE',
        points: 1,
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

  const closeAssessmentModal = () => {
    assessmentLoadIdRef.current += 1;
    setAssessmentLoading(false);
    setShowAssessmentModal(false);
  };

  useEffect(() => {
    loadCourse();
  }, [params.courseId]);

  const hasUnsavedCourseInfo = Boolean(course) && (
    form.title !== (course.title || '') ||
    form.description !== (course.description || '') ||
    form.visibility !== course.visibility
  );

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedCourseInfo) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedCourseInfo]);

  async function loadCourse() {
    const courseRes = await apiFetch(`/api/v1/courses/${params.courseId}`, { noCache: true });

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

    setLoading(false);
  }

  // ─── Open Assessment Modal for a specific Lesson ─────────────────────────────
  const openAssessmentEditorForLesson = async (sId: string, lesson: any) => {
    const loadId = ++assessmentLoadIdRef.current;
    setActiveAssessmentMode('LESSON');
    setAssessmentFormError('');
    setQuizImportUrl('');
    setQuizImportErrors([]);
    const lId = lesson.lessonId || lesson.id;
    setActiveLessonForAssessment({
      sessionId: sId,
      lessonId: lId,
      lessonTitle: lesson.title,
      assessment: lesson.assessment,
    });
    setShowAssessmentModal(true);
    setAssessmentLoading(Boolean(lesson.assessment));
    let assessData = lesson.assessment;

    // The modal opens immediately. One endpoint now returns assessment + pools,
    // avoiding the old pair of sequential requests before anything was shown.
    if (assessData) {
      const res = await apiFetch(`/api/v1/lessons/${lId}/assessment`);
      if (loadId !== assessmentLoadIdRef.current) return;
      if (res.ok && res.data) {
        assessData = res.data;
      } else {
        setAssessmentLoading(false);
        showToast('error', res.error?.message || 'Không tải được nội dung Quiz.');
        return;
      }
    }
    let poolNames = ['Nhóm 1'];
    const poolIndexById = new Map<string, number>();
    if (Array.isArray(assessData?.pools) && assessData.pools.length > 0) {
      poolNames = assessData.pools.map((pool: any) => pool.name);
      assessData.pools.forEach((pool: any, index: number) => poolIndexById.set(pool.poolId, index));
    }
    setQuizPoolNames(poolNames);

    setActiveLessonForAssessment({
      sessionId: sId,
      lessonId: lId,
      lessonTitle: lesson.title,
      assessment: assessData,
    });
    setAssessment(assessData);

    if (assessData && Array.isArray(assessData.questions) && assessData.questions.length > 0) {
      setAssessmentForm({
        title: assessData.title || `Bài kiểm tra: ${lesson.title}`,
        description: assessData.description || '',
        questionCount: assessData?.questionCount || 1,
        durationMinutes: assessData ? (assessData.durationMinutes ?? 0) : 30,
        questions: assessData.questions.map((q: any, idx: number) => ({
          questionText: q.questionText || q.question_text || `Câu hỏi ${idx + 1}`,
          // Loại Đúng/Sai đã ngừng dùng: quy về 1 đáp án để form không lỗi khi đọc dữ liệu cũ
          type: (q.type || q.questionType) === 'MULTIPLE_CHOICE' ? 'MULTIPLE_CHOICE' : 'SINGLE_CHOICE',
          points: q.points || 10,
          durationSeconds: q.durationSeconds || q.duration_seconds || 120,
          explanation: q.explanation || '',
           poolIndex: poolIndexById.get(q.poolId) ?? idx % Math.max(1, poolNames.length),
          options: (q.options || []).map((opt: any, oIdx: number) => ({
            optionText: opt.optionText || opt.option_text || `Đáp án ${oIdx + 1}`,
            isCorrect: Boolean(opt.isCorrect ?? opt.is_correct),
          })),
        })),
      });
    } else {
      setAssessmentForm({
        title: `Bài kiểm tra: ${lesson.title}`,
        description: 'Vui lòng hoàn thành bài kiểm tra để tiếp tục bài học tiếp theo.',
        questionCount: assessData?.questionCount || 1,
        durationMinutes: assessData ? (assessData.durationMinutes ?? 0) : 30,
        questions: [
          {
            questionText: 'Câu hỏi 1: Nội dung bài học này nói về điều gì?',
            type: 'SINGLE_CHOICE' as 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE',
            points: 1,
            durationSeconds: 120,
            explanation: '',
            options: [
              { optionText: 'Đáp án đúng', isCorrect: true },
              { optionText: 'Đáp án sai 1', isCorrect: false },
              { optionText: 'Đáp án sai 2', isCorrect: false },
              { optionText: 'Đáp án sai 3', isCorrect: false },
            ],
          },
        ],
      });
    }
    setAssessmentLoading(false);
  };

  const openFinalAssessmentEditor = async () => {
    const loadId = ++assessmentLoadIdRef.current;
    setActiveAssessmentMode('COURSE_FINAL');
    setAssessmentFormError('');
    setQuizImportUrl('');
    setQuizImportErrors([]);
    setActiveLessonForAssessment(null);
    setShowAssessmentModal(true);
    setAssessmentLoading(true);
    const result = await apiFetch(`/api/v1/courses/${params.courseId}/final-assessment`);
    if (loadId !== assessmentLoadIdRef.current) return;
    if (!result.ok) {
      setAssessmentLoading(false);
      showToast('error', result.error?.message || 'Không tải được cấu hình bài thi cuối khóa.');
      setShowAssessmentModal(false);
      return;
    }
    const assessData = result.data?.assessment || null;
    setFinalAvailableQuestions(Number(result.data?.availableQuestions || 0));
    setQuizPoolNames([]);
    setAssessment(assessData);
    setAssessmentForm({
        title: assessData?.title || 'Bài thi cuối khóa',
        description: assessData?.description || 'Đạt tối thiểu 85% để hoàn thành khóa học.',
        questionCount: assessData?.questionCount || 1,
        durationMinutes: assessData ? (assessData.durationMinutes ?? 0) : 30,
        questions: [],
    });
    setAssessmentLoading(false);
  };

  // ─── Course Info Form ──────────────────────────────────────────────────────────
  const handleSaveInfo = async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (form.status === 'PUBLISHED') {
      showToast('error', 'Khóa học đang công khai. Hãy Bỏ công khai trước rồi mới chỉnh sửa.');
      return false;
    }

    setSavingInfo(true);
    clearApiCache('/api/v1/courses');
    clearApiCache(`/api/v1/courses/${params.courseId}`);

    const res = await apiFetch(`/api/v1/courses/${params.courseId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: form.title.trim(),
        description: form.description.trim(),
        visibility: form.visibility,
      }),
    });

    clearApiCache('/api/v1/courses');
    clearApiCache(`/api/v1/courses/${params.courseId}`);

    if (res.ok) {
      showToast('success', 'Đã cập nhật thông tin khóa học thành công!');
      setCourse((prev: any) => ({ ...prev, ...res.data }));
    } else {
      showToast('error', res.error?.message || 'Không thể lưu thay đổi');
    }
    setSavingInfo(false);
    return res.ok;
  };

  const handleCoverUpload = async (file?: File) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
      showToast('error', 'Chỉ nhận JPG, PNG hoặc WebP, tối đa 8 MB.');
      return;
    }
    setCoverUploading(true);
    const payload = new FormData();
    payload.append('file', file);
    const res = await apiFetch(`/api/v1/courses/${params.courseId}/cover`, { method: 'POST', body: payload, noCache: true });
    setCoverUploading(false);
    if (res.ok && res.data) {
      setCourse((previous: any) => ({ ...previous, coverUrl: res.data.coverUrl }));
      clearApiCache('/api/v1/courses');
      showToast('success', 'Đã cập nhật ảnh bìa khóa học.');
    } else {
      showToast('error', res.error?.message || 'Không thể tải ảnh bìa.');
    }
  };

  const handlePublish = async () => {
    setPublishLoading(true);
    if (hasUnsavedCourseInfo) {
      const saved = await handleSaveInfo();
      if (!saved) { setPublishLoading(false); return; }
    }
    clearApiCache('/api/v1/courses');
    clearApiCache(`/api/v1/courses/${params.courseId}`);

    const res = await apiFetch(`/api/v1/courses/${params.courseId}/publish`, { method: 'POST' });
    clearApiCache('/api/v1/courses');
    clearApiCache(`/api/v1/courses/${params.courseId}`);

    if (res.ok) {
      setForm((prev) => ({ ...prev, status: 'PUBLISHED' }));
      setCourse((prev: any) => ({ ...prev, status: 'PUBLISHED' }));
      showToast('success', 'Đã công khai khóa học thành công!');
    } else if (res.error?.code === 'AlreadyPublished') {
      setForm((prev) => ({ ...prev, status: 'PUBLISHED' }));
      setCourse((prev: any) => ({ ...prev, status: 'PUBLISHED' }));
      showToast('info', 'Khóa học đã ở trạng thái công khai.');
    } else {
      showToast('error', res.error?.message || 'Khóa học cần ít nhất 1 buổi học và mỗi buổi học có 1 bài học.');
    }
    setPublishLoading(false);
  };

  const handleUnpublish = async () => {
    setShowUnpublishConfirm(false);
    setPublishLoading(true);
    clearApiCache('/api/v1/courses');
    clearApiCache(`/api/v1/courses/${params.courseId}`);

    const res = await apiFetch(`/api/v1/courses/${params.courseId}/unpublish`, { method: 'POST' });
    clearApiCache('/api/v1/courses');
    clearApiCache(`/api/v1/courses/${params.courseId}`);

    if (res.ok) {
      setForm((prev) => ({ ...prev, status: 'DRAFT' }));
      setCourse((prev: any) => ({ ...prev, status: 'DRAFT' }));
      showToast('info', 'Đã chuyển khóa học về bản nháp. Bạn có thể chỉnh sửa nội dung.');
    } else if (res.error?.code === 'AlreadyDraft') {
      setForm((prev) => ({ ...prev, status: 'DRAFT' }));
      setCourse((prev: any) => ({ ...prev, status: 'DRAFT' }));
      showToast('info', 'Khóa học đã ở trạng thái bản nháp.');
    } else {
      showToast('error', res.error?.message || 'Không thể bỏ công khai khóa học.');
    }
    setPublishLoading(false);
  };

  // ─── Session Management ───────────────────────────────────────────────────────
  const openAddSessionModal = () => {
    setSessionModalMode('create');
    setEditingSessionId(null);
    setSessionForm({ title: '', description: '' });
    setShowSessionModal(true);
  };

  const openEditSessionModal = (session: any) => {
    setSessionModalMode('edit');
    setEditingSessionId(session.sessionId || session.id);
    setSessionForm({
      title: session.title || '',
      description: session.description || '',
    });
    setShowSessionModal(true);
  };

  const handleSaveSession = async () => {
    const titleToSave = sessionForm.title.trim();
    if (!titleToSave) {
      showToast('error', 'Vui lòng nhập tiêu đề buổi học');
      return;
    }

    setSessionSaving(true);
    clearApiCache('/api/v1/courses');

    if (sessionModalMode === 'create') {
      const tempId = 'temp-' + Date.now();
      const newSessionObj = {
        sessionId: tempId,
        id: tempId,
        title: titleToSave,
        description: sessionForm.description.trim() || null,
        sortOrder: course?.sessions?.length || 0,
        lessons: [],
      };

      setCourse((prev: any) => ({
        ...prev,
        sessions: [...(prev?.sessions || []), newSessionObj],
      }));
      setShowSessionModal(false);
      showToast('success', `Đã thêm buổi học "${titleToSave}" thành công!`);

      const res = await apiFetch(`/api/v1/courses/${params.courseId}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          title: titleToSave,
          description: sessionForm.description.trim() || undefined,
          sortOrder: course?.sessions?.length || 0,
        }),
      });

      if (res.ok && res.data) {
        const realSessionId = res.data.sessionId || res.data.id;
        setCourse((prev: any) => ({
          ...prev,
          sessions: prev.sessions.map((s: any) =>
            s.sessionId === tempId ? { ...s, sessionId: realSessionId, id: realSessionId, description: res.data.description || s.description } : s
          ),
        }));
      } else {
        showToast('error', res.error?.message || 'Lỗi thêm buổi học');
        loadCourse();
      }
    } else if (editingSessionId) {
      const targetSessionId = editingSessionId;
      const updatedDesc = sessionForm.description.trim() || null;

      setCourse((prev: any) => ({
        ...prev,
        sessions: prev.sessions.map((s: any) =>
          (s.sessionId || s.id) === targetSessionId
            ? { ...s, title: titleToSave, description: updatedDesc }
            : s
        ),
      }));
      setShowSessionModal(false);
      showToast('success', `Đã cập nhật buổi học "${titleToSave}" thành công!`);

      const res = await apiFetch(`/api/v1/sessions/${targetSessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: titleToSave,
          description: updatedDesc,
        }),
      });

      if (!res.ok) {
        showToast('error', res.error?.message || 'Lỗi cập nhật buổi học');
        loadCourse();
      }
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
    setEditingLessonId(null);
    setShowLessonModal(sessionId);
    setLessonForm({ title: '', description: '', youtubeVideoId: '', durationSeconds: 0, durationFormatted: '', durationKnown: false, manualDuration: '' });
    setVideoPreviewTitle('');
    setDurationFetchError('');
    setDurationWarning('');
    setFetchingDuration(false);
    setIsVideoVerified(false);
  };

  const openEditLessonModal = (sessionId: string, lesson: any) => {
    const lId = lesson.lessonId || lesson.id;
    const vidId = lesson.video?.youtubeVideoId || lesson.youtubeVideoId || '';
    const durSec = lesson.video?.durationSeconds || lesson.durationSeconds || 0;
    const durMin = Math.floor(durSec / 60);
    const durRemSec = durSec % 60;
    const formatted = durSec > 0 ? `${durMin}:${durRemSec.toString().padStart(2, '0')}` : '';

    setEditingLessonId(lId);
    setShowLessonModal(sessionId);
    setLessonForm({
      title: lesson.title || '',
      description: lesson.description || '',
      youtubeVideoId: vidId,
      durationSeconds: durSec,
      durationFormatted: formatted,
      durationKnown: durSec > 0,
      manualDuration: '',
    });
    setVideoPreviewTitle(lesson.video?.title || lesson.title || '');
    setDurationFetchError('');
    setDurationWarning('');
    setFetchingDuration(false);
    setIsVideoVerified(Boolean(vidId));
  };

  const closeLessonModal = () => {
    setShowLessonModal(null);
    setEditingLessonId(null);
    setLessonForm({ title: '', description: '', youtubeVideoId: '', durationSeconds: 0, durationFormatted: '', durationKnown: false, manualDuration: '' });
    setVideoPreviewTitle('');
    setDurationFetchError('');
    setDurationWarning('');
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
    setLessonForm((prev) => ({
      ...prev,
      youtubeVideoId: rawVal,
      durationSeconds: 0,
      durationFormatted: '',
      durationKnown: false,
      manualDuration: '',
    }));
    setDurationFetchError('');
    setDurationWarning('');
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
        const infoRes = await apiFetch(`/api/v1/youtube/info?videoId=${vidId}`, { noCache: true });
        if (infoRes.ok && infoRes.data) {
          const info = infoRes.data;
          const durationKnown = info.durationKnown === true && Number(info.durationSeconds) > 0;
          setVideoPreviewTitle(info.title || 'Video YouTube');
          setDurationFetchError('');
          const reasonText =
            info.reason === 'LIVE_STREAM'
              ? 'Video đang phát trực tiếp nên không có thời lượng cố định'
              : 'Hệ thống không đọc được thời lượng từ YouTube';
          setDurationWarning(
            durationKnown ? '' : `${reasonText}. Vui lòng nhập thời lượng thủ công bên dưới.`
          );
          setIsVideoVerified(true);

          setLessonForm((prev) => ({
            ...prev,
            title: prev.title ? prev.title : info.title || prev.title,
            durationSeconds: durationKnown ? info.durationSeconds : 0,
            durationFormatted: durationKnown ? info.durationFormatted || '' : '',
            durationKnown,
          }));
        } else {
          setDurationWarning('');
          setDurationFetchError(
            infoRes.error?.message ||
              'Video YouTube không tồn tại, ở chế độ riêng tư hoặc không cho phép nhúng. Vui lòng kiểm tra lại link/ID.'
          );
          setIsVideoVerified(false);
        }
      } catch {
        setDurationWarning('');
        setDurationFetchError('Lỗi kiểm tra thông tin video YouTube.');
        setIsVideoVerified(false);
      } finally {
        setFetchingDuration(false);
      }
    }, 400);
  };

  const handleSaveLesson = async () => {
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

    const durationSec = lessonForm.durationKnown
      ? normalizeDurationSeconds(lessonForm.durationSeconds)
      : parseDurationInput(lessonForm.manualDuration);

    if (durationSec === null) {
      showToast('error', 'Vui lòng nhập thời lượng video (định dạng mm:ss hoặc tổng số giây).');
      return;
    }

    setLessonSaving(true);
    clearApiCache('/api/v1/courses');

    const targetSessionId = showLessonModal;
    const lessonTitle = lessonForm.title.trim();

    if (editingLessonId) {
      const targetLessonId = editingLessonId;
      const updatedDesc = lessonForm.description.trim() || null;

      setCourse((prev: any) => ({
        ...prev,
        sessions: (prev?.sessions || []).map((s: any) =>
          (s.sessionId || s.id) === targetSessionId
            ? {
                ...s,
                lessons: (s.lessons || []).map((l: any) =>
                  (l.lessonId || l.id) === targetLessonId
                    ? {
                        ...l,
                        title: lessonTitle,
                        description: updatedDesc,
                        youtubeVideoId: cleanVidId,
                        video: {
                          ...(l.video || {}),
                          youtubeVideoId: cleanVidId,
                          durationSeconds: durationSec,
                          title: videoPreviewTitle || lessonTitle,
                        },
                      }
                    : l
                ),
              }
            : s
        ),
      }));

      closeLessonModal();
      showToast('success', `Đã cập nhật bài học "${lessonTitle}" thành công!`);

      const res = await apiFetch(`/api/v1/lessons/${targetLessonId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: lessonTitle,
          description: updatedDesc,
          video: {
            youtubeVideoId: cleanVidId,
            durationSeconds: durationSec,
            title: videoPreviewTitle || lessonTitle,
          },
        }),
      });

      if (res.ok && res.data) {
        setCourse((prev: any) => ({
          ...prev,
          sessions: (prev?.sessions || []).map((s: any) =>
            (s.sessionId || s.id) === targetSessionId
              ? {
                  ...s,
                  lessons: (s.lessons || []).map((l: any) =>
                    (l.lessonId || l.id) === targetLessonId
                      ? {
                          ...l,
                          title: res.data.title || lessonTitle,
                          description: res.data.description,
                          video: res.data.video || l.video,
                        }
                      : l
                  ),
                }
              : s
          ),
        }));
      } else {
        showToast('error', res.error?.message || 'Lỗi cập nhật bài học');
        loadCourse();
      }
      setLessonSaving(false);
      return;
    }

    const tempLessonId = 'temp-lesson-' + Date.now();
    const tempLessonObj = {
      lessonId: tempLessonId,
      id: tempLessonId,
      title: lessonTitle,
      description: lessonForm.description.trim() || null,
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
                        description: res.data.description || l.description,
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

  // ─── Document Upload (Direct R2 Presigned + Multi-file + Max 100MB) ────────────
  const handleDirectUploadDoc = async (
    sessionId: string,
    lessonId: string,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const MAX_DOC_SIZE_MB = 100;
    const MAX_DOC_BYTES = MAX_DOC_SIZE_MB * 1024 * 1024;

    const oversized = files.filter((f) => f.size > MAX_DOC_BYTES);
    if (oversized.length > 0) {
      showToast('error', `Tài liệu "${oversized[0].name}" vượt quá dung lượng tối đa (${MAX_DOC_SIZE_MB}MB). Vui lòng chọn file nhỏ hơn.`);
      e.target.value = '';
      return;
    }

    setUploadingDocForLessonId(lessonId);
    clearApiCache('/api/v1/courses');

    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : '';
    const addedDocs: any[] = [];
    let successCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let uploadedDoc: any = null;

      try {
        // 1. Try Direct R2 Presigned Upload (Bypasses Vercel's 4.5MB limit entirely!)
        const presignRes = await fetch(`/api/v1/lessons/${lessonId}/documents/presign`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            fileSize: file.size,
          }),
        });
        const presignData = await presignRes.json().catch(() => null);

        if (presignRes.ok && presignData?.uploadUrl) {
          try {
            const r2Res = await fetch(presignData.uploadUrl, {
              method: 'PUT',
              headers: {
                'Content-Type': file.type || 'application/octet-stream',
              },
              body: file,
            });

            if (r2Res.ok) {
              const confirmRes = await fetch(`/api/v1/lessons/${lessonId}/documents/confirm`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                  fileName: file.name,
                  storageKey: presignData.storageKey,
                  mimeType: file.type || 'application/octet-stream',
                  fileSize: file.size,
                }),
              });
              const confirmData = await confirmRes.json().catch(() => null);
              if (confirmRes.ok && confirmData) {
                uploadedDoc = {
                  documentId: confirmData.documentId || confirmData.id,
                  id: confirmData.documentId || confirmData.id,
                  fileName: confirmData.fileName || file.name,
                  fileSize: confirmData.fileSize || file.size,
                  mimeType: confirmData.mimeType || file.type,
                };
              }
            }
          } catch (r2Err) {
            console.warn(`Direct R2 upload failed for ${file.name}, trying server fallback...`, r2Err);
          }
        }

        // 2. Fallback: If direct R2 upload failed and file <= 4.2MB, try server upload
        if (!uploadedDoc && file.size <= 4.2 * 1024 * 1024) {
          const formData = new FormData();
          formData.append('file', file);
          const res = await fetch(`/api/v1/lessons/${lessonId}/documents/upload`, {
            method: 'POST',
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: formData,
          });
          const data = await res.json().catch(() => null);
          if (res.ok && data) {
            uploadedDoc = {
              documentId: data.documentId || data.id,
              id: data.documentId || data.id,
              fileName: data.fileName || file.name,
              fileSize: data.fileSize || file.size,
              mimeType: data.mimeType || file.type,
            };
          }
        }
      } catch (err) {
        console.error(`Upload error for ${file.name}:`, err);
      }

      if (uploadedDoc) {
        addedDocs.push(uploadedDoc);
        successCount++;
      } else {
        const sizeMb = (file.size / 1024 / 1024).toFixed(1);
        if (file.size > 4.2 * 1024 * 1024) {
          showToast(
            'error',
            `Không thể tải "${file.name}" (${sizeMb}MB). Nếu file lớn hơn 4.5MB, hãy đảm bảo Cloudflare R2 bucket đã được bật CORS Policy.`
          );
        } else {
          showToast('error', `Tải lên file "${file.name}" thất bại.`);
        }
      }
    }

    if (addedDocs.length > 0) {
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
                        documents: [...(l.documents || []), ...addedDocs],
                      }
                    : l
                ),
              }
            : s
        ),
      }));

      if (files.length === 1) {
        showToast('success', `Đã tải lên tài liệu "${files[0].name}" thành công!`);
      } else {
        showToast('success', `Đã tải lên thành công ${successCount}/${files.length} tài liệu!`);
      }
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
  const handleAddQuestion = (poolIndex = 0) => {
    setAssessmentForm((prev) => ({
      ...prev,
      questions: [
        ...prev.questions,
        {
          questionText: `Câu hỏi ${prev.questions.length + 1}: `,
          type: 'SINGLE_CHOICE',
          points: 1,
          durationSeconds: 120,
          explanation: '',
          poolIndex,
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

  const handleAddPool = () => setQuizPoolNames((previous) => [...previous, `Nhóm ${previous.length + 1}`]);
  const handleRemovePool = (poolIndex: number) => {
    if (quizPoolNames.length <= 1) return showToast('error', 'Quiz phải có ít nhất một nhóm.');
    if (assessmentForm.questions.some((question) => (question.poolIndex ?? 0) === poolIndex)) return showToast('error', 'Hãy xóa hoặc chuyển các câu hỏi trong nhóm trước.');
    setQuizPoolNames((previous) => previous.filter((_, index) => index !== poolIndex));
    setAssessmentForm((previous) => ({ ...previous, questions: previous.questions.map((question) => ({ ...question, poolIndex: (question.poolIndex ?? 0) > poolIndex ? (question.poolIndex ?? 0) - 1 : question.poolIndex })) }));
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
    newType: 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE'
  ) => {
    const updated = [...assessmentForm.questions];
    const q = updated[qIdx];
    q.type = newType;

    if (newType === 'SINGLE_CHOICE') {
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

  const handleImportQuiz = async () => {
    const url = quizImportUrl.trim();
    if (!url) {
      showToast('error', 'Vui lòng dán link Google Sheet hoặc Google Doc');
      return;
    }

    const existingCount = assessmentForm.questions.length;
    if (
      existingCount > 0 &&
      !window.confirm(
        `Form đang có ${existingCount} câu hỏi. Import sẽ THAY THẾ danh sách câu hỏi đang soạn; bấm "Lưu bài kiểm tra" để ghi đè bài kiểm tra hiện có. Tiếp tục?`
      )
    ) {
      return;
    }

    setQuizImporting(true);
    const res = await apiFetch('/api/v1/quiz/parse-sheet', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
    setQuizImporting(false);

    if (!res.ok || !res.data) {
      setQuizImportErrors([]);
      showToast('error', res.error?.message || 'Không nhập được câu hỏi từ Google Sheet');
      return;
    }

    const imported = res.data.questions || [];
    setAssessmentForm((prev) => ({
      ...prev,
      questions: imported.map((q: any, idx: number) => ({
        questionText: q.questionText,
        type: q.questionType as 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE',
        points: q.points || 1,
        durationSeconds: prev.questions[0]?.durationSeconds ?? 120,
        explanation: q.explanation || '',
        poolIndex: Number.isInteger(q.poolIndex) ? q.poolIndex : idx % Math.max(1, (res.data.pools || quizPoolNames).length),
        options: (q.options || []).map((o: any) => ({
          optionText: o.optionText,
          isCorrect: Boolean(o.isCorrect),
        })),
      })),
    }));
    if (Array.isArray(res.data.pools) && res.data.pools.length) setQuizPoolNames(res.data.pools);
    setQuizImportErrors(res.data.errors || []);

    const errorCount = (res.data.errors || []).length;
    showToast(
      'success',
      `Đã nhập ${imported.length} câu hỏi${errorCount > 0 ? ` (bỏ qua ${errorCount} dòng lỗi)` : ''}`
    );
  };

  const handleSaveAssessment = async () => {
    setAssessmentFormError('');

    if (!assessmentForm.title.trim()) {
      setAssessmentFormError('Vui lòng nhập tiêu đề bài kiểm tra');
      showToast('error', 'Vui lòng nhập tiêu đề bài kiểm tra');
      return;
    }

    if (activeAssessmentMode === 'LESSON') for (let i = 0; i < assessmentForm.questions.length; i++) {
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
    const poolCounts = Array.from({ length: quizPoolNames.length }, () => 0);
    for (const question of assessmentForm.questions) poolCounts[question.poolIndex ?? 0]++;
    if (activeAssessmentMode === 'LESSON' && (!quizPoolNames.length || quizPoolNames.some((name) => !name.trim()) || poolCounts.some((count) => count < 1) || assessmentForm.questionCount > assessmentForm.questions.length)) {
      const msg = 'Mỗi nhóm phải có tên và ít nhất một câu; tổng ngân hàng phải đủ số câu mỗi lượt.';
      setAssessmentFormError(msg);
      showToast('error', msg);
      return;
    }

    if (activeAssessmentMode === 'LESSON' && !activeLessonForAssessment?.lessonId) {
      showToast('error', 'Không xác định được bài học cần gắn bài kiểm tra');
      return;
    }
    if (activeAssessmentMode === 'COURSE_FINAL' && assessmentForm.questionCount > finalAvailableQuestions) {
      const msg = `Bài thi cần ${assessmentForm.questionCount} câu, nhưng quiz các bài học chỉ có ${finalAvailableQuestions} câu. Hãy giảm số câu hoặc bổ sung ngân hàng.`;
      setAssessmentFormError(msg);
      showToast('error', msg);
      return;
    }

    if (activeAssessmentMode === 'LESSON' && quizPoolNames.length > 0) {
      if (minLessonPoolCount === 0) {
        const msg = 'Mỗi nhóm câu hỏi cần có ít nhất 1 câu hỏi để đủ điều kiện lưu cấu hình.';
        setAssessmentFormError(msg);
        showToast('error', msg);
        return;
      }
      if (assessmentForm.questionCount < quizPoolNames.length) {
        const msg = `Số câu mỗi lượt (${assessmentForm.questionCount}) không thể nhỏ hơn số nhóm (${quizPoolNames.length}).`;
        setAssessmentFormError(msg);
        showToast('error', msg);
        return;
      }
      if (assessmentForm.questionCount > maxLessonQuestionsAllowed) {
        const msg = `Với ${quizPoolNames.length} nhóm và nhóm ít câu nhất có ${minLessonPoolCount} câu, bài kiểm tra chỉ được chọn tối đa ${maxLessonQuestionsAllowed} câu để bảo đảm phân phối cân bằng.`;
        setAssessmentFormError(msg);
        showToast('error', msg);
        return;
      }
    }

    setAssessmentSaving(true);
    clearApiCache('/api/v1/courses');

    const endpoint = activeAssessmentMode === 'COURSE_FINAL'
      ? `/api/v1/courses/${params.courseId}/final-assessment`
      : `/api/v1/lessons/${activeLessonForAssessment!.lessonId}/assessment`;
    const res = await apiFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({
        title: assessmentForm.title.trim(),
        description: assessmentForm.description.trim(),
        ...(activeAssessmentMode === 'LESSON' ? { pools: quizPoolNames } : {}),
        questionCount: assessmentForm.questionCount,
        durationMinutes: assessmentForm.durationMinutes,
        ...(activeAssessmentMode === 'LESSON' ? { questions: assessmentForm.questions.map((q, idx) => ({
          questionText: q.questionText.trim(),
          questionType: q.type,
          points: q.points,
          durationSeconds: q.durationSeconds,
          explanation: (q.explanation || '').trim() || null,
          sortOrder: idx,
          poolIndex: q.poolIndex ?? 0,
          options: q.options.map((opt, oIdx) => ({
            optionText: opt.optionText.trim(),
            isCorrect: opt.isCorrect,
            sortOrder: oIdx,
          })),
        })) } : {}),
      }),
    });

    if (res.ok) {
      clearApiCache(endpoint);
      clearApiCache(`/api/v1/courses/${params.courseId}`);
      clearApiCache('/api/v1/assessments');
      showToast('success', activeAssessmentMode === 'COURSE_FINAL' ? 'Đã lưu cấu hình bài thi cuối khóa.' : `Đã lưu thành công bài kiểm tra (${assessmentForm.questions.length} câu hỏi)!`);
      setShowAssessmentModal(false);
      setAssessment(res.data);

      if (activeAssessmentMode === 'COURSE_FINAL') {
        setFinalAvailableQuestions(Number(res.data?.availableQuestions || 0));
        setCourse((prev: any) => prev ? { ...prev, assessment: res.data, finalAssessment: res.data } : prev);
      } else setCourse((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          sessions: (prev.sessions || []).map((s: any) => {
            const sId = s.sessionId || s.id;
            if (sId === activeLessonForAssessment.sessionId) {
              return {
                ...s,
                lessons: (s.lessons || []).map((l: any) => {
                  const lId = l.lessonId || l.id;
                  if (lId === activeLessonForAssessment.lessonId) {
                    return { ...l, assessment: res.data };
                  }
                  return l;
                }),
              };
            }
            return s;
          }),
        };
      });
    } else {
      const errMsg = res.error?.message || 'Lỗi khi lưu bài kiểm tra';
      setAssessmentFormError(errMsg);
      showToast('error', errMsg);
    }
    setAssessmentSaving(false);
  };

  const handleDeleteAssessment = async () => {
    const assessObj = activeAssessmentMode === 'COURSE_FINAL'
      ? course?.finalAssessment || course?.assessment
      : activeLessonForAssessment?.assessment || assessment;
    if (!assessObj) return;
    if (activeAssessmentMode === 'COURSE_FINAL' && !course?.finalAssessment) return;

    if (!window.confirm('Bạn có chắc muốn xóa bài kiểm tra của bài học này?')) return;

    clearApiCache('/api/v1/courses');
    const endpoint = activeAssessmentMode === 'COURSE_FINAL'
      ? `/api/v1/courses/${params.courseId}/final-assessment`
      : `/api/v1/lessons/${activeLessonForAssessment?.lessonId}/assessment`;
    const res = await apiFetch(endpoint, { method: 'DELETE' });
    if (res.ok) {
      showToast('success', 'Đã xóa bài kiểm tra thành công.');
      setShowAssessmentModal(false);
      setAssessment(null);

      if (activeAssessmentMode === 'COURSE_FINAL') {
        setCourse((prev: any) => prev ? { ...prev, assessment: null, finalAssessment: null } : prev);
      } else if (activeLessonForAssessment) {
        setCourse((prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            sessions: (prev.sessions || []).map((s: any) => {
              const sId = s.sessionId || s.id;
              if (sId === activeLessonForAssessment.sessionId) {
                return {
                  ...s,
                  lessons: (s.lessons || []).map((l: any) => {
                    const lId = l.lessonId || l.id;
                    if (lId === activeLessonForAssessment.lessonId) {
                      return { ...l, assessment: null };
                    }
                    return l;
                  }),
                };
              }
              return s;
            }),
          };
        });
      }
    } else {
      showToast('error', res.error?.message || 'Lỗi khi xóa bài kiểm tra');
    }
  };

  const lessonPoolCounts = activeAssessmentMode === 'LESSON' && quizPoolNames.length > 0
    ? quizPoolNames.map((_, idx) => assessmentForm.questions.filter((q) => (q.poolIndex ?? 0) === idx).length)
    : [];
  const minLessonPoolCount = lessonPoolCounts.length > 0 ? Math.min(...lessonPoolCounts) : 0;
  const maxLessonQuestionsAllowed = quizPoolNames.length * minLessonPoolCount;
  const isLessonQuizInvalid = activeAssessmentMode === 'LESSON' && quizPoolNames.length > 0 && (
    quizPoolNames.length < 1 ||
    quizPoolNames.length > 20 ||
    minLessonPoolCount === 0 ||
    assessmentForm.questionCount < quizPoolNames.length ||
    assessmentForm.questionCount > maxLessonQuestionsAllowed
  );

  const expectedDistributionText = (() => {
    if (activeAssessmentMode !== 'LESSON' || quizPoolNames.length === 0 || minLessonPoolCount === 0) return null;
    const K = quizPoolNames.length;
    const Q = assessmentForm.questionCount;
    if (Q < K || Q > maxLessonQuestionsAllowed) return null;
    const B = Math.floor(Q / K);
    const R = Q % K;
    if (R === 0) {
      return `Phân phối dự kiến: ${Array(K).fill(B).join('–')} (chia đều mỗi nhóm ${B} câu)`;
    }
    const dist = [...Array(R).fill(B + 1), ...Array(K - R).fill(B)].join('–');
    return `Phân phối dự kiến: ${dist} (nhóm nhận câu dư được chọn ngẫu nhiên)`;
  })();

  const isPublished = course?.status === 'PUBLISHED';

    return {
    toast,
    setToast,
    course,
    isPublished,
    savingInfo,
    handleSaveInfo,
    hasUnsavedCourseInfo,
    publishLoading,
    handlePublish,
    setShowUnpublishConfirm,
    showUnpublishConfirm,
    handleUnpublish,
    loading,
    form,
    setForm,
    coverUploading,
    handleCoverUpload,
    openFinalAssessmentEditor,
    openAddSessionModal,
    handleMoveSession,
    openEditSessionModal,
    openAddLessonModal,
    handleDeleteSession,
    handleMoveLesson,
    openAssessmentEditorForLesson,
    openEditLessonModal,
    handleDirectUploadDoc,
    uploadingDocForLessonId,
    handleDeleteLesson,
    handleDeleteDocument,
    showSessionModal,
    setShowSessionModal,
    sessionModalMode,
    sessionForm,
    setSessionForm,
    sessionSaving,
    handleSaveSession,
    showLessonModal,
    closeLessonModal,
    editingLessonId,
    lessonForm,
    handleYtIdChange,
    durationFetchError,
    fetchingDuration,
    isVideoVerified,
    videoPreviewTitle,
    parseYouTubeId,
    durationWarning,
    setLessonForm,
    lessonSaving,
    handleSaveLesson,
    showAssessmentModal,
    closeAssessmentModal,
    activeAssessmentMode,
    activeLessonForAssessment,
    assessmentLoading,
    assessmentFormError,
    assessmentForm,
    setAssessmentForm,
    finalAvailableQuestions,
    quizPoolNames,
    lessonPoolCounts,
    maxLessonQuestionsAllowed,
    expectedDistributionText,
    minLessonPoolCount,
    handleAddPool,
    quizImportUrl,
    setQuizImportUrl,
    quizImporting,
    handleImportQuiz,
    quizImportErrors,
    setQuizPoolNames,
    handleAddQuestion,
    handleRemovePool,
    handleMoveQuestion,
    handleRemoveQuestion,
    handleQuestionTypeChange,
    handleRemoveOption,
    handleAddOption,
    handleDeleteAssessment,
    assessmentSaving,
    isLessonQuizInvalid,
    handleSaveAssessment
  };
}

export type CourseEditorState = ReturnType<typeof useCourseEditor>;
