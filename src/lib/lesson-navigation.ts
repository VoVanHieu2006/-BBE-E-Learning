// Where the learner should go after finishing a lesson (e.g. from the quiz result).
// Order follows the course outline: session order, then lesson order inside a session.

export type NextLearningTarget = {
  kind: 'lesson' | 'final-quiz' | 'course';
  href: string;
  label: string;
};

type OutlineLesson = { lessonId?: string; id?: string };
type OutlineSession = { lessons?: OutlineLesson[] | null };
export type CourseOutline = {
  sessions?: OutlineSession[] | null;
  assessment?: unknown;
  finalAssessment?: unknown;
} | null | undefined;

export function getNextLearningTarget(
  course: CourseOutline,
  courseId: string,
  currentLessonId: string,
): NextLearningTarget | null {
  if (!course || !courseId || !currentLessonId) return null;

  const lessonIds: string[] = [];
  for (const session of course.sessions || []) {
    for (const lesson of session.lessons || []) {
      const id = lesson.lessonId || lesson.id;
      if (id) lessonIds.push(id);
    }
  }

  const index = lessonIds.indexOf(currentLessonId);
  if (index < 0) return null;

  const nextId = lessonIds[index + 1];
  if (nextId) {
    return { kind: 'lesson', href: `/student/learning/${nextId}`, label: 'Bài tiếp theo' };
  }

  // Last lesson: go to the final exam when the course has one, otherwise to the course page.
  if (course.assessment || course.finalAssessment) {
    return { kind: 'final-quiz', href: `/student/courses/${courseId}/quiz`, label: 'Làm bài thi cuối khóa' };
  }
  return { kind: 'course', href: `/student/courses/${courseId}`, label: 'Hoàn tất khóa học' };
}
