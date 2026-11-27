import { Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

export class FinalExamBankTooSmall extends Error {
  /** `scheduled`: the shortfall is against next month's scheduled count, not the count active this month. */
  constructor(public readonly requested: number, public readonly available: number, public readonly scheduled = false) {
    super(scheduled
      ? `Lịch tháng sau đang hẹn bài thi cuối khóa ${requested} câu mỗi lượt, nhưng ngân hàng câu hỏi của các bài sau thay đổi chỉ còn ${available} câu. Hãy bổ sung câu hỏi vào ngân hàng, hoặc giảm/hủy số câu hẹn tháng sau xuống không quá ${available} câu.`
      : `Bài thi cuối khóa cần ${requested} câu, nhưng sau thay đổi chỉ còn ${available} câu. Hãy giảm số câu bài cuối khóa hoặc bổ sung câu hỏi trước.`)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Every writer of lesson questions and final-exam configuration locks this row first. */
export async function lockCourseExamBank(tx: Tx, courseId: string) {
  await tx.$queryRaw`SELECT id FROM courses WHERE id = ${courseId}::uuid FOR UPDATE`
}

/** Active (non-archived) lesson questions: the only source for final-exam capacity and new versions. */
export function lessonQuestionWhere(courseId: string): Prisma.QuestionWhereInput {
  return { archived_at: null, assessment: { type: 'LESSON', lesson: { session: { course_id: courseId } } } }
}

export async function availableFinalQuestions(tx: Tx, courseId: string) {
  return tx.question.count({ where: lessonQuestionWhere(courseId) })
}

export async function assertFinalExamBankCapacity(tx: Tx, courseId: string) {
  const final = await tx.assessment.findUnique({ where: { course_id: courseId }, select: { question_count: true, scheduled_question_count: true } })
  if (!final) return
  const available = await availableFinalQuestions(tx, courseId)
  if (available < final.question_count) throw new FinalExamBankTooSmall(final.question_count, available)
  const scheduled = final.scheduled_question_count ?? 0
  if (available < scheduled) throw new FinalExamBankTooSmall(scheduled, available, true)
}

export function finalExamBankError(error: unknown) {
  return error instanceof FinalExamBankTooSmall
    ? { error: { code: 'FinalExamBankTooSmall', message: error.message, requested: error.requested, available: error.available, scheduled: error.scheduled } }
    : null
}
