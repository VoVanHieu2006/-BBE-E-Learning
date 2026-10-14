import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { canAccessChapterPermission } from '@/lib/authorization'
import { prisma } from '@/lib/prisma'

export async function PATCH(request: NextRequest, { params }: { params: { userId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : ''
  const chapterId = typeof body?.chapterId === 'string' ? body.chapterId : ''
  if (displayName.length < 2 || displayName.length > 120) return NextResponse.json({ error: { code: 'ValidationError', message: 'Tên hiển thị cần từ 2 đến 120 ký tự.' } }, { status: 400 })

  if (auth.context!.role !== 'ADMIN') {
    if (!chapterId || !await canAccessChapterPermission(auth.context!, chapterId, 'MANAGE_CHAPTER_MEMBERS')) {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'Bạn không có quyền sửa thành viên của Chapter này.' } }, { status: 403 })
    }
    const membership = await prisma.chapterMember.findFirst({ where: { chapter_id: chapterId, user_id: params.userId }, select: { id: true } })
    if (!membership) return NextResponse.json({ error: { code: 'AccessDenied', message: 'Thành viên không thuộc Chapter được quản lý.' } }, { status: 403 })
  }
  const user = await prisma.user.update({ where: { id: params.userId }, data: { display_name: displayName }, select: { id: true, email: true, display_name: true } })
  await prisma.auditLog.create({ data: { actor_user_id: auth.context!.userId, action: 'UPDATE_MEMBER_PROFILE', entity_type: 'USER', entity_id: user.id, metadata: JSON.stringify({ displayName }) } })
  return NextResponse.json({ id: user.id, email: user.email, displayName: user.display_name })
}
