import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest, { params }: { params: { sessionId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin' } }, { status: 403 })
  }

  const sessionId = params.sessionId
  const body = await request.json().catch(() => ({}))
  const { title, description, sortOrder, video, youtubeVideoId, durationSeconds } = body

  if (!title || typeof title !== 'string' || title.trim().length < 2) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Tiêu đề bài học bắt buộc' } }, { status: 400 })
  }

  const vidId = video?.youtubeVideoId || youtubeVideoId
  const vidDuration = video?.durationSeconds || durationSeconds || 120
  const vidTitle = video?.title || title.trim()

  if (!vidId) {
    return NextResponse.json({
      error: { code: 'ValidationError', message: 'Video là bắt buộc cho mỗi lesson (youtubeVideoId)' },
    }, { status: 400 })
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId } })
  if (!session) return NextResponse.json({ error: { code: 'SessionNotFound', message: 'Session không tồn tại' } }, { status: 404 })

  const result = await prisma.$transaction(async (tx) => {
    const lesson = await tx.lesson.create({
      data: {
        session_id: sessionId,
        title: title.trim(),
        description: description?.trim() || null,
        sort_order: sortOrder ?? 0,
      },
    })

    const vid = await tx.video.create({
      data: {
        lesson_id: lesson.id,
        provider: 'YOUTUBE',
        youtube_video_id: vidId,
        duration_seconds: Number(vidDuration),
        title: vidTitle,
      },
    })

    return { lesson, video: vid }
  })

  return NextResponse.json({
    lessonId: result.lesson.id,
    id: result.lesson.id,
    sessionId: result.lesson.session_id,
    title: result.lesson.title,
    video: {
      videoId: result.video.id,
      id: result.video.id,
      youtubeVideoId: result.video.youtube_video_id,
      durationSeconds: result.video.duration_seconds,
    },
  }, { status: 201 })
}

/**
 * PATCH /api/v1/sessions/{sessionId}/lessons
 * Reorder lessons in session — Admin only
 */
export async function PATCH(request: NextRequest, { params }: { params: { sessionId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin' } }, { status: 403 })
  }

  const sessionId = params.sessionId
  const body = await request.json().catch(() => ({}))
  const { lessons } = body

  if (!Array.isArray(lessons)) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'lessons array bắt buộc' } }, { status: 400 })
  }

  await prisma.$transaction(
    lessons.map((item: any, idx: number) => {
      const lessonId = item.lessonId || item.id
      return prisma.lesson.update({
        where: { id: lessonId, session_id: sessionId },
        data: { sort_order: item.sortOrder !== undefined ? item.sortOrder : idx },
      })
    })
  )

  return NextResponse.json({ success: true }, { status: 200 })
}
