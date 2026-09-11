import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/v1/courses/{courseId}/assessment
 * Deprecated / Informational endpoint: Assessments are now per-lesson.
 * Returns assessments across all lessons in the course.
 */
export async function GET(request: NextRequest, { params }: { params: { courseId: string } }) {
  const auth = await authenticate(request).catch(() => ({ ok: false, error: { code: 'UNAUTHORIZED' } }))
  const courseId = params.courseId

  const lessonsWithAssessments = await prisma.lesson.findMany({
    where: { session: { course_id: courseId }, assessment: { isNot: null } },
    include: {
      assessment: {
        include: {
          questions: {
            include: { options: { orderBy: { sort_order: 'asc' } } },
            orderBy: { sort_order: 'asc' },
          },
        },
      },
    },
    orderBy: { sort_order: 'asc' },
  })

  if (lessonsWithAssessments.length === 0) {
    return NextResponse.json(
      { error: { code: 'AssessmentNotFound', message: 'Khóa học chưa có bài kiểm tra nào trong các bài học' } },
      { status: 404 }
    )
  }

  const role = (auth as any).context?.role
  const canSeeCorrect = auth.ok && (role === 'ADMIN' || role === 'CHAPTER_LEADER')

  return NextResponse.json({
    message: 'Bài kiểm tra hiện được quản lý theo từng bài học (Lesson Assessment).',
    courseId,
    assessments: lessonsWithAssessments.map((l) => ({
      lessonId: l.id,
      lessonTitle: l.title,
      assessment: l.assessment ? {
        id: l.assessment.id,
        assessmentId: l.assessment.id,
        title: l.assessment.title,
        description: l.assessment.description,
        questionCount: l.assessment.questions.length,
        questions: l.assessment.questions.map((q) => ({
          id: q.id,
          questionId: q.id,
          questionText: q.question_text,
          points: Number(q.points),
          durationSeconds: q.duration_seconds,
          ...(canSeeCorrect && q.explanation ? { explanation: q.explanation } : {}),
          options: q.options.map((o) => ({
            id: o.id,
            optionId: o.id,
            optionText: o.option_text,
            ...(canSeeCorrect ? { isCorrect: o.is_correct } : {}),
          })),
        })),
      } : null,
    })),
  })
}

/**
 * POST /api/v1/courses/{courseId}/assessment
 * Deprecated: Assessment is created per lesson via /api/v1/lessons/{lessonId}/assessment
 */
export async function POST() {
  return NextResponse.json(
    {
      error: {
        code: 'DeprecatedEndpoint',
        message: 'Endpoint này đã chuyển sang /api/v1/lessons/{lessonId}/assessment vì bài kiểm tra hiện được gắn trực tiếp vào từng bài học.',
      },
    },
    { status: 400 }
  )
}
