import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: { chapterId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const chapterId = params.chapterId
  if (!chapterId) return NextResponse.json({ error: { code: 'ValidationError', message: 'Thiếu chapterId' } }, { status: 400 })

  // Check access
  if ((auth as any).context!.role === 'CHAPTER_LEADER') {
    const member = await prisma.chapterMember.findFirst({ where: { chapter_id: chapterId, user_id: (auth as any).context!.userId } })
    if (!member) return NextResponse.json({ error: { code: 'AccessDenied', message: 'BĐHU chỉ xem chapter của mình' } }, { status: 403 })
  } else if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Không có quyền' } }, { status: 403 })
  }

  const url = new URL(request.url)
  const statusParam = url.searchParams.get('status')
  const search = url.searchParams.get('search') || ''
  const page = parseInt(url.searchParams.get('page') || '1', 10)
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '20', 10), 1), 100)
  const skip = (page - 1) * limit

  const where: any = { chapter_id: chapterId }
  if (statusParam) where.user = { status: statusParam }
  if (search) where.user = { email: { contains: search, mode: 'insensitive' } }

  // Admin can see CHAPTER_LEADER members too; BĐHU only MEMBERS
  const roleFilter = (auth as any).context!.role === 'ADMIN' ? undefined : 'MEMBER'

  const [items, totalItems] = await Promise.all([
    prisma.chapterMember.findMany({
      where: { ...where, ...(roleFilter ? { user: { role: roleFilter } } : {}) },
      include: { user: { select: { id: true, email: true, status: true, role: true, created_at: true } } },
      orderBy: { joined_at: 'desc' },
      skip, take: limit,
    }),
    prisma.chapterMember.count({ where: { ...where, ...(roleFilter ? { user: { role: roleFilter } } : {}) } }),
  ])

  return NextResponse.json({
    items: items.map((m) => ({
      userId: m.user.id,
      email: m.user.email,
      status: m.user.status,
      role: m.user.role,
      joinedAt: m.joined_at,
    })),
    totalItems,
    totalPages: Math.ceil(totalItems / limit),
  })
}
