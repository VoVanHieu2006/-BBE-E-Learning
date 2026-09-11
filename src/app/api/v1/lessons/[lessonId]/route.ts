import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: { lessonId: string } }) {
  const auth = await authenticate(request).catch(() => ({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Auth error' } }))
  const lessonId = params.lessonId

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      session: {
        include: {
          course: {
            select: { id: true, title: true, status: true, visibility: true },
          },
        },
      },
      video: true,
      assessment: {
        select: { id: true, title: true, description: true, _count: { select: { questions: true } } },
      },
      documents: {
        select: { id: true, file_name: true, file_size: true, mime_type: true, created_at: true },
        orderBy: { created_at: 'asc' },
      },
    },
  })

  if (!lesson) {
    return NextResponse.json({ error: { code: 'LessonNotFound', message: 'Bài học không tồn tại' } }, { status: 404 })
  }

  const course = lesson.session.course

  // Check visibility & status access
  if (course.visibility === 'PRIVATE') {
    if (!auth.ok || ((auth as any).context!.role !== 'ADMIN' && (auth as any).context!.role !== 'CHAPTER_LEADER' && (auth as any).context!.role !== 'MEMBER')) {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'Khóa học Private' } }, { status: 403 })
    }
    if (auth.ok) {
      const user = await prisma.user.findUnique({ where: { id: (auth as any).context!.userId } })
      if (!user || user.status !== 'ACTIVE') {
        return NextResponse.json({ error: { code: 'AccessDenied', message: 'Tài khoản phải Active' } }, { status: 403 })
      }
    }
  }

  if (course.status !== 'PUBLISHED' && (!auth.ok || (auth as any).context!.role !== 'ADMIN')) {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Khóa học chưa Published' } }, { status: 403 })
  }

  return NextResponse.json({
    lessonId: lesson.id,
    id: lesson.id,
    sessionId: lesson.session_id,
    title: lesson.title,
    description: lesson.description,
    sortOrder: lesson.sort_order,
    session: {
      sessionId: lesson.session.id,
      title: lesson.session.title,
      courseId: lesson.session.course.id,
      courseTitle: lesson.session.course.title,
    },
    video: lesson.video ? {
      videoId: lesson.video.id,
      id: lesson.video.id,
      youtubeVideoId: lesson.video.youtube_video_id,
      durationSeconds: lesson.video.duration_seconds,
      title: lesson.video.title,
    } : null,
    assessment: lesson.assessment ? {
      assessmentId: lesson.assessment.id,
      id: lesson.assessment.id,
      title: lesson.assessment.title,
      description: lesson.assessment.description,
      questionCount: lesson.assessment._count.questions,
    } : null,
    documents: lesson.documents.map((d) => ({
      documentId: d.id,
      id: d.id,
      fileName: d.file_name,
      fileSize: Number(d.file_size),
      mimeType: d.mime_type,
    })),
  }, { status: 200 })
}

export async function PATCH(request: NextRequest, { params }: { params: { lessonId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền cập nhật bài học' } }, { status: 403 })
  }

  const lessonId = params.lessonId
  const body = await request.json().catch(() => ({}))

  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, include: { video: true } })
  if (!lesson) return NextResponse.json({ error: { code: 'LessonNotFound', message: 'Bài học không tồn tại' } }, { status: 404 })

  const updates: any = {}
  if (body.title !== undefined) updates.title = body.title.trim()
  if (body.description !== undefined) updates.description = body.description?.trim() || null
  if (body.sortOrder !== undefined) updates.sort_order = body.sortOrder

  const updatedLesson = await prisma.lesson.update({ where: { id: lessonId }, data: updates })

  if (body.video) {
    if (lesson.video) {
      await prisma.video.update({
        where: { lesson_id: lessonId },
        data: {
          youtube_video_id: body.video.youtubeVideoId || lesson.video.youtube_video_id,
          duration_seconds: body.video.durationSeconds || lesson.video.duration_seconds,
          title: body.video.title?.trim() || lesson.video.title,
        },
      })
    } else if (body.video.youtubeVideoId && body.video.durationSeconds) {
      await prisma.video.create({
        data: {
          lesson_id: lessonId,
          provider: 'YOUTUBE',
          youtube_video_id: body.video.youtubeVideoId,
          duration_seconds: body.video.durationSeconds,
          title: body.video.title?.trim() || null,
        },
      })
    }
  }

  const finalLesson = await prisma.lesson.findUnique({ where: { id: lessonId }, include: { video: true } })

  return NextResponse.json({
    lessonId: finalLesson!.id,
    id: finalLesson!.id,
    sessionId: finalLesson!.session_id,
    title: finalLesson!.title,
    description: finalLesson!.description,
    video: finalLesson!.video ? {
      videoId: finalLesson!.video.id,
      id: finalLesson!.video.id,
      youtubeVideoId: finalLesson!.video.youtube_video_id,
      durationSeconds: finalLesson!.video.duration_seconds,
    } : null,
  }, { status: 200 })
}

export async function PUT(request: NextRequest, context: { params: { lessonId: string } }) {
  return PATCH(request, context)
}

export async function DELETE(request: NextRequest, { params }: { params: { lessonId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền xóa bài học' } }, { status: 403 })
  }

  const lessonId = params.lessonId
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId } })
  if (!lesson) return NextResponse.json({ error: { code: 'LessonNotFound', message: 'Bài học không tồn tại' } }, { status: 404 })

  await prisma.lesson.delete({ where: { id: lessonId } })

  return NextResponse.json({ success: true, message: 'Đã xóa bài học thành công' }, { status: 200 })
}
