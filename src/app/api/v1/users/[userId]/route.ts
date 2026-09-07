import { NextRequest, NextResponse } from 'next/server'
import { authenticate, invalidateUserAuthCache } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { invalidateServerUsersCache, invalidateAdminOverviewCache } from '@/lib/server-cache'

export async function PATCH(request: NextRequest, { params }: { params: { userId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const userId = params.userId
  const body = await request.json()
  const { status } = body

  if (!status || !['ACTIVE', 'INACTIVE'].includes(status)) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'status phải là ACTIVE hoặc INACTIVE' } }, { status: 400 })
  }

  // Find target user
  const target = await prisma.user.findUnique({ where: { id: userId }, include: { chapter_members: true } })
  if (!target) return NextResponse.json({ error: { code: 'UserNotFound', message: 'Người dùng không tồn tại' } }, { status: 404 })

  // Admin can update any non-Admin; BĐHU can only update MEMBERS in their chapter
  if ((auth as any).context!.role === 'ADMIN') {
    // Admin not allowed to set another Admin to INACTIVE
    if (target.role === 'ADMIN' && status === 'INACTIVE') {
      return NextResponse.json({ error: { code: 'InvalidTransition', message: 'Không thể vô hiệu hóa Admin khác qua API' } }, { status: 403 })
    }
  } else if ((auth as any).context!.role === 'CHAPTER_LEADER') {
    // BĐHU can only update members in their chapter; not Admin, not themselves
    const membership = await prisma.chapterMember.findFirst({ where: { user_id: userId, chapter_id: (auth as any).context!.chapterId } })
    if (!membership) return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ quản lý thành viên trong chapter mình' } }, { status: 403 })
    if (target.role === 'ADMIN' || target.role === 'CHAPTER_LEADER') {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'Không thể thay đổi trạng thái Admin/BĐHU' } }, { status: 403 })
    }
  } else {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Không có quyền' } }, { status: 403 })
  }

  // Update status + audit
  const updated = await prisma.user.update({ where: { id: userId }, data: { status: status as any } })

  // Invalidate caches: auth status (khóa tài khoản có hiệu lực ngay), query và metadata
  invalidateUserAuthCache(userId)
  invalidateServerUsersCache()
  invalidateAdminOverviewCache()

  // Audit log
  await prisma.auditLog.create({
    data: {
      actor_user_id: (auth as any).context!.userId,
      action: 'UPDATE_STATUS',
      entity_type: 'USER',
      entity_id: userId,
      metadata: JSON.stringify({ oldStatus: target.status, newStatus: status }),
    },
  })

  return NextResponse.json({ userId: updated.id, status: updated.status }, { status: 200 })
}
