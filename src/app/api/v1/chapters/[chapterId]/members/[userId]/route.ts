import { NextRequest, NextResponse } from 'next/server'
import { authenticate, invalidateUserAuthCache } from '@/lib/auth'
import { canAccessChapterPermission } from '@/lib/authorization'
import { getOrganizationUnitTreeIds, reconcileLearningAssignmentsForUser } from '@/lib/learning-assignments'
import { prisma } from '@/lib/prisma'

export async function DELETE(request: NextRequest, { params }: { params: { chapterId: string; userId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const { chapterId, userId } = params
  if (!chapterId || !userId) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Thiếu chapterId hoặc userId' } }, { status: 400 })
  }

  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId }, select: { id: true, organization_unit_id: true } })
  if (!chapter) return NextResponse.json({ error: { code: 'ChapterNotFound', message: 'Không tìm thấy chapter' } }, { status: 404 })

  // Removing a member requires management permission; progress visibility alone
  // must never allow changing organization membership or a position assignment.
  if (!await canAccessChapterPermission(auth.context!, chapterId, 'MANAGE_CHAPTER_MEMBERS')) {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Không có quyền' } }, { status: 403 })
  }

  const unitIds = chapter.organization_unit_id ? await getOrganizationUnitTreeIds(chapter.organization_unit_id) : []
  const now = new Date()
  const result = await prisma.$transaction(async (tx) => {
    const [legacyMembership, organizationMemberships, positions] = await Promise.all([
      tx.chapterMember.findFirst({ where: { chapter_id: chapterId, user_id: userId } }),
      unitIds.length
        ? tx.organizationMembership.findMany({
            where: { user_id: userId, unit_id: { in: unitIds }, status: 'ACTIVE' },
            select: { id: true, starts_at: true },
          })
        : Promise.resolve([]),
      unitIds.length
        ? tx.positionAssignment.findMany({
            where: { user_id: userId, unit_id: { in: unitIds }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
            select: { id: true, starts_at: true },
          })
        : Promise.resolve([]),
    ])

    if (!legacyMembership && organizationMemberships.length === 0) return null

    if (legacyMembership) await tx.chapterMember.delete({ where: { id: legacyMembership.id } })

    for (const membership of organizationMemberships) {
      await tx.organizationMembership.update({
        where: { id: membership.id },
        data: { status: 'ENDED', ends_at: membership.starts_at > now ? membership.starts_at : now },
      })
    }

    for (const position of positions) {
      await tx.positionAssignment.update({
        where: { id: position.id },
        data: { ends_at: position.starts_at > now ? position.starts_at : now },
      })
    }

    await tx.auditLog.create({
      data: {
        actor_user_id: auth.context!.userId,
        action: 'REMOVE_FROM_CHAPTER',
        entity_type: legacyMembership ? 'CHAPTER_MEMBER' : 'ORGANIZATION_MEMBERSHIP',
        entity_id: legacyMembership?.id || organizationMemberships[0]?.id || userId,
        metadata: JSON.stringify({
          chapterId,
          userId,
          endedOrganizationMembershipIds: organizationMemberships.map((item) => item.id),
          endedPositionAssignmentIds: positions.map((item) => item.id),
        }),
      },
    })

    // Make the entitlement change and learning-path reconciliation atomic.
    await reconcileLearningAssignmentsForUser(userId, tx)
    return {
      endedOrganizationMemberships: organizationMemberships.length,
      endedPositionAssignments: positions.length,
    }
  })

  if (!result) {
    return NextResponse.json({ error: { code: 'MembershipNotFound', message: 'Thành viên không thuộc chapter này' } }, { status: 404 })
  }

  // A legacy Chapter Leader's JWT can carry the Chapter scope claim. Clear the
  // auth cache so the next request resolves that scope from current membership.
  invalidateUserAuthCache(userId)

  return NextResponse.json({
    userId,
    chapterId,
    membershipStatus: 'LEFT',
    ...result,
  }, { status: 200 })
}
