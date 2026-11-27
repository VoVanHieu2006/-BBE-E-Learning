import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DRAFT_UUID } from '@/lib/course-draft'
import { applyDueAssessmentSchedules, assessmentScheduleMeta, currentMonthLockedAssessmentIds, scheduledConfigOf } from '@/lib/assessment-schedule'

const jsonError = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status })
const scheduleFields = { question_count: true, duration_minutes: true, scheduled_question_count: true, scheduled_duration_minutes: true, scheduled_effective_at: true, scheduled_effective_month_key: true } as const

/** GET /api/v1/courses/{courseId}/questions: the whole active lesson-quiz bank of a course, for Admin search/editing. */
export async function GET(request: NextRequest, { params }: { params: { courseId: string } }) {
  if (!DRAFT_UUID.test(params.courseId)) return jsonError('CourseNotFound', 'Khóa học không tồn tại.', 404)
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context!.role !== 'ADMIN') return jsonError('AccessDenied', 'Chỉ Admin được xem ngân hàng câu hỏi.', 403)

  const now = new Date()
  await applyDueAssessmentSchedules(prisma, { courseId: params.courseId, now })
  const course = await prisma.course.findUnique({
    where: { id: params.courseId },
    select: {
      id: true, title: true, status: true,
      final_assessment: { select: { id: true, title: true, ...scheduleFields } },
      sessions: {
        orderBy: { sort_order: 'asc' },
        select: {
          id: true, title: true, sort_order: true,
          lessons: {
            orderBy: { sort_order: 'asc' },
            select: {
              id: true, title: true, sort_order: true,
              assessment: {
                select: {
                  id: true, title: true, ...scheduleFields,
                  question_pools: { orderBy: { sort_order: 'asc' }, select: { id: true, name: true, sort_order: true } },
                  questions: {
                    where: { archived_at: null }, orderBy: { sort_order: 'asc' },
                    select: { id: true, question_text: true, question_type: true, points: true, sort_order: true, pool_id: true, explanation: true,
                      options: { orderBy: { sort_order: 'asc' }, select: { id: true, option_text: true, is_correct: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  if (!course) return jsonError('CourseNotFound', 'Khóa học không tồn tại.', 404)
  const assessmentIds = [...course.sessions.flatMap(s => s.lessons.flatMap(l => l.assessment ? [l.assessment.id] : [])), ...(course.final_assessment ? [course.final_assessment.id] : [])]
  const locked = await currentMonthLockedAssessmentIds(prisma, assessmentIds, now)

  return NextResponse.json({
    courseId: course.id, courseTitle: course.title, status: course.status,
    sessions: course.sessions.map(s => ({
      sessionId: s.id, title: s.title, sortOrder: s.sort_order,
      lessons: s.lessons.map(l => ({
        lessonId: l.id, title: l.title, sortOrder: l.sort_order,
        assessment: l.assessment && {
          assessmentId: l.assessment.id, title: l.assessment.title,
          questionCount: l.assessment.question_count, durationMinutes: l.assessment.duration_minutes,
          hasCurrentMonthAttempts: locked.has(l.assessment.id), scheduledConfig: scheduledConfigOf(l.assessment),
          pools: l.assessment.question_pools.map(p => ({ poolId: p.id, name: p.name, sortOrder: p.sort_order })),
          questions: l.assessment.questions.map(q => ({
            questionId: q.id, id: q.id, questionText: q.question_text, type: q.question_type, points: q.points,
            sortOrder: q.sort_order, poolId: q.pool_id, explanation: q.explanation || '',
            options: q.options.map(o => ({ optionId: o.id, id: o.id, optionText: o.option_text, isCorrect: o.is_correct })),
          })),
        },
      })),
    })),
    finalAssessment: course.final_assessment && { title: course.final_assessment.title, ...assessmentScheduleMeta(course.final_assessment, locked) },
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}
