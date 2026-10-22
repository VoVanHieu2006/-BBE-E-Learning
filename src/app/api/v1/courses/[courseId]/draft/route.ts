import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest, { params }: { params: { courseId: string } }) {
  const courseId = params.courseId
  if (!UUID_REGEX.test(courseId)) {
    return NextResponse.json({ error: { code: 'CourseNotFound', message: 'Khóa học không tồn tại' } }, { status: 404 })
  }

  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền truy cập bản thảo' } }, { status: 403 })
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      draft: true,
      sessions: {
        include: {
          lessons: {
            include: {
              video: true,
              documents: true,
              assessment: {
                include: {
                  questions: {
                    include: { options: true },
                    orderBy: { sort_order: 'asc' },
                  },
                },
              },
            },
            orderBy: { sort_order: 'asc' },
          },
        },
        orderBy: { sort_order: 'asc' },
      },
      final_assessment: {
        include: {
          questions: {
            include: { options: true },
            orderBy: { sort_order: 'asc' },
          },
        },
      },
    },
  })

  if (!course) {
    return NextResponse.json({ error: { code: 'CourseNotFound', message: 'Khóa học không tồn tại' } }, { status: 404 })
  }

  // If draft exists, return it
  if (course.draft) {
    return NextResponse.json({
      draft: {
        id: course.draft.id,
        courseId: course.draft.course_id,
        baseContentVersion: course.draft.base_content_version,
        draftVersion: course.draft.draft_version,
        content: course.draft.content,
        createdByUserId: course.draft.created_by_user_id,
        createdAt: course.draft.created_at,
        updatedAt: course.draft.updated_at,
      },
      course: {
        id: course.id,
        title: course.title,
        contentVersion: course.content_version,
        status: course.status,
      },
    }, { status: 200 })
  }

  // Construct initial draft content from current course structure
  const initialContent = {
    title: course.title,
    description: course.description,
    visibility: course.visibility,
    sessions: course.sessions.map((session) => ({
      id: session.id,
      title: session.title,
      description: session.description,
      sortOrder: session.sort_order,
      lessons: session.lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        description: lesson.description,
        sortOrder: lesson.sort_order,
        video: lesson.video ? {
          id: lesson.video.id,
          youtubeVideoId: lesson.video.youtube_video_id,
          durationSeconds: lesson.video.duration_seconds,
        } : null,
        documents: lesson.documents.map((doc) => ({
          id: doc.id,
          fileName: doc.file_name,
          fileSize: Number(doc.file_size),
          mimeType: doc.mime_type,
          storageKey: doc.storage_key,
        })),
        assessment: lesson.assessment ? {
          id: lesson.assessment.id,
          title: lesson.assessment.title,
          description: lesson.assessment.description,
          durationMinutes: lesson.assessment.duration_minutes,
          questionCount: lesson.assessment.question_count,
          questions: lesson.assessment.questions.map((q) => ({
            id: q.id,
            questionText: q.question_text,
            questionType: q.question_type,
            points: q.points,
            sortOrder: q.sort_order,
            options: q.options.map((o) => ({
              id: o.id,
              optionText: o.option_text,
              isCorrect: o.is_correct,
              sortOrder: o.sort_order,
            })),
          })),
        } : null,
      })),
    })),
    finalAssessment: course.final_assessment ? {
      id: course.final_assessment.id,
      title: course.final_assessment.title,
      description: course.final_assessment.description,
      durationMinutes: course.final_assessment.duration_minutes,
      questionCount: course.final_assessment.question_count,
      questions: course.final_assessment.questions.map((q) => ({
        id: q.id,
        questionText: q.question_text,
        questionType: q.question_type,
        points: q.points,
        sortOrder: q.sort_order,
        options: q.options.map((o) => ({
          id: o.id,
          optionText: o.option_text,
          isCorrect: o.is_correct,
          sortOrder: o.sort_order,
        })),
      })),
    } : null,
  }

  return NextResponse.json({
    draft: null,
    initialContent,
    course: {
      id: course.id,
      title: course.title,
      contentVersion: course.content_version,
      status: course.status,
    },
  }, { status: 200 })
}

export async function PUT(request: NextRequest, { params }: { params: { courseId: string } }) {
  const courseId = params.courseId
  if (!UUID_REGEX.test(courseId)) {
    return NextResponse.json({ error: { code: 'CourseNotFound', message: 'Khóa học không tồn tại' } }, { status: 404 })
  }

  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const userId = (auth as any).context!.userId
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền lưu bản thảo' } }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const { expectedDraftVersion, content } = body

  if (!content || typeof content !== 'object') {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'content là bắt buộc' } }, { status: 400 })
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, content_version: true },
  })
  if (!course) {
    return NextResponse.json({ error: { code: 'CourseNotFound', message: 'Khóa học không tồn tại' } }, { status: 404 })
  }

  const existingDraft = await prisma.courseDraft.findUnique({ where: { course_id: courseId } })

  if (!existingDraft) {
    // First time saving draft
    const created = await prisma.courseDraft.create({
      data: {
        course_id: courseId,
        base_content_version: course.content_version,
        draft_version: 1,
        content,
        created_by_user_id: userId,
      },
    })
    return NextResponse.json({
      draft: {
        id: created.id,
        courseId: created.course_id,
        baseContentVersion: created.base_content_version,
        draftVersion: created.draft_version,
        content: created.content,
      },
    }, { status: 200 })
  }

  // OCC check: expectedDraftVersion must match existingDraft.draft_version
  if (expectedDraftVersion !== undefined && expectedDraftVersion !== existingDraft.draft_version) {
    return NextResponse.json({
      error: {
        code: 'ConcurrencyConflict',
        message: 'Bản thảo đã bị thay đổi bởi phiên làm việc khác. Vui lòng tải lại trang trước khi lưu.',
      },
    }, { status: 409 })
  }

  const result = await prisma.courseDraft.updateMany({
    where: {
      course_id: courseId,
      draft_version: existingDraft.draft_version,
    },
    data: {
      content,
      draft_version: { increment: 1 },
    },
  })

  if (result.count === 0) {
    return NextResponse.json({
      error: {
        code: 'ConcurrencyConflict',
        message: 'Bản thảo đã bị thay đổi bởi phiên làm việc khác. Vui lòng tải lại trang trước khi lưu.',
      },
    }, { status: 409 })
  }

  const updated = await prisma.courseDraft.findUniqueOrThrow({ where: { course_id: courseId } })
  return NextResponse.json({
    draft: {
      id: updated.id,
      courseId: updated.course_id,
      baseContentVersion: updated.base_content_version,
      draftVersion: updated.draft_version,
      content: updated.content,
    },
  }, { status: 200 })
}
