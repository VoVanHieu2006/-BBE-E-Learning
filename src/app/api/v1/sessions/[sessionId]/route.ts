import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertFinalExamBankCapacity, finalExamBankError, lockCourseExamBank } from '@/lib/final-exam-bank'

export async function GET(request: NextRequest, { params }: { params: { sessionId: string } }) {
  const sessionId = params.sessionId
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      lessons: {
        include: {
          video: true,
          documents: true,
        },
        orderBy: { sort_order: 'asc' },
      },
    },
  })

  if (!session) {
    return NextResponse.json({ error: { code: 'SessionNotFound', message: 'Session không tồn tại' } }, { status: 404 })
  }

  return NextResponse.json({
    sessionId: session.id,
    id: session.id,
    courseId: session.course_id,
    title: session.title,
    description: session.description,
    sortOrder: session.sort_order,
    lessons: session.lessons.map((l) => ({
      lessonId: l.id,
      id: l.id,
      title: l.title,
      description: l.description,
      sortOrder: l.sort_order,
      video: l.video ? {
        videoId: l.video.id,
        youtubeVideoId: l.video.youtube_video_id,
        durationSeconds: l.video.duration_seconds,
      } : null,
      documents: l.documents.map((d) => ({
        documentId: d.id,
        fileName: d.file_name,
        fileSize: Number(d.file_size),
        mimeType: d.mime_type,
      })),
    })),
  })
}

export async function PATCH(request: NextRequest, { params }: { params: { sessionId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền cập nhật session' } }, { status: 403 })
  }

  const sessionId = params.sessionId
  const session = await prisma.session.findUnique({ where: { id: sessionId } })
  if (!session) return NextResponse.json({ error: { code: 'SessionNotFound', message: 'Session không tồn tại' } }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const updates: any = {}
  if (body.title !== undefined) updates.title = body.title.trim()
  if (body.description !== undefined) updates.description = body.description?.trim() || null
  if (body.sortOrder !== undefined) updates.sort_order = body.sortOrder

  const updated = await prisma.session.update({
    where: { id: sessionId },
    data: updates,
  })

  return NextResponse.json({
    sessionId: updated.id,
    id: updated.id,
    courseId: updated.course_id,
    title: updated.title,
    description: updated.description,
    sortOrder: updated.sort_order,
  })
}

export async function PUT(request: NextRequest, context: { params: { sessionId: string } }) {
  return PATCH(request, context)
}

export async function DELETE(request: NextRequest, { params }: { params: { sessionId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền xóa session' } }, { status: 403 })
  }

  const sessionId = params.sessionId
  const session = await prisma.session.findUnique({ where: { id: sessionId } })
  if (!session) return NextResponse.json({ error: { code: 'SessionNotFound', message: 'Session không tồn tại' } }, { status: 404 })

  try {
    await prisma.$transaction(async (tx) => {
      await lockCourseExamBank(tx, session.course_id)
      const attempts = await tx.attempt.count({ where: { assessment: { lesson: { session_id: sessionId } } } })
      if (attempts) throw new Error('SessionHasAttempts')
      await tx.session.delete({ where: { id: sessionId } })
      await assertFinalExamBankCapacity(tx, session.course_id)
    })
  } catch (error) {
    const bankError = finalExamBankError(error)
    if (bankError) return NextResponse.json(bankError, { status: 409 })
    if (error instanceof Error && error.message === 'SessionHasAttempts') return NextResponse.json({ error: { code: 'AssessmentVersionRequired', message: 'Buổi học có quiz đã được làm; không thể xóa lịch sử.' } }, { status: 409 })
    throw error
  }

  return NextResponse.json({ success: true, message: 'Đã xóa session thành công' }, { status: 200 })
}
