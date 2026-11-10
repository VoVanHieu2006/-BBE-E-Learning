import type { CourseDraftContent, DraftLesson } from './course-draft'

/** Authoring-only projection; never used by learner/shared-cache endpoints. */
export function draftToEditorCourse(content: CourseDraftContent, course: any) {
  return { ...course, ...content, finalAssessment: content.finalAssessment, assessment: content.finalAssessment,
    sessions: content.sessions.map(s => ({ ...s, sessionId: s.id, lessons: s.lessons.map(l => ({ ...l, lessonId: l.id,
      documents: l.documents.map(d => ({ ...d, documentId: d.id })),
      assessment: l.assessment && { ...l.assessment, assessmentId: l.assessment.id, pools: (l.assessment.pools || []).map(p => ({ ...p, poolId: p.id })) },
    })) })),
  }
}

export function findDraftLesson(content: CourseDraftContent, lessonId: string): DraftLesson {
  const lesson = content.sessions.flatMap(s => s.lessons).find(l => l.id === lessonId)
  if (!lesson) throw new Error('Không tìm thấy bài học trong bản nháp. Hãy tải lại trang.')
  return lesson
}

export function draftQuestionBankSize(content: CourseDraftContent) {
  return content.sessions.reduce((total, s) => total + s.lessons.reduce((n, l) => n + (l.assessment?.questions.length || 0), 0), 0)
}
