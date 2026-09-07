import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function DELETE(request: NextRequest, { params }: { params: { chapterId: string; userId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const chapterId = params.chapterId
  const userId = params.userId

  if (!chapterId || !userId) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Thiếu chapterId hoặc userId' } }, { status: 400 })
  }

  // Check access
  if ((auth as any).context!.role === 'CHAPTER_LEADER') {
    if ((auth as any).context!.chapterId !== chapterId) {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'BĐHU chỉ xóa thành viên trong chapter mình' } }, { status: 403 })
    }
  } else if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Không có quyền' } }, { status: 403 })
  }

  // Find membership
  const membership = await prisma.chapterMember.findFirst({ where: { chapter_id: chapterId, user_id: userId } })
  if (!membership) return NextResponse.json({ error: { code: 'MembershipNotFound', message: 'Thành viên không thuộc chapter này' } }, { status: 404 })

  // Delete membership (not the user account)
  await prisma.chapterMember.delete({ where: { id: membership.id } })

  // Audit log
  await prisma.auditLog.create({
    data: {
      actor_user_id: (auth as any).context!.userId,
      action: 'REMOVE_FROM_CHAPTER',
      entity_type: 'CHAPTER_MEMBER',
      entity_id: membership.id,
      metadata: JSON.stringify({ chapterId, userId }),
    },
  })

  return NextResponse.json({ userId, chapterId, membershipStatus: 'LEFT' }, { status: 200 })
}
