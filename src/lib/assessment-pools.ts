import type { Prisma } from '@prisma/client'
import { lockCourseExamBank } from './final-exam-bank'
import { selectQuizQuestions, validateQuizPoolAssignments, QuizPoolAssignment } from './quiz-pool-selection'

export class PoolUpdateError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); Object.setPrototypeOf(this, new.target.prototype) }
}
export async function updateLessonPools(tx: Prisma.TransactionClient, assessmentId: string, pools: { name: string }[], assignments: QuizPoolAssignment[]) {
  const initial = await tx.assessment.findUnique({ where: { id: assessmentId }, select: { lesson: { select: { session: { select: { course_id: true } } } } } })
  if (!initial) throw new PoolUpdateError('AssessmentNotFound', 404, 'Bài kiểm tra không tồn tại.')
  const courseId = initial.lesson?.session.course_id
  if (!courseId) throw new PoolUpdateError('UseFinalExamEditor', 409, 'Hãy cập nhật bài thi cuối khóa bằng phiên bản mới.')
  await lockCourseExamBank(tx, courseId)
  const assessment = await tx.assessment.findUnique({ where: { id: assessmentId }, select: { type: true, question_count: true } })
  if (!assessment) throw new PoolUpdateError('AssessmentNotFound', 404, 'Bài kiểm tra không tồn tại.')
  if (assessment.type === 'COURSE_FINAL') throw new PoolUpdateError('UseFinalExamEditor', 409, 'Hãy cập nhật bài thi cuối khóa bằng phiên bản mới.')
  const course = await tx.course.findUnique({ where: { id: courseId }, select: { status: true } })
  if (course?.status === 'PUBLISHED') throw new PoolUpdateError('CoursePublished', 409, 'Khóa học đã xuất bản. Hãy sửa trong bản nháp thay đổi.')
  if (await tx.attempt.count({ where: { assessment_id: assessmentId } })) throw new PoolUpdateError('AssessmentVersionRequired', 409, 'Quiz đã có lượt làm; cần phiên bản mới để giữ lịch sử.')
  const questions = await tx.question.findMany({ where: { assessment_id: assessmentId }, select: { id: true } })
  const mapping = validateQuizPoolAssignments(pools.length, questions.map(row => row.id), assignments)
  if (mapping.ok === false) throw new PoolUpdateError(mapping.code, 400, 'Mỗi câu hỏi phải thuộc đúng một nhóm; mỗi nhóm cần có câu hỏi.')
  const selection = selectQuizQuestions(pools.map((_, i) => ({ id: String(i) })), questions.map(row => ({ poolId: String(mapping.poolIndexByQuestionId[row.id]) })), rows => [...rows], assessment.question_count)
  if (selection.ok === false) throw new PoolUpdateError(selection.code, 400, 'Số câu phải nằm giữa số nhóm và số nhóm nhân cỡ nhóm nhỏ nhất.')
  await tx.question.updateMany({ where: { assessment_id: assessmentId }, data: { pool_id: null } })
  await tx.questionPool.deleteMany({ where: { assessment_id: assessmentId } })
  await tx.questionPool.createMany({ data: pools.map((pool, index) => ({ assessment_id: assessmentId, name: pool.name.trim(), sort_order: index })) })
  const created = await tx.questionPool.findMany({ where: { assessment_id: assessmentId }, orderBy: { sort_order: 'asc' } })
  for (let i = 0; i < created.length; i++) {
    const ids = questions.filter(row => mapping.poolIndexByQuestionId[row.id] === i).map(row => row.id)
    await tx.question.updateMany({ where: { assessment_id: assessmentId, id: { in: ids } }, data: { pool_id: created[i].id } })
  }
  return created
}
