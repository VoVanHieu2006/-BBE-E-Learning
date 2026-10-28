import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

try {
  const exams = await prisma.assessment.findMany({
    where: { type: 'COURSE_FINAL' },
    select: {
      id: true,
      course_id: true,
      final_exam_versions: {
        select: { id: true, version_number: true, is_active: true, question_count: true, _count: { select: { questions: true } } },
      },
      attempts: {
        select: {
          id: true,
          final_exam_version_id: true,
          _count: { select: { attempt_questions: true } },
          attempt_questions: { select: { question: { select: { final_exam_version_id: true } } } },
        },
      },
    },
  })

  const issues = []
  for (const exam of exams) {
    const active = exam.final_exam_versions.filter((version) => version.is_active)
    if (active.length !== 1) issues.push({ courseId: exam.course_id, issue: 'active_version_count', count: active.length })
    for (const version of exam.final_exam_versions) {
      if (version._count.questions < version.question_count) issues.push({ courseId: exam.course_id, version: version.version_number, issue: 'bank_too_small', available: version._count.questions, requested: version.question_count })
    }
    for (const attempt of exam.attempts) {
      const version = exam.final_exam_versions.find((item) => item.id === attempt.final_exam_version_id)
      if (!version) issues.push({ courseId: exam.course_id, attemptId: attempt.id, issue: 'version_missing' })
      else if (attempt._count.attempt_questions !== version.question_count) issues.push({ courseId: exam.course_id, attemptId: attempt.id, issue: 'attempt_question_count', actual: attempt._count.attempt_questions, configured: version.question_count })
      if (attempt.attempt_questions.some(({ question }) => question.final_exam_version_id !== attempt.final_exam_version_id)) {
        issues.push({ courseId: exam.course_id, attemptId: attempt.id, issue: 'question_version_mismatch' })
      }
    }
  }
  console.log(JSON.stringify({ exams: exams.length, versions: exams.reduce((sum, exam) => sum + exam.final_exam_versions.length, 0), attempts: exams.reduce((sum, exam) => sum + exam.attempts.length, 0), issues }, null, 2))
  if (issues.length) process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
