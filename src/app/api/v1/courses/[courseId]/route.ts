import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest, { params }: { params: { courseId: string } }) {
  const courseId = params.courseId
  if (!UUID_REGEX.test(courseId)) {
    return NextResponse.json({ error: { code: 'CourseNotFound', message: 'Khóa học không tồn tại' } }, { status: 404 })
  }

  const auth = await authenticate(request).catch(() => ({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Auth error' } }))

  const courseDetail = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      sessions: {
        include: {
          lessons: {
            include: {
              video: { select: { id: true, youtube_video_id: true, duration_seconds: true } },
              documents: { select: { id: true, file_name: true, file_size: true, mime_type: true } },
              assessment: {
                select: { id: true, title: true, description: true, _count: { select: { questions: true } } },
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

  return NextResponse.json({
    courseId: courseDetail.id,
    id: courseDetail.id,
    title: courseDetail.title,
    description: courseDetail.description,
    status: courseDetail.status,
    visibility: courseDetail.visibility,
    publishedAt: courseDetail.published_at,
    assessment: null,
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
        videoId: l.video?.id || null,
        video: l.video ? {
          videoId: l.video.id,
          youtubeVideoId: l.video.youtube_video_id,
          durationSeconds: l.video.duration_seconds,
        } : null,
        assessment: l.assessment ? {
          assessmentId: l.assessment.id,
          id: l.assessment.id,
          title: l.assessment.title,
          description: l.assessment.description,
          questionCount: l.assessment._count.questions,
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
  }, {
    headers: {
      'Cache-Control': 'private, max-age=10, stale-while-revalidate=60',
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

  if (course.status === 'PUBLISHED') {
    return NextResponse.json(
      { error: { code: 'CoursePublished', message: 'Khóa học đang được công khai. Hãy Bỏ công khai trước rồi mới chỉnh sửa.' } },
      { status: 409 }
    )
  }

  const body = await request.json()
  const { title, description, visibility } = body

  if (title !== undefined && (typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 255)) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'title phải từ 3-255 ký tự' } }, { status: 400 })
  }
  if (visibility !== undefined && !['PUBLIC', 'PRIVATE'].includes(visibility)) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'visibility phải là PUBLIC hoặc PRIVATE' } }, { status: 400 })
  }

  const updated = await prisma.course.update({
    where: { id: courseId },
    data: {
      ...(title !== undefined ? { title: title.trim() } : {}),
      ...(description !== undefined ? { description: description?.trim() || null } : {}),
      ...(visibility !== undefined ? { visibility } : {}),
    },
  })

  return NextResponse.json({
    courseId: updated.id,
    id: updated.id,
    title: updated.title,
    description: updated.description,
    status: updated.status,
    visibility: updated.visibility,
    publishedAt: updated.published_at,
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

  return NextResponse.json({ success: true }, { status: 200 })
}
