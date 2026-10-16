import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { canAccessChapterPermission } from '@/lib/authorization'
import { getOrganizationUnitTreeIds } from '@/lib/learning-assignments'
import { prisma } from '@/lib/prisma'

export async function POST(
  request: NextRequest,
  { params }: { params: { chapterId: string } }
) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const isLeader = auth.context!.role === 'CHAPTER_LEADER' || auth.context!.role === 'ADMIN'
  const hasPerm = await canAccessChapterPermission(auth.context!, params.chapterId, 'MANAGE_CHAPTER_MEMBERS')
  if (!isLeader && !hasPerm) {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const userIds: string[] = Array.isArray(body?.userIds) ? body.userIds : []
  if (!userIds.length) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Cần danh sách userIds để vô hiệu hóa.' } }, { status: 400 })
  }

  const chapter = await prisma.chapter.findUnique({
    where: { id: params.chapterId },
    select: { id: true, organization_unit_id: true },
  })
  if (!chapter) {
    return NextResponse.json({ error: { code: 'ChapterNotFound' } }, { status: 404 })
  }

  const unitIds = chapter.organization_unit_id
    ? await getOrganizationUnitTreeIds(chapter.organization_unit_id)
    : []

  const now = new Date()

  // Thực hiện vô hiệu hóa
  await prisma.$transaction(async (tx) => {
    // 1. Chuyển User status sang INACTIVE
    await tx.user.updateMany({
      where: { id: { in: userIds } },
      data: { status: 'INACTIVE' },
    })

    // 2. Kết thúc OrganizationMembership trong chapter này
    if (unitIds.length > 0) {
      await tx.organizationMembership.updateMany({
        where: {
          user_id: { in: userIds },
          unit_id: { in: unitIds },
          status: 'ACTIVE',
        },
        data: { status: 'ENDED', ends_at: now },
      })

      // 3. Kết thúc PositionAssignment
      await tx.positionAssignment.updateMany({
        where: {
          user_id: { in: userIds },
          unit_id: { in: unitIds },
          ends_at: null,
        },
        data: { ends_at: now },
      })
    }

    // 4. Ghi Audit Log
    await tx.auditLog.create({
      data: {
        actor_user_id: auth.context!.userId,
        action: 'CHAPTER_MEMBERS_BULK_DEACTIVATE',
        entity_type: 'CHAPTER',
        entity_id: params.chapterId,
        metadata: {
          deactivatedUserIds: userIds,
          count: userIds.length,
          timestamp: now.toISOString(),
        },
      },
    })
  })

  return NextResponse.json({
    success: true,
    count: userIds.length,
    message: `Đã vô hiệu hóa thành công ${userIds.length} thành viên không tham gia nhiệm kỳ mới.`,
  })
}
