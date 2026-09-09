import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getChaptersServerCache, setChaptersServerCache } from '@/lib/server-cache'

const CHAPTERS_CACHE_TTL = 15000

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin' } }, { status: 403 })

  const url = new URL(request.url)
  const page = parseInt(url.searchParams.get('page') || '1', 10)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10), 1), 100)
  const skip = (page - 1) * limit

  const cacheKey = `${page}:${limit}`
  const cached = getChaptersServerCache(cacheKey, CHAPTERS_CACHE_TTL)
  if (cached) {
    return NextResponse.json(cached, {
      status: 200,
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    })
  }

  const [items, totalItems] = await Promise.all([
    prisma.chapter.findMany({
      include: {
        _count: { select: { chapter_members: { where: { user: { status: 'ACTIVE', role: 'MEMBER' } } } } },
      },
      orderBy: { created_at: 'desc' },
      skip, take: limit,
    }),
    prisma.chapter.count(),
  ])

  const responsePayload = {
    items: items.map((c) => ({
      chapterId: c.id,
      name: c.name,
      status: c.status,
      memberCount: c._count?.chapter_members ?? 0,
      createdAt: c.created_at,
    })),
    totalItems,
    totalPages: Math.ceil(totalItems / limit),
  }

  setChaptersServerCache(cacheKey, responsePayload)

  return NextResponse.json(responsePayload, {
    status: 200,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  })
}
