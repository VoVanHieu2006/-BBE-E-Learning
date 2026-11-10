import { Prisma } from '@prisma/client'
import { lockCourseExamBank, assertFinalExamBankCapacity } from './final-exam-bank'
import { enqueueCourseStatusReconcile } from './course-status-outbox'

type Tx = Prisma.TransactionClient
export type DeleteScope = { courseId: string; sessionId?: string; lessonId?: string }
export class ContentDeleteError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Caller uses SERIALIZABLE. Writers without lesson FKs/shared locks can still
 * race after the checks; see persistLearningUnlocks and HANDOFF.md. */
export async function deleteUnusedContent(tx: Tx, scope: DeleteScope, actorId: string) {
  const { courseId, sessionId, lessonId } = scope
  await lockCourseExamBank(tx, courseId)
  const course = await tx.course.findUnique({ where: { id: courseId } })
  if (!course) throw new ContentDeleteError('CourseNotFound', 404, 'Khóa học không tồn tại.')
  if ((sessionId || lessonId) && course.status === 'PUBLISHED') {
    throw new ContentDeleteError('CoursePublished', 409, 'Khóa học đã xuất bản. Hãy sửa trong bản nháp thay đổi rồi cập nhật khóa học.')
  }
  const allLessons = await tx.lesson.findMany({ where: { session: { course_id: courseId } }, include: { video: true, assessment: true, documents: true } })
  const allLessonIds = allLessons.map(row => row.id)
  const allVideoIds = allLessons.flatMap(row => row.video ? [row.video.id] : [])
  const assessments = await tx.assessment.findMany({ where: { OR: [{ course_id: courseId }, { lesson_id: { in: allLessonIds } }] }, select: { id: true } })
  const assessmentIds = assessments.map(row => row.id)
  // Assignment alone is not evidence of learning; it still needs durable reconciliation below.
  const history = await Promise.all([
    tx.attempt.count({ where: { assessment_id: { in: assessmentIds } } }),
    tx.lessonProgress.count({ where: { lesson_id: { in: allLessonIds } } }),
    tx.cycleLessonProgress.count({ where: { lesson_id: { in: allLessonIds } } }),
    tx.monthlyVideoReplay.count({ where: { video_id: { in: allVideoIds } } }),
    tx.quizRewardHighWaterMark.count({ where: { assessment_id: { in: assessmentIds } } }),
    tx.supplementalLearningRequirement.count({ where: { course_id: courseId } }),
    tx.userLearningAssignment.count({ where: { course_id: courseId, OR: [{ status: { in: ['IN_PROGRESS', 'COMPLETED'] } }, { completed_at: { not: null } }] } }),
  ])
  if (history.some(count => count > 0)) throw new ContentDeleteError('CourseHasLearnerHistory', 409,
    'Khóa học đã có bài làm hoặc tiến độ học viên. Hãy hủy xuất bản để ngừng sử dụng và giữ lịch sử; không thể xóa.')

  const lessons = allLessons.filter(row => lessonId ? row.id === lessonId : sessionId ? row.session_id === sessionId : true)
  if (lessonId && !lessons.length) throw new ContentDeleteError('LessonNotFound', 404, 'Bài học không tồn tại.')
  if (sessionId && !await tx.session.findFirst({ where: { id: sessionId, course_id: courseId } })) throw new ContentDeleteError('SessionNotFound', 404, 'Buổi học không tồn tại.')
  const lessonIds = lessons.map(row => row.id)
  const videoIds = lessons.flatMap(row => row.video ? [row.video.id] : [])
  const removedAssessmentIds = sessionId || lessonId ? lessons.flatMap(row => row.assessment ? [row.assessment.id] : []) : assessmentIds
  await tx.cycleLessonProgress.deleteMany({ where: { lesson_id: { in: lessonIds } } })
  await tx.monthlyVideoReplay.deleteMany({ where: { video_id: { in: videoIds } } })
  await tx.quizRewardHighWaterMark.deleteMany({ where: { assessment_id: { in: removedAssessmentIds } } })
  await tx.courseRequirementVersion.deleteMany({ where: { course_id: courseId, ...(sessionId || lessonId ? { OR: [{ lesson_ids: { hasSome: lessonIds } }, { assessment_ids: { hasSome: removedAssessmentIds } }] } : {}) } })
  const now = new Date()
  if (!sessionId && !lessonId) {
    const rules = await tx.learningRule.findMany({ where: { course_id: courseId }, select: { id: true, effective_until: true } })
    await tx.supplementalLearningRequirement.deleteMany({ where: { course_id: courseId } })
    await tx.coursePublicationEvent.deleteMany({ where: { course_id: courseId } })
    await tx.learningRule.updateMany({ where: { course_id: courseId, OR: [{ effective_until: null }, { effective_until: { gt: now } }] }, data: { effective_until: now } })
    // Capture recipients BEFORE assignments cascade. learning_paths retain their prior budget,
    // so the normal outbox reconciler detects the removed course and clears/recalculates due_at.
    const reconcileRecipients = await enqueueCourseStatusReconcile(tx, courseId, 'DRAFT', now)
    await tx.auditLog.create({ data: { actor_user_id: actorId, action: 'DELETE_COURSE', entity_type: 'COURSE', entity_id: courseId, metadata: { title: course.title, rulesClosedAt: now.toISOString(), ruleIds: rules.map(rule => rule.id), reconcileRecipients } } })
    await tx.course.delete({ where: { id: courseId } })
  } else {
    if (lessonId) await tx.lesson.delete({ where: { id: lessonId } })
    else await tx.session.delete({ where: { id: sessionId! } })
    await assertFinalExamBankCapacity(tx, courseId)
    await tx.auditLog.create({ data: { actor_user_id: actorId, action: lessonId ? 'DELETE_LESSON' : 'DELETE_SESSION', entity_type: lessonId ? 'LESSON' : 'SESSION', entity_id: lessonId || sessionId!, metadata: { courseId } } })
  }
  return { storageKeys: lessons.flatMap(row => row.documents.map(doc => doc.storage_key)), coverPublicId: !sessionId && !lessonId ? course.cover_public_id : null }
}
