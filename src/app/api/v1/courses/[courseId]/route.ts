import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getCourseDetailServerCache, setCourseDetailServerCache, invalidateCoursesServerCache } from '@/lib/server-cache'
import { LEARNING_PROGRAMS } from '@/lib/learning-catalog'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest, { params }: { params: { courseId: string } }) {
  const courseId = params.courseId
  if (!UUID_REGEX.test(courseId)) {
    return NextResponse.json({ error: { code: 'CourseNotFound', message: 'Khóa học không tồn tại' } }, { status: 404 })
  }

  // Fast-path guest check: skip authenticate if no auth header or cookies
  const hasAuthHeader = Boolean(request.headers.get('authorization'))
  const hasSessionCookie = Boolean(request.cookies.get('token') || request.cookies.get('session') || request.cookies.get('auth'))
  const auth = (hasAuthHeader || hasSessionCookie)
    ? await authenticate(request).catch(() => ({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Auth error' } }))
    : { ok: false, error: null }

  const isLeaderOrAdmin = auth.ok && ['ADMIN', 'CHAPTER_LEADER'].includes((auth as any).context?.role)

  // Serve from memory cache for non-admin viewers of public courses
  if (!isLeaderOrAdmin) {
    const cached = getCourseDetailServerCache(courseId, 30_000)
    if (cached) {
      return NextResponse.json(cached, {
        headers: {
          'Cache-Control': 'public, max-age=15, s-maxage=30, stale-while-revalidate=60',
        },
      })
    }
  }

  const courseDetail = await prisma.course.findUnique({
    where: { id: courseId },
    relationLoadStrategy: 'join',
    include: {
      program: {
        select: { id: true, code: true, name: true, is_core: true, sort_order: true },
      },
      final_assessment: {
        select: { id: true, title: true, description: true, question_count: true, duration_minutes: true, _count: { select: { questions: true } } },
      },
      sessions: {
        include: {
          lessons: {
            include: {
              video: { select: { id: true, youtube_video_id: true, duration_seconds: true } },
              documents: { select: { id: true, file_name: true, file_size: true, mime_type: true } },
              assessment: {
                select: { id: true, title: true, description: true, question_count: true, duration_minutes: true, _count: { select: { questions: true } } },
              },
            },
            orderBy: { sort_order: 'asc' },
          },
        },
        orderBy: { sort_order: 'asc' },
      },
    },
  })

  if (!courseDetail) {
    return NextResponse.json({ error: { code: 'CourseNotFound', message: 'Khóa học không tồn tại' } }, { status: 404 })
  }

  // Check Private visibility permission
  if (courseDetail.visibility === 'PRIVATE') {
    if (!auth.ok || ((auth as any).context!.role !== 'ADMIN' && (auth as any).context!.role !== 'CHAPTER_LEADER' && (auth as any).context!.role !== 'MEMBER')) {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'Khóa học Private — Vui lòng đăng nhập' } }, { status: 403 })
    }
  }
  
  if (courseDetail.status !== 'PUBLISHED' && (!auth.ok || (auth as any).context!.role !== 'ADMIN')) {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Khóa học chưa Published' } }, { status: 403 })
  }

  const payload = {
    courseId: courseDetail.id,
    id: courseDetail.id,
    title: courseDetail.title,
    description: courseDetail.description,
    status: courseDetail.status,
    visibility: courseDetail.visibility,
    publishedAt: courseDetail.published_at,
    coverUrl: courseDetail.cover_url,
    programId: courseDetail.program_id,
    programCode: courseDetail.program?.code || null,
    program: courseDetail.program ? {
      id: courseDetail.program.id,
      code: courseDetail.program.code,
      name: courseDetail.program.name,
      isCore: courseDetail.program.is_core,
      sortOrder: courseDetail.program.sort_order,
    } : null,
    assessment: courseDetail.final_assessment ? {
      assessmentId: courseDetail.final_assessment.id,
      id: courseDetail.final_assessment.id,
      assessmentType: 'COURSE_FINAL',
      title: courseDetail.final_assessment.title,
      description: courseDetail.final_assessment.description,
      questionCount: courseDetail.final_assessment.question_count,
      bankQuestionCount: courseDetail.final_assessment._count.questions,
      durationMinutes: courseDetail.final_assessment.duration_minutes,
    } : null,
    finalAssessment: courseDetail.final_assessment ? {
      assessmentId: courseDetail.final_assessment.id,
      id: courseDetail.final_assessment.id,
      assessmentType: 'COURSE_FINAL',
      title: courseDetail.final_assessment.title,
      description: courseDetail.final_assessment.description,
      questionCount: courseDetail.final_assessment.question_count,
      bankQuestionCount: courseDetail.final_assessment._count.questions,
      durationMinutes: courseDetail.final_assessment.duration_minutes,
    } : null,
    sessions: courseDetail.sessions.map((s) => ({
      sessionId: s.id,
      id: s.id,
      title: s.title,
      sortOrder: s.sort_order,
      lessons: s.lessons.map((l) => ({
        lessonId: l.id,
        id: l.id,
        title: l.title,
        description: l.description,
        sortOrder: l.sort_order,
        hasVideo: !!l.video,
        // Outline provides playable media preview for Admin and Chapter Leader.
        videoId: isLeaderOrAdmin ? l.video?.id || null : null,
        video: l.video ? {
          ...(isLeaderOrAdmin
            ? { videoId: l.video.id, youtubeVideoId: l.video.youtube_video_id }
            : {}),
          durationSeconds: l.video.duration_seconds,
        } : null,
        assessment: l.assessment ? {
          assessmentId: l.assessment.id,
          id: l.assessment.id,
          title: l.assessment.title,
          description: l.assessment.description,
          questionCount: l.assessment.question_count,
          bankQuestionCount: l.assessment._count.questions,
          durationMinutes: l.assessment.duration_minutes,
        } : null,
        documentCount: l.documents.length,
        documents: l.documents.map((d) => ({
          documentId: d.id,
          id: d.id,
          fileName: d.file_name,
          fileSize: Number(d.file_size),
          mimeType: d.mime_type,
        })),
      })),
    })),
  }

  // Populate server cache for public published courses when viewed by non-admin
  if (!isLeaderOrAdmin && courseDetail.visibility === 'PUBLIC' && courseDetail.status === 'PUBLISHED') {
    setCourseDetailServerCache(courseId, payload)
  }

  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': courseDetail.visibility === 'PUBLIC'
        ? 'public, max-age=15, s-maxage=30, stale-while-revalidate=60'
        : 'private, max-age=10, stale-while-revalidate=60',
    },
  })
}

export async function PATCH(request: NextRequest, { params }: { params: { courseId: string } }) {
  const courseId = params.courseId
  if (!UUID_REGEX.test(courseId)) {
    return NextResponse.json({ error: { code: 'CourseNotFound', message: 'Khóa học không tồn tại' } }, { status: 404 })
  }

  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền cập nhật khóa học' } }, { status: 403 })
  }

  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { status: true } })
  if (!course) return NextResponse.json({ error: { code: 'CourseNotFound', message: 'Khóa học không tồn tại' } }, { status: 404 })

  const body = await request.json()
  const { title, description, visibility, coverUrl, programCode, programId } = body

  // If course is published, prevent editing content title/description, but allow categorizing program and visibility
  if (course.status === 'PUBLISHED' && (title !== undefined || description !== undefined)) {
    return NextResponse.json(
      { error: { code: 'CoursePublished', message: 'Khóa học đang được công khai. Hãy Bỏ công khai trước rồi mới chỉnh sửa tiêu đề/mô tả.' } },
      { status: 409 }
    )
  }

  if (title !== undefined && (typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 255)) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'title phải từ 3-255 ký tự' } }, { status: 400 })
  }
  if (visibility !== undefined && !['PUBLIC', 'PRIVATE'].includes(visibility)) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'visibility phải là PUBLIC hoặc PRIVATE' } }, { status: 400 })
  }
  if (coverUrl !== undefined && coverUrl !== null && (typeof coverUrl !== 'string' || !/^https:\/\//.test(coverUrl))) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'coverUrl must be an HTTPS URL.' } }, { status: 400 })
  }

  let targetProgramId: string | null | undefined = undefined
  if (programCode !== undefined) {
    if (programCode === null || programCode === '') {
      targetProgramId = null
    } else {
      let prog = await prisma.learningProgram.findUnique({ where: { code: programCode } })
      if (!prog) {
        const catalogProg = LEARNING_PROGRAMS.find((p) => p.code === programCode)
        if (catalogProg) {
          prog = await prisma.learningProgram.upsert({
            where: { code: programCode },
            update: {},
            create: {
              code: catalogProg.code,
              name: catalogProg.name,
              is_core: catalogProg.is_core,
              sort_order: catalogProg.sort_order,
            },
          })
        }
      }
      if (!prog) {
        return NextResponse.json({ error: { code: 'ProgramNotFound', message: 'Chương trình học không tồn tại' } }, { status: 400 })
      }
      targetProgramId = prog.id
    }
  } else if (programId !== undefined) {
    targetProgramId = programId === '' ? null : programId
  }

  const updated = await prisma.course.update({
    where: { id: courseId },
    data: {
      ...(title !== undefined ? { title: title.trim() } : {}),
      ...(description !== undefined ? { description: description?.trim() || null } : {}),
      ...(visibility !== undefined ? { visibility } : {}),
      ...(coverUrl !== undefined ? { cover_url: coverUrl || null } : {}),
      ...(targetProgramId !== undefined ? { program_id: targetProgramId } : {}),
    },
    include: {
      program: {
        select: { id: true, code: true, name: true, is_core: true, sort_order: true },
      },
    },
  })

  invalidateCoursesServerCache()

  return NextResponse.json({
    courseId: updated.id,
    id: updated.id,
    title: updated.title,
    description: updated.description,
    status: updated.status,
    visibility: updated.visibility,
    publishedAt: updated.published_at,
    coverUrl: updated.cover_url,
    programId: updated.program_id,
    programCode: updated.program?.code || null,
    program: updated.program ? {
      id: updated.program.id,
      code: updated.program.code,
      name: updated.program.name,
      isCore: updated.program.is_core,
      sortOrder: updated.program.sort_order,
    } : null,
  }, { status: 200 })
}

export async function DELETE(request: NextRequest, { params }: { params: { courseId: string } }) {
  const courseId = params.courseId
  if (!UUID_REGEX.test(courseId)) {
    return NextResponse.json({ error: { code: 'CourseNotFound', message: 'Khóa học không tồn tại' } }, { status: 404 })
  }

  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền xóa khóa học' } }, { status: 403 })
  }

  const course = await prisma.course.findUnique({ where: { id: courseId } })
  if (!course) return NextResponse.json({ error: { code: 'CourseNotFound', message: 'Khóa học không tồn tại' } }, { status: 404 })

  await prisma.course.delete({ where: { id: courseId } })
  invalidateCoursesServerCache(courseId)

  return NextResponse.json({ success: true }, { status: 200 })
}
