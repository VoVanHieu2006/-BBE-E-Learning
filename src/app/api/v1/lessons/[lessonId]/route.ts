import { deleteUnusedContent, ContentDeleteError } from '@/lib/content-deletion'
import { cleanupDeletedContentAssets } from '@/lib/deleted-content-assets'
import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { finalExamBankError } from '@/lib/final-exam-bank'
import { MAX_VIDEO_DURATION_SECONDS, MIN_VIDEO_DURATION_SECONDS, normalizeDurationSeconds } from '@/lib/validation/duration'
import { checkLessonProgression } from '@/lib/progression'
import { getLessonDetailServerCache, setLessonDetailServerCache } from '@/lib/server-cache'
import { guardCourseEditableByLesson, invalidateCourseContentCaches } from '@/lib/course-edit-guard'

type LessonDetail = Awaited<ReturnType<typeof loadLessonDetail>>
const LESSON_DETAIL_TTL_MS = 15_000

function loadLessonDetail(lessonId: string) {
  return prisma.lesson.findUnique({
    where: { id: lessonId },
    relationLoadStrategy: 'join',
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
        select: { id: true, title: true, description: true, question_count: true, duration_minutes: true, _count: { select: { questions: true } } },
      },
      documents: {
        select: { id: true, file_name: true, file_size: true, mime_type: true, created_at: true },
        orderBy: { created_at: 'asc' },
      },
    },
  })
}

export async function GET(request: NextRequest, { params }: { params: { lessonId: string } }) {
  const hasAuthHeader = Boolean(request.headers.get('authorization'))
  const hasSessionCookie = Boolean(request.cookies.get('token') || request.cookies.get('session') || request.cookies.get('auth'))
  const auth = (hasAuthHeader || hasSessionCookie)
    ? await authenticate(request).catch(() => ({ ok: false }))
    : { ok: false }
  const context = auth.ok ? (auth as any).context! : null
  const lessonId = params.lessonId

  let lesson = getLessonDetailServerCache(lessonId, LESSON_DETAIL_TTL_MS) as LessonDetail | null
  if (!lesson) {
    lesson = await loadLessonDetail(lessonId)
    if (lesson) setLessonDetailServerCache(lessonId, lesson)
  }

  if (!lesson) {
    return NextResponse.json({ error: { code: 'LessonNotFound', message: 'Bài học không tồn tại' } }, { status: 404 })
  }

  // Published/public course status is not a substitute for a learning assignment.
  const course = lesson.session.course

  if (course.status !== 'PUBLISHED' && context?.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Khóa học chưa Published' } }, { status: 403 })
  }

  if (!context && !(course.status === 'PUBLISHED' && course.visibility === 'PUBLIC')) {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Please sign in to access this lesson.' } }, { status: 401 })
  }

  if (context && context.role !== 'ADMIN') {
    const gate = await checkLessonProgression(context.userId, lesson.id, 'VIEW')
    if (gate.ok === false) return NextResponse.json({ error: { code: gate.code, message: gate.message } }, { status: 403 })
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
    assessment: context && lesson.assessment ? {
      assessmentId: lesson.assessment.id,
      id: lesson.assessment.id,
      title: lesson.assessment.title,
      description: lesson.assessment.description,
      questionCount: lesson.assessment.question_count,
      bankQuestionCount: lesson.assessment._count.questions,
      durationMinutes: lesson.assessment.duration_minutes,
      passingPercent: 85,
    } : null,
    documents: (context || (course.status === 'PUBLISHED' && course.visibility === 'PUBLIC')) ? lesson.documents.map((d) => ({
      documentId: d.id,
      id: d.id,
      fileName: d.file_name,
      fileSize: Number(d.file_size),
      mimeType: d.mime_type,
    })) : [],
  }, {
    status: 200,
    headers: {
      'Cache-Control': !context && course.visibility === 'PUBLIC'
        ? 'public, max-age=15, s-maxage=30, stale-while-revalidate=60'
        : 'no-store',
    },
  })
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
  const blocked = await guardCourseEditableByLesson(lessonId)
  if (blocked) return blocked

  const updates: any = {}
  if (body.title !== undefined) updates.title = body.title.trim()
  if (body.description !== undefined) updates.description = body.description?.trim() || null
  if (body.sortOrder !== undefined) updates.sort_order = body.sortOrder

  // Kiểm tra thời lượng TRƯỚC khi ghi bất cứ thứ gì, tránh cập nhật dở dang khi dữ liệu sai.
  let videoDuration: number | null = null
  if (body.video && body.video.durationSeconds !== undefined && body.video.durationSeconds !== null) {
    videoDuration = normalizeDurationSeconds(body.video.durationSeconds)
    if (videoDuration === null) {
      return NextResponse.json({
        error: {
          code: 'ValidationError',
          message: `Thời lượng video không hợp lệ. Vui lòng nhập số giây trong khoảng ${MIN_VIDEO_DURATION_SECONDS} – ${MAX_VIDEO_DURATION_SECONDS}.`,
        },
      }, { status: 400 })
    }
  }

  const updatedLesson = await prisma.lesson.update({ where: { id: lessonId }, data: updates })

  if (body.video) {
    if (lesson.video) {
      await prisma.video.update({
        where: { lesson_id: lessonId },
        data: {
          youtube_video_id: body.video.youtubeVideoId || lesson.video.youtube_video_id,
          duration_seconds: videoDuration ?? lesson.video.duration_seconds,
          title: body.video.title?.trim() || lesson.video.title,
        },
      })
    } else if (body.video.youtubeVideoId) {
      if (videoDuration === null) {
        return NextResponse.json({
          error: {
            code: 'ValidationError',
            message: `Thời lượng video không hợp lệ. Vui lòng nhập số giây trong khoảng ${MIN_VIDEO_DURATION_SECONDS} – ${MAX_VIDEO_DURATION_SECONDS}.`,
          },
        }, { status: 400 })
      }

      await prisma.video.create({
        data: {
          lesson_id: lessonId,
          provider: 'YOUTUBE',
          youtube_video_id: body.video.youtubeVideoId,
          duration_seconds: videoDuration,
          title: body.video.title?.trim() || null,
        },
      })
    }
  }

  const finalLesson = await prisma.lesson.findUnique({ where: { id: lessonId }, include: { video: true } })
  invalidateCourseContentCaches(undefined, lessonId)

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
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { session: { select: { course_id: true } } } })
  if (!lesson) return NextResponse.json({ error: { code: 'LessonNotFound', message: 'Bài học không tồn tại' } }, { status: 404 })
  const blocked = await guardCourseEditableByLesson(lessonId)
  if (blocked) return blocked

  try {
    const assets = await prisma.$transaction(tx => deleteUnusedContent(tx, { courseId: lesson.session.course_id, lessonId }, (auth as any).context!.userId), { isolationLevel: 'Serializable', timeout: 30_000 })
    await cleanupDeletedContentAssets(assets)
  } catch (error) {
    if (error instanceof ContentDeleteError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status })
    if ((error as { code?: string }).code === 'P2034') return NextResponse.json({ error: { code: 'ContentChanged', message: 'D\u1eef li\u1ec7u v\u1eeba thay \u0111\u1ed5i. Vui l\u00f2ng t\u1ea3i l\u1ea1i v\u00e0 th\u1eed l\u1ea1i.' } }, { status: 409 })
    invalidateCourseContentCaches(lesson.session.course_id, lessonId)
    const bankError = finalExamBankError(error)
    if (bankError) return NextResponse.json(bankError, { status: 409 })
    throw error
  }

  invalidateCourseContentCaches(lesson.session.course_id, lessonId)
  return NextResponse.json({ success: true, message: 'Đã xóa bài học thành công' }, { status: 200 })
}
