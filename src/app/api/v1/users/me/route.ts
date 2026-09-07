import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/v1/users/me
 * Get current user info.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: (auth as any).context!.userId },
    include: {
      chapter_members: {
        take: 1,
        include: { chapter: { select: { id: true, name: true } } },
      },
    },
  })

  if (!user) {
    return NextResponse.json({ error: { code: 'UserNotFound', message: 'Người dùng không tồn tại' } }, { status: 404 })
  }

  return NextResponse.json({
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    chapterId: user.chapter_members?.[0]?.chapter?.id || null,
    chapterName: user.chapter_members?.[0]?.chapter?.name || null,
  }, { status: 200 })
}
