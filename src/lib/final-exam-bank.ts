import { Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

export class FinalExamBankTooSmall extends Error {
  constructor(public readonly requested: number, public readonly available: number) {
    super(`Bài thi cuối khóa cần ${requested} câu, nhưng sau thay đổi chỉ còn ${available} câu. Hãy giảm số câu bài cuối khóa hoặc bổ sung câu hỏi trước.`)
  }
}

/** Every writer of lesson questions and final-exam configuration locks this row first. */
export async function lockCourseExamBank(tx: Tx, courseId: string) {
  await tx.$queryRaw`SELECT id FROM courses WHERE id = ${courseId}::uuid FOR UPDATE`
}

export function lessonQuestionWhere(courseId: string): Prisma.QuestionWhereInput {
  return { assessment: { type: 'LESSON', lesson: { session: { course_id: courseId } } } }
}

export async function availableFinalQuestions(tx: Tx, courseId: string) {
  return tx.question.count({ where: lessonQuestionWhere(courseId) })
}

export async function assertFinalExamBankCapacity(tx: Tx, courseId: string) {
  const final = await tx.assessment.findUnique({ where: { course_id: courseId }, select: { question_count: true } })
  if (!final) return
  const available = await availableFinalQuestions(tx, courseId)
  if (available < final.question_count) throw new FinalExamBankTooSmall(final.question_count, available)
}

export function finalExamBankError(error: unknown) {
  return error instanceof FinalExamBankTooSmall
    ? { error: { code: 'FinalExamBankTooSmall', message: error.message, requested: error.requested, available: error.available } }
    : null
}
