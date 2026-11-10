import { Prisma } from '@prisma/client'
import type { CourseDraftContent, DraftAssessment, DraftFinal, DraftQuestion } from './course-draft'

export const draftAssessmentInclude = { questions: { include: { options: { orderBy: { sort_order: 'asc' as const } }, _count: { select: { attempt_questions: true, attempt_answers: true } } }, orderBy: { sort_order: 'asc' as const } }, question_pools: { orderBy: { sort_order: 'asc' as const } }, _count: { select: { attempts: true } } } satisfies Prisma.AssessmentInclude
export const courseDraftInclude = {
  sessions: { include: { lessons: { include: { video: true, documents: true, assessment: { include: draftAssessmentInclude } }, orderBy: { sort_order: 'asc' as const } } }, orderBy: { sort_order: 'asc' as const } },
  final_assessment: { include: { final_exam_versions: { where: { is_active: true } }, _count: { select: { attempts: true } } } },
} satisfies Prisma.CourseInclude

export type DraftCourseRow = Prisma.CourseGetPayload<{ include: typeof courseDraftInclude }>
export type DraftAssessmentRow = Prisma.AssessmentGetPayload<{ include: typeof draftAssessmentInclude }>
export function questionSnapshot(q: DraftAssessmentRow['questions'][number]): DraftQuestion {
  return { id: q.id, questionText: q.question_text, questionType: q.question_type, points: q.points, sortOrder: q.sort_order, explanation: q.explanation, poolId: q.pool_id,
    options: q.options.map(o => ({ id: o.id, optionText: o.option_text, isCorrect: o.is_correct, sortOrder: o.sort_order })) }
}
export function finalSnapshot(a: { id: string; title: string; description: string | null; question_count: number; duration_minutes: number } | null): DraftFinal | null {
  return a && { id: a.id, title: a.title, description: a.description, questionCount: a.question_count, durationMinutes: a.duration_minutes }
}
export function assessmentSnapshot(a: DraftAssessmentRow | null): DraftAssessment | null {
  return a && { ...finalSnapshot(a)!, pools: a.question_pools.map(p => ({ id: p.id, name: p.name })), questions: a.questions.map(questionSnapshot) }
}
export function courseDraftSnapshot(c: DraftCourseRow): CourseDraftContent {
  return { title: c.title, description: c.description, visibility: c.visibility, coverUrl: c.cover_url, coverPublicId: c.cover_public_id,
    sessions: c.sessions.map(s => ({ id: s.id, title: s.title, description: s.description, sortOrder: s.sort_order,
      lessons: s.lessons.map(l => ({ id: l.id, title: l.title, description: l.description, sortOrder: l.sort_order,
        video: l.video && { youtubeVideoId: l.video.youtube_video_id, durationSeconds: l.video.duration_seconds },
        documents: l.documents.map(d => ({ id: d.id, fileName: d.file_name, fileSize: Number(d.file_size), mimeType: d.mime_type, storageKey: d.storage_key })),
        assessment: assessmentSnapshot(l.assessment),
      })),
    })), finalAssessment: finalSnapshot(c.final_assessment),
  }
}
