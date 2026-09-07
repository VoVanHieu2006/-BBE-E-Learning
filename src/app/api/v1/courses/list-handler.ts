import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const auth = await authenticate(request).catch(() => ({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Auth error' } }))
  
  const url = new URL(request.url)
  const page = parseInt(url.searchParams.get('page') || '1', 10)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10), 1), 100)
  const skip = (page - 1) * limit

  // Determine filter based on actor
  const where: any = {}
  if (!auth.ok) {
    // No auth → only Published + Public
    where.status = 'PUBLISHED'
    where.visibility = 'PUBLIC'
  } else {
    const role = (auth as any).context!.role
    if (role === 'ADMIN') {
      // No filter — see all
    } else if (role === 'CHAPTER_LEADER' || role === 'MEMBER') {
      // See all Published
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

  return NextResponse.json({
    items: items.map((c) => ({
      courseId: c.id,
      title: c.title,
      description: c.description,
      status: c.status,
      visibility: c.visibility,
      sessionCount: c._count.sessions,
      publishedAt: c.published_at,
    })),
    totalItems,
    totalPages: Math.ceil(totalItems / limit),
  })
}
