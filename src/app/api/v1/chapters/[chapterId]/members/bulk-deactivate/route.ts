import { NextRequest, NextResponse } from 'next/server'
import { authenticate, invalidateUserAuthCache } from '@/lib/auth'
import { lockLearningUser, enqueueAssignmentSync } from '@/lib/learning-periods'
import { canAccessChapterPermission } from '@/lib/authorization'
import { getOrganizationUnitTreeIds } from '@/lib/learning-assignments'
import { prisma } from '@/lib/prisma'
import { invalidateChapterLeaderboardCache } from '@/lib/chapter-leaderboard-cache'
import { invalidateMemberLeaderboardCache } from '@/lib/member-leaderboard-cache'

export async function POST(
  request: NextRequest,
  { params }: { params: { chapterId: string } }
) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const hasPerm = await canAccessChapterPermission(auth.context!, params.chapterId, 'MANAGE_CHAPTER_MEMBERS')
  if (!hasPerm) {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const userIds: string[] = Array.isArray(body?.userIds) ? body.userIds : []
  if (!userIds.length || userIds.length > 500 || new Set(userIds).size !== userIds.length || userIds.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))) {
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
  const scoped = await prisma.user.count({ where: { id: { in: userIds }, role: 'MEMBER', anonymized_at: null, OR: [
    { chapter_members: { some: { chapter_id: params.chapterId } } },
    { organization_memberships: { some: { unit_id: { in: unitIds }, status: 'ACTIVE', ends_at: null } } },
  ] } })
  if (scoped !== userIds.length || userIds.includes(auth.context!.userId)) return NextResponse.json({ error: { code: 'MemberScopeInvalid' } }, { status: 403 })

  // Thực hiện vô hiệu hóa
  await prisma.$transaction(async (tx) => {
    for (const id of [...userIds].sort()) await lockLearningUser(tx, id)
    const members = await tx.chapterMember.count({ where: { user_id: { in: userIds }, chapter_id: params.chapterId } })
    if (members !== userIds.length) throw new Error('MemberScopeChanged')
    const actorRole = auth.context!.role === 'ADMIN' ? 'ADMIN' : 'LEAD'
    await tx.user.updateMany({
      where: { id: { in: userIds }, status: { not: 'INACTIVE' } },
      data: {
        status: 'INACTIVE',
        deactivated_by_user_id: auth.context!.userId,
        deactivated_by_role: actorRole,
        deactivated_at: now,
        auth_version: { increment: 1 },
      },
    })
    for (const id of userIds) await enqueueAssignmentSync(tx, id, `deactivated:${id}:${now.toISOString()}`)

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

  invalidateChapterLeaderboardCache()
  userIds.forEach(invalidateUserAuthCache)
  invalidateMemberLeaderboardCache()
  return NextResponse.json({
    success: true,
    count: userIds.length,
    message: `Đã vô hiệu hóa thành công ${userIds.length} thành viên không tham gia nhiệm kỳ mới.`,
  })
}
