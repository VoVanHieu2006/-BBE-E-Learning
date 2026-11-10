import { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import { FinalExamBankTooSmall, availableFinalQuestions, lessonQuestionWhere, lockCourseExamBank } from './final-exam-bank'

type Tx = Prisma.TransactionClient

export interface FinalExamConfig { title: string; description: string | null; questionCount: number; durationMinutes: number }

/**
 * Tạo phiên bản đề thi cuối khóa mới (bất biến) từ ngân hàng câu hỏi của các bài, giữ nguyên mọi attempt cũ
 * (điểm đạt cũ vẫn tính). Dùng chung cho `final-assessment` POST và `draft/publish`. Gọi trong transaction.
 * Ném `FinalExamBankTooSmall` / `InvalidFinalExamSourceQuestion` như route cũ.
 */
export async function createFinalExamVersion(tx: Tx, courseId: string, config: FinalExamConfig, createdBy: string) {
  await lockCourseExamBank(tx, courseId)
  const availableQuestions = await availableFinalQuestions(tx, courseId)
  if (config.questionCount > availableQuestions) throw new FinalExamBankTooSmall(config.questionCount, availableQuestions)
  const sourceQuestions = await tx.question.findMany({ where: lessonQuestionWhere(courseId), include: { options: true }, orderBy: { id: 'asc' } })
  if (sourceQuestions.some((question) => question.options.length < 2 || !question.options.some((option) => option.is_correct))) {
    throw new Error('InvalidFinalExamSourceQuestion')
  }
  const { title, description, questionCount, durationMinutes } = config
  const assessment = await tx.assessment.upsert({
    where: { course_id: courseId },
    update: { title, description, question_count: questionCount, duration_minutes: durationMinutes },
    create: { type: 'COURSE_FINAL', course_id: courseId, lesson_id: null, title, description, question_count: questionCount, duration_minutes: durationMinutes, created_by: createdBy },
  })
  const latest = await tx.finalExamVersion.findFirst({ where: { assessment_id: assessment.id }, orderBy: { version_number: 'desc' }, select: { version_number: true } })
  await tx.finalExamVersion.updateMany({ where: { assessment_id: assessment.id, is_active: true }, data: { is_active: false } })
  const version = await tx.finalExamVersion.create({ data: {
    assessment_id: assessment.id, version_number: (latest?.version_number || 0) + 1, is_active: true,
    question_count: questionCount, duration_minutes: durationMinutes, title, description,
  } })
  const copies = sourceQuestions.map((source) => ({ source, id: randomUUID() }))
  await tx.question.createMany({ data: copies.map(({ source, id }) => ({
    id, assessment_id: assessment.id, final_exam_version_id: version.id, source_assessment_id: source.assessment_id,
    question_text: source.question_text, question_type: source.question_type, points: source.points,
    sort_order: source.sort_order, explanation: source.explanation,
  })) })
  await tx.questionOption.createMany({ data: copies.flatMap(({ source, id }) => source.options.map((option) => ({
    id: randomUUID(), question_id: id, option_text: option.option_text, is_correct: option.is_correct, sort_order: option.sort_order,
  }))) })
  return { assessment, version, availableQuestions }
}
