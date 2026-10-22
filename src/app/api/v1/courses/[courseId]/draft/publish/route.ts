import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { invalidateSystemDataCache } from '@/lib/progress/calculator'
import { invalidateCoursesServerCache } from '@/lib/server-cache'
import { executePublishCourseRequirements } from '@/lib/course-requirements'
import { lockLearningUser, lockCompetitionScope } from '@/lib/learning-periods'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest, { params }: { params: { courseId: string } }) {
  const courseId = params.courseId
  if (!UUID_REGEX.test(courseId)) {
    return NextResponse.json({ error: { code: 'CourseNotFound', message: 'Khóa học không tồn tại' } }, { status: 404 })
  }

  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền công bố khóa học' } }, { status: 403 })
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // 1. Advisory Lock
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('learning-catalog-configuration'))::text`

      // 2. Lock course
      await tx.$queryRaw`SELECT id FROM courses WHERE id = ${courseId}::uuid FOR UPDATE`
      const course = await tx.course.findUniqueOrThrow({ where: { id: courseId } })

      // 3. Lock learning users with mandatory assignments
      const assignments = await tx.userLearningAssignment.findMany({
        where: { course_id: courseId, ended_at: null, mandatory: true },
        orderBy: { user_id: 'asc' },
      })
      for (const userId of Array.from(new Set(assignments.map((row) => row.user_id)))) {
        await lockLearningUser(tx, userId)
      }

      // 4. Find draft and verify base version
      const draft = await tx.courseDraft.findUnique({ where: { course_id: courseId } })
      if (!draft) {
        throw new Error('DraftNotFound')
      }
      if (course.content_version !== draft.base_content_version) {
        throw new Error('BaseVersionMismatch')
      }

      const content = draft.content as any
      if (!content) {
        throw new Error('InvalidDraftContent')
      }

      // Update course metadata if provided in draft
      await tx.course.update({
        where: { id: courseId },
        data: {
          ...(content.title ? { title: content.title.trim() } : {}),
          ...(content.description !== undefined ? { description: content.description } : {}),
          ...(content.visibility ? { visibility: content.visibility } : {}),
        },
      })

      // 5. Apply sessions and lessons
      if (Array.isArray(content.sessions)) {
        for (let sIdx = 0; sIdx < content.sessions.length; sIdx++) {
          const s = content.sessions[sIdx]
          let sessionRecord: { id: string }
          if (s.id && UUID_REGEX.test(s.id)) {
            const existingSession = await tx.session.findFirst({ where: { id: s.id, course_id: courseId } })
            if (existingSession) {
              sessionRecord = await tx.session.update({
                where: { id: s.id },
                data: {
                  title: s.title || existingSession.title,
                  description: s.description !== undefined ? s.description : existingSession.description,
                  sort_order: s.sortOrder ?? sIdx + 1,
                },
              })
            } else {
              sessionRecord = await tx.session.create({
                data: {
                  course_id: courseId,
                  title: s.title || `Session ${sIdx + 1}`,
                  description: s.description || null,
                  sort_order: s.sortOrder ?? sIdx + 1,
                },
              })
            }
          } else {
            sessionRecord = await tx.session.create({
              data: {
                course_id: courseId,
                title: s.title || `Session ${sIdx + 1}`,
                description: s.description || null,
                sort_order: s.sortOrder ?? sIdx + 1,
              },
            })
          }

          // Apply lessons
          if (Array.isArray(s.lessons)) {
            for (let lIdx = 0; lIdx < s.lessons.length; lIdx++) {
              const l = s.lessons[lIdx]
              let lessonRecord: { id: string }
              if (l.id && UUID_REGEX.test(l.id)) {
                const existingLesson = await tx.lesson.findFirst({ where: { id: l.id, session_id: sessionRecord.id } })
                if (existingLesson) {
                  lessonRecord = await tx.lesson.update({
                    where: { id: l.id },
                    data: {
                      title: l.title || existingLesson.title,
                      description: l.description !== undefined ? l.description : existingLesson.description,
                      sort_order: l.sortOrder ?? lIdx + 1,
                    },
                  })
                } else {
                  lessonRecord = await tx.lesson.create({
                    data: {
                      session_id: sessionRecord.id,
                      title: l.title || `Lesson ${lIdx + 1}`,
                      description: l.description || null,
                      sort_order: l.sortOrder ?? lIdx + 1,
                    },
                  })
                }
              } else {
                lessonRecord = await tx.lesson.create({
                  data: {
                    session_id: sessionRecord.id,
                    title: l.title || `Lesson ${lIdx + 1}`,
                    description: l.description || null,
                    sort_order: l.sortOrder ?? lIdx + 1,
                  },
                })
              }

              // Apply video
              if (l.video && l.video.youtubeVideoId) {
                await tx.video.upsert({
                  where: { lesson_id: lessonRecord.id },
                  update: {
                    youtube_video_id: l.video.youtubeVideoId,
                    duration_seconds: l.video.durationSeconds ?? 0,
                  },
                  create: {
                    lesson_id: lessonRecord.id,
                    youtube_video_id: l.video.youtubeVideoId,
                    duration_seconds: l.video.durationSeconds ?? 0,
                  },
                })
              }

              // Apply assessment & non-destructive questions
              if (l.assessment) {
                let assessmentRecord: { id: string }
                const existingAssessment = await tx.assessment.findFirst({ where: { lesson_id: lessonRecord.id } })
                if (existingAssessment) {
                  assessmentRecord = await tx.assessment.update({
                    where: { id: existingAssessment.id },
                    data: {
                      title: l.assessment.title || existingAssessment.title,
                      description: l.assessment.description !== undefined ? l.assessment.description : existingAssessment.description,
                      duration_minutes: l.assessment.durationMinutes ?? existingAssessment.duration_minutes,
                      question_count: l.assessment.questionCount ?? existingAssessment.question_count,
                    },
                  })
                } else {
                  assessmentRecord = await tx.assessment.create({
                    data: {
                      lesson_id: lessonRecord.id,
                      type: 'LESSON',
                      title: l.assessment.title || `${l.title} Quiz`,
                      description: l.assessment.description || null,
                      duration_minutes: l.assessment.durationMinutes ?? 15,
                      question_count: l.assessment.questionCount ?? 10,
                      created_by: auth.context!.userId,
                    },
                  })
                }

                // Questions with non-destructive versioning
                if (Array.isArray(l.assessment.questions)) {
                  for (let qIdx = 0; qIdx < l.assessment.questions.length; qIdx++) {
                    const q = l.assessment.questions[qIdx]
                    let canUpdateInPlace = false
                    if (q.id && UUID_REGEX.test(q.id)) {
                      const attemptRef = await tx.attemptQuestion.count({ where: { question_id: q.id } })
                      if (attemptRef === 0) {
                        canUpdateInPlace = true
                      }
                    }

                    if (canUpdateInPlace && q.id) {
                      await tx.question.update({
                        where: { id: q.id },
                        data: {
                          question_text: q.questionText,
                          question_type: q.questionType || 'SINGLE_CHOICE',
                          points: q.points ?? 1,
                          sort_order: q.sortOrder ?? qIdx + 1,
                        },
                      })
                      if (Array.isArray(q.options)) {
                        for (let oIdx = 0; oIdx < q.options.length; oIdx++) {
                          const o = q.options[oIdx]
                          if (o.id && UUID_REGEX.test(o.id)) {
                            await tx.questionOption.updateMany({
                              where: { id: o.id, question_id: q.id },
                              data: {
                                option_text: o.optionText,
                                is_correct: Boolean(o.isCorrect),
                                sort_order: o.sortOrder ?? oIdx + 1,
                              },
                            })
                          } else {
                            await tx.questionOption.create({
                              data: {
                                question_id: q.id,
                                option_text: o.optionText,
                                is_correct: Boolean(o.isCorrect),
                                sort_order: o.sortOrder ?? oIdx + 1,
                              },
                            })
                          }
                        }
                      }
                    } else {
                      // Non-destructive: Create new question to preserve existing attempts
                      const createdQ = await tx.question.create({
                        data: {
                          assessment_id: assessmentRecord.id,
                          question_text: q.questionText,
                          question_type: q.questionType || 'SINGLE_CHOICE',
                          points: q.points ?? 1,
                          sort_order: q.sortOrder ?? qIdx + 1,
                        },
                      })
                      if (Array.isArray(q.options)) {
                        for (let oIdx = 0; oIdx < q.options.length; oIdx++) {
                          const o = q.options[oIdx]
                          await tx.questionOption.create({
                            data: {
                              question_id: createdQ.id,
                              option_text: o.optionText,
                              is_correct: Boolean(o.isCorrect),
                              sort_order: o.sortOrder ?? oIdx + 1,
                            },
                          })
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }

      // 6. Execute atomic publish requirements (increments content_version once, extends deadlines)
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
      const scope = await lockCompetitionScope(tx, clock.now)
      const now = scope?.now || clock.now
      const publishedCourse = await executePublishCourseRequirements(tx, courseId, now)

      // 7. Delete draft
      await tx.courseDraft.delete({ where: { course_id: courseId } })

      return publishedCourse
    }, { timeout: 60_000 })

    invalidateSystemDataCache()
    invalidateCoursesServerCache()

    return NextResponse.json({
      courseId: updated.id,
      status: updated.status,
      publishedAt: updated.published_at,
    }, { status: 200 })
  } catch (error: any) {
    if (error?.message === 'DraftNotFound') {
      return NextResponse.json({ error: { code: 'DraftNotFound', message: 'Không tìm thấy bản thảo của khóa học' } }, { status: 404 })
    }
    if (error?.message === 'BaseVersionMismatch') {
      return NextResponse.json({
        error: {
          code: 'BaseVersionMismatch',
          message: 'Khóa học đã có thay đổi mới kể từ khi bản thảo được tạo. Vui lòng làm mới bản thảo.',
        },
      }, { status: 409 })
    }
    if (error?.message === 'PublishedCourseProgramRequired') {
      return NextResponse.json({
        error: {
          code: 'PublishedCourseProgramRequired',
          message: 'Hãy phân loại chương trình trước khi publish.',
        },
      }, { status: 409 })
    }
    console.error('Draft publish error:', error)
    return NextResponse.json({ error: { code: 'PublishFailed', message: error?.message || 'Công bố thất bại' } }, { status: 500 })
  }
}
