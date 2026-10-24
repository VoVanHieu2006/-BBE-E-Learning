import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getCoursesServerCache, invalidateCoursesServerCache, setCoursesServerCache } from '@/lib/server-cache'

const COURSES_CACHE_TTL = 15000

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const page = parseInt(url.searchParams.get('page') || '1', 10)
  const requestedLimit = parseInt(url.searchParams.get('limit') || '100', 10)
  const limit = Math.min(Math.max(requestedLimit, 1), 200)
  const skip = (page - 1) * limit

  // Fast-path guest check: avoid authenticate overhead when no token is presented
  const hasAuthHeader = Boolean(request.headers.get('authorization'))
  const hasAccessCookie = Boolean(request.cookies.get('accessToken'))
  const hasRefreshCookie = Boolean(request.cookies.get('refreshToken'))
  const isDefinitelyGuest = !hasAuthHeader && !hasAccessCookie && !hasRefreshCookie

  let role = 'GUEST'
  let auth: any = { ok: false }

  if (!isDefinitelyGuest) {
    auth = await authenticate(request).catch(() => ({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Auth error' } }))
    if (auth.ok) role = auth.context.role
  }

  const cacheKey = `${role}:${page}:${limit}`
  const cached = getCoursesServerCache(cacheKey, COURSES_CACHE_TTL)
  if (cached) {
    return NextResponse.json(cached, {
      status: 200,
      headers: {
        'Cache-Control': role === 'GUEST'
          ? 'public, max-age=15, s-maxage=30, stale-while-revalidate=60'
          : 'private, no-cache, no-store, must-revalidate',
      },
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
      include: {
        _count: { select: { sessions: true } },
        program: { select: { id: true, code: true, name: true, is_core: true, sort_order: true } },
      },
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
      coverUrl: c.cover_url,
      programId: c.program_id,
      programCode: c.program?.code || null,
      program: c.program ? {
        id: c.program.id,
        code: c.program.code,
        name: c.program.name,
        isCore: c.program.is_core,
        sortOrder: c.program.sort_order,
      } : null,
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
  const { title, description, visibility, coverUrl } = body

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
      cover_url: typeof coverUrl === 'string' && /^https:\/\//.test(coverUrl) ? coverUrl : null,
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
    coverUrl: course.cover_url,
    createdAt: course.created_at,
  }, { status: 201 })
}
