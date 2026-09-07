import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getCoursesServerCache, invalidateCoursesServerCache, setCoursesServerCache } from '@/lib/server-cache'

const COURSES_CACHE_TTL = 15000

export async function GET(request: NextRequest) {
  const auth = await authenticate(request).catch(() => ({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Auth error' } }))

  const url = new URL(request.url)
  const page = parseInt(url.searchParams.get('page') || '1', 10)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10), 1), 100)
  const skip = (page - 1) * limit

  const role = auth.ok ? (auth as any).context!.role : 'GUEST'
  const cacheKey = `${role}:${page}:${limit}`
  const cached = getCoursesServerCache(cacheKey, COURSES_CACHE_TTL)
  if (cached) {
    return NextResponse.json(cached, {
      status: 200,
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    })
  }

  const where: any = {}
  if (!auth.ok) {
    where.status = 'PUBLISHED'
    where.visibility = 'PUBLIC'
  } else {
    const role = (auth as any).context!.role
    if (role === 'ADMIN') {
      // Admin sees all courses (DRAFT and PUBLISHED)
    } else if (role === 'CHAPTER_LEADER' || role === 'MEMBER') {
      where.status = 'PUBLISHED'
    } else {
      where.status = 'PUBLISHED'
      where.visibility = 'PUBLIC'
    }
  }

  const [items, totalItems] = await Promise.all([
    prisma.course.findMany({
      where,
      include: { _count: { select: { sessions: true } } },
      orderBy: { created_at: 'desc' },
      skip, take: limit,
    }),
    prisma.course.count({ where }),
  ])

  const responsePayload = {
    items: items.map((c) => ({
      courseId: c.id,
      id: c.id,
      title: c.title,
      description: c.description,
      status: c.status,
      visibility: c.visibility,
      sessionCount: c._count.sessions,
      publishedAt: c.published_at,
    })),
    totalItems,
    totalPages: Math.ceil(totalItems / limit),
  }

  setCoursesServerCache(cacheKey, responsePayload)

  return NextResponse.json(responsePayload, {
    status: 200,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  })
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền tạo khóa học' } }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const { title, description, visibility } = body

  if (!title || typeof title !== 'string' || title.trim().length < 2) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Tiêu đề khóa học phải từ 2 ký tự trở lên' } }, { status: 400 })
  }

  const courseVisibility = visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE'

  const course = await prisma.course.create({
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      visibility: courseVisibility,
      status: 'DRAFT',
      created_by: (auth as any).context!.userId,
    },
  })

  invalidateCoursesServerCache()

  return NextResponse.json({
    courseId: course.id,
    id: course.id,
    title: course.title,
    description: course.description,
    status: course.status,
    visibility: course.visibility,
    createdAt: course.created_at,
  }, { status: 201 })
}
