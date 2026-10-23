import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { getUserStarBalance } from '@/lib/stars'
import { prisma } from '@/lib/prisma'
import { normalizeStarHistoryPagination } from '@/lib/star-history-rules'

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const userId = auth.context!.userId
  const where = { user_id: userId }

  const balance = await getUserStarBalance(userId, auth.context!.role)
  // The video classroom only needs the live total for its header. Avoid the
  // full paginated history and title-enrichment query on that hot path.
  if (request.nextUrl.searchParams.get('balanceOnly') === '1') {
    return NextResponse.json({ balance }, { headers: { 'Cache-Control': 'no-store' } })
  }
  const totalItems = await prisma.starLedger.count({ where })

  const { page, limit, totalPages } = normalizeStarHistoryPagination(
    request.nextUrl.searchParams.get('page'),
    request.nextUrl.searchParams.get('limit'),
    totalItems,
  )

  const items = await prisma.starLedger.findMany({
    where,
    orderBy: [{ awarded_at: 'desc' }, { id: 'desc' }],
    skip: (page - 1) * limit,
    take: limit,
    select: {
      id: true,
      amount: true,
      reason: true,
      awarded_at: true,
      source_type: true,
      source_id: true,
      metadata: true,
    },
  })

  // Enrich with lesson, course and assessment titles
  const videoIds = items.filter((i) => i.source_type === 'VIDEO' && i.source_id).map((i) => i.source_id)
  const assessmentIds = items.filter((i) => i.source_type === 'ASSESSMENT' && i.source_id).map((i) => i.source_id)
  const metadataLessonIds = items
    .map((i) => (i.metadata && typeof i.metadata === 'object' ? (i.metadata as any).lessonId : null))
    .filter((id): id is string => Boolean(id))

  const [videos, lessons, assessments] = await Promise.all([
    videoIds.length
      ? prisma.video.findMany({
          where: { id: { in: videoIds } },
          select: {
            id: true,
            title: true,
            lesson: {
              select: {
                id: true,
                title: true,
                session: { select: { course: { select: { id: true, title: true } } } },
              },
            },
          },
        })
      : Promise.resolve([]),
    metadataLessonIds.length
      ? prisma.lesson.findMany({
          where: { id: { in: metadataLessonIds } },
          select: {
            id: true,
            title: true,
            session: { select: { course: { select: { id: true, title: true } } } },
          },
        })
      : Promise.resolve([]),
    assessmentIds.length
      ? prisma.assessment.findMany({
          where: { id: { in: assessmentIds } },
          select: {
            id: true,
            title: true,
            lesson: {
              select: {
                title: true,
                session: { select: { course: { select: { id: true, title: true } } } },
              },
            },
            course: { select: { id: true, title: true } },
          },
        })
      : Promise.resolve([]),
  ])

  const videoMap = new Map(videos.map((v) => [v.id, v]))
  const lessonMap = new Map(lessons.map((l) => [l.id, l]))
  const assessmentMap = new Map(assessments.map((a) => [a.id, a]))

  const enrichedItems = items.map((entry) => {
    let lessonTitle: string | null = null
    let courseTitle: string | null = null
    let quizTitle: string | null = null
    let detail = ''

    if (entry.reason === 'VIDEO_COMPLETION') {
      const v = videoMap.get(entry.source_id)
      const l = v?.lesson || lessonMap.get((entry.metadata as any)?.lessonId)
      lessonTitle = l?.title || v?.title || null
      courseTitle = l?.session?.course?.title || null
      detail = lessonTitle
        ? `Hoàn thành video: ${lessonTitle}${courseTitle ? ` · ${courseTitle}` : ''}`
        : 'Hoàn thành video bài học'
    } else if (entry.reason === 'MODULE_QUIZ_PASS' || entry.reason === 'MODULE_QUIZ_BONUS') {
      const a = assessmentMap.get(entry.source_id)
      quizTitle = a?.title || 'Bài kiểm tra'
      lessonTitle = a?.lesson?.title || null
      courseTitle = a?.lesson?.session?.course?.title || null
      detail = `Vượt qua bài kiểm tra: ${quizTitle}${lessonTitle ? ` · ${lessonTitle}` : ''}`
    } else if (entry.reason === 'COURSE_FINAL_PASS' || entry.reason === 'COURSE_FINAL_BONUS') {
      const a = assessmentMap.get(entry.source_id)
      courseTitle = a?.course?.title || null
      detail = courseTitle
        ? `Vượt qua bài thi cuối khóa: ${courseTitle}`
        : 'Vượt qua bài thi cuối khóa'
    } else if (entry.reason === 'ADMIN_ADJUSTMENT') {
      detail = 'Điều chỉnh Star bởi Ban Quản Trị'
    } else {
      detail = 'Phần thưởng tích lũy Star BBE'
    }

    return {
      id: entry.id,
      amount: entry.amount,
      reason: entry.reason,
      awarded_at: entry.awarded_at,
      source_type: entry.source_type,
      lessonTitle,
      courseTitle,
      quizTitle,
      detail,
    }
  })

  return NextResponse.json({
    balance,
    items: enrichedItems,
    page,
    limit,
    totalItems,
    totalPages,
  })
}
