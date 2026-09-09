import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * PATCH / POST /api/v1/lessons/[lessonId]/progress
 * Update learning progress (heartbeat from YouTube player).
 */
export async function PATCH(request: NextRequest, { params }: { params: { lessonId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const positionSeconds = body.positionSeconds ?? body.currentPositionSeconds ?? body.position ?? 0
  const furthestWatchedPositionSeconds = body.furthestWatchedPositionSeconds ?? body.furthest ?? positionSeconds

  const lesson = await prisma.lesson.findUnique({
    where: { id: params.lessonId },
    include: {
      video: true,
      session: { include: { course: true } },
    },
  })
  if (!lesson) return NextResponse.json({ error: { code: 'LessonNotFound', message: 'Bài học không tồn tại' } }, { status: 404 })
  if (!lesson.video) return NextResponse.json({ error: { code: 'LessonNotFound', message: 'Bài học chưa có video' } }, { status: 404 })

  const user = await prisma.user.findUnique({ where: { id: (auth as any).context!.userId } })
  if (!user || user.status !== 'ACTIVE') return NextResponse.json({ error: { code: 'AccessDenied', message: 'Tài khoản phải Active' } }, { status: 403 })

  const existing = await prisma.lessonProgress.findUnique({
    where: { user_id_lesson_id: { user_id: (auth as any).context!.userId, lesson_id: params.lessonId } },
  })

  // Anti-cheat tỉ lệ theo thời gian thực: furthest chỉ được tăng tối đa (25s + 2× thời gian thực trôi qua kể từ
  // lần lưu trước). Người xem thật luôn pass — kể cả heartbeat thưa do Chrome throttle timer khi tab ẩn, kể cả
  // tốc độ 2x; còn gọi API trực tiếp để nhảy cóc thì không thể nhanh hơn thời gian đã chờ (≈ thời gian xem).
  // `completed` chỉ được bật khi tiến độ sau kẹp (clamp) thực sự ≥ 85% (hoặc đã hoàn thành từ trước).
  const currentFurthest = existing?.furthest_watched_position_seconds || 0
  const role = (auth as any).context!.role
  const seekExempt = role === 'ADMIN' || role === 'CHAPTER_LEADER'
  const duration = lesson.video.duration_seconds || 1

  const elapsedSec = existing?.last_watched_at
    ? Math.min(Math.max((Date.now() - new Date(existing.last_watched_at).getTime()) / 1000, 0), 3600)
    : 0
  const cap = seekExempt ? Number.MAX_SAFE_INTEGER : currentFurthest + 25 + 2 * elapsedSec
  const requestedFurthest = Math.max(Number(positionSeconds) || 0, Number(furthestWatchedPositionSeconds) || 0)
  const newFurthest = Math.max(currentFurthest, Math.min(requestedFurthest, cap))
  const clampedPosition = Math.min(Number(positionSeconds) || 0, newFurthest)

  const progressPercentage = duration > 0
    ? Math.min(100, (newFurthest / duration) * 100)
    : 0

  const completed = progressPercentage >= 85 || (existing?.completed ?? false)
  const completed_at = completed ? (existing?.completed_at || new Date()) : null

  const updated = await prisma.lessonProgress.upsert({
    where: { user_id_lesson_id: { user_id: (auth as any).context!.userId, lesson_id: params.lessonId } },
    update: {
      last_position_seconds: Math.floor(clampedPosition),
      furthest_watched_position_seconds: Math.floor(newFurthest),
      last_watched_at: new Date(),
      completed,
      completed_at,
    },
    create: {
      user_id: (auth as any).context!.userId,
      lesson_id: params.lessonId,
      last_position_seconds: Math.floor(clampedPosition),
      furthest_watched_position_seconds: Math.floor(newFurthest),
      last_watched_at: new Date(),
      completed,
      completed_at,
    },
  })

  return NextResponse.json({
    lessonId: updated.lesson_id,
    id: updated.lesson_id,
    lastPositionSeconds: updated.last_position_seconds,
    furthestWatchedPositionSeconds: updated.furthest_watched_position_seconds,
    progressPercentage: Math.round(progressPercentage * 100) / 100,
    completed: updated.completed,
    completedAt: updated.completed_at,
  }, { status: 200 })
}

export async function POST(request: NextRequest, context: { params: { lessonId: string } }) {
  return PATCH(request, context)
}

export async function GET(request: NextRequest, { params }: { params: { lessonId: string } }) {
  const auth = await authenticate(request).catch(() => ({ ok: false, error: { code: 'UNAUTHORIZED' } }))
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const user = await prisma.user.findUnique({ where: { id: (auth as any).context!.userId } })
  if (!user || user.status !== 'ACTIVE') return NextResponse.json({ error: { code: 'AccessDenied', message: 'Tài khoản phải Active' } }, { status: 403 })

  const progress = await prisma.lessonProgress.findUnique({
    where: { user_id_lesson_id: { user_id: (auth as any).context!.userId, lesson_id: params.lessonId } },
    include: {
      lesson: {
        include: { video: true },
      },
    },
  })

  if (!progress) {
    return NextResponse.json({
      lessonId: params.lessonId,
      id: params.lessonId,
      completed: false,
      watchedUntil: 0,
      lastPosition: 0,
      lastPositionSeconds: 0,
      furthestWatchedPositionSeconds: 0,
      progressPercentage: 0,
      updatedAt: null,
    }, { status: 200 })
  }

  const duration = progress.lesson.video?.duration_seconds || 1
  const furthest = progress.furthest_watched_position_seconds || 0
  const progressPercentage = duration > 0 ? Math.min(100, Math.round((furthest / duration) * 100)) : 0

  return NextResponse.json({
    lessonId: progress.lesson_id,
    id: progress.lesson_id,
    completed: progress.completed,
    watchedUntil: progress.furthest_watched_position_seconds || 0,
    lastPosition: progress.last_position_seconds || 0,
    lastPositionSeconds: progress.last_position_seconds || 0,
    furthestWatchedPositionSeconds: progress.furthest_watched_position_seconds || 0,
    progressPercentage,
    completedAt: progress.completed_at,
    updatedAt: progress.updated_at,
  }, { status: 200 })
}
