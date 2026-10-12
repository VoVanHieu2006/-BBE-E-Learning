import { NextRequest, NextResponse } from 'next/server'
import { authenticate, invalidateUserAuthCache } from '@/lib/auth'
import { canAccessChapterPermission } from '@/lib/authorization'
import { getOrganizationUnitTreeIds } from '@/lib/learning-assignments'
import { prisma } from '@/lib/prisma'
import { invalidateServerUsersCache, invalidateAdminOverviewCache } from '@/lib/server-cache'
import { createChapterCascadeRestrictions, getChapterAccountUserIds, getUserManagedChapterScopes, hasActiveAccountRestrictions } from '@/lib/account-restrictions'

export async function PATCH(request: NextRequest, { params }: { params: { userId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const userId = params.userId
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Request body không hợp lệ' } }, { status: 400 })
  }
  const { status, chapterId } = body as { status?: unknown; chapterId?: unknown }

  if (typeof status !== 'string' || !['ACTIVE', 'INACTIVE'].includes(status)) {
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
    if (status === 'ACTIVE') {
      if (await hasActiveAccountRestrictions(userId)) {
        return NextResponse.json({ error: { code: 'RestrictionLiftRequired', message: 'Lift the active restriction through the Admin restriction endpoint so its audit trail is preserved.' } }, { status: 409 })
      }
    }
  } else if ((auth as any).context!.role === 'CHAPTER_LEADER') {
    // BĐHU can only update members in their chapter; not Admin, not themselves
    const membership = await prisma.chapterMember.findFirst({ where: { user_id: userId, chapter_id: (auth as any).context!.chapterId } })
    if (!membership) return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ quản lý thành viên trong chapter mình' } }, { status: 403 })
    if (target.role === 'ADMIN' || target.role === 'CHAPTER_LEADER') {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'Không thể thay đổi trạng thái Admin/BĐHU' } }, { status: 403 })
    }
    if (target.status !== 'ACTIVE') {
      return NextResponse.json({ error: { code: 'AdminUnlockRequired', message: 'Tài khoản không ở trạng thái ACTIVE; chỉ Admin mới xử lý mở khóa hoặc thay đổi trạng thái này.' } }, { status: 409 })
    }
    if (status === 'ACTIVE') {
      return NextResponse.json({ error: { code: 'AdminUnlockRequired', message: 'Only Admin can restore an inactive or locked account.' } }, { status: 403 })
    }
  } else {
    // New position-based managers may only disable an active ordinary member
    // within the explicitly selected Chapter. Account reactivation and locked
    // accounts remain Admin-only, regardless of the manager's other permissions.
    const managedChapterId = typeof chapterId === 'string' ? chapterId : ''
    if (status === 'ACTIVE') {
      return NextResponse.json({ error: { code: 'AdminUnlockRequired', message: 'Only Admin can restore an inactive or locked account.' } }, { status: 403 })
    }
    if (!managedChapterId || target.role !== 'MEMBER' || target.id === auth.context!.userId) {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ có thể vô hiệu hóa thành viên thường trong chapter được quản lý.' } }, { status: 403 })
    }
    if (!await canAccessChapterPermission(auth.context!, managedChapterId, 'MANAGE_CHAPTER_MEMBERS')) {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'Không có quyền quản lý thành viên trong chapter này.' } }, { status: 403 })
    }
    if (target.status !== 'ACTIVE') {
      return NextResponse.json({ error: { code: 'AdminUnlockRequired', message: 'Tài khoản không ở trạng thái ACTIVE; chỉ Admin mới xử lý mở khóa hoặc thay đổi trạng thái này.' } }, { status: 409 })
    }

    const chapter = await prisma.chapter.findUnique({ where: { id: managedChapterId }, select: { organization_unit_id: true } })
    if (!chapter) return NextResponse.json({ error: { code: 'ChapterNotFound', message: 'Không tìm thấy chapter' } }, { status: 404 })
    const unitIds = chapter.organization_unit_id ? await getOrganizationUnitTreeIds(chapter.organization_unit_id) : []
    const [legacyMembership, organizationMembership] = await Promise.all([
      prisma.chapterMember.findFirst({ where: { user_id: userId, chapter_id: managedChapterId }, select: { id: true } }),
      unitIds.length
        ? prisma.organizationMembership.findFirst({
            where: { user_id: userId, unit_id: { in: unitIds }, status: 'ACTIVE', starts_at: { lte: new Date() }, OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }] },
            select: { id: true },
          })
        : Promise.resolve(null),
    ])
    if (!legacyMembership && !organizationMembership) {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'Người dùng không phải thành viên hiện tại của chapter được chọn.' } }, { status: 403 })
    }
  }

  // Legacy CHAPTER_LEADER is retained for compatibility. Disabling this BĐHU
  // creates an auditable Chapter restriction and locks every Chapter member.
  if (auth.context!.role === 'ADMIN' && status === 'INACTIVE') {
    const cascadeChapters = await getUserManagedChapterScopes(userId, target.role === 'CHAPTER_LEADER')
    if (cascadeChapters.length) {
      if (cascadeChapters.some((chapter) => !chapter.organizationUnitId)) {
        return NextResponse.json({ error: { code: 'ChapterOrganizationMissing', message: 'Cannot cascade-lock a Chapter until its organization unit is configured.' } }, { status: 409 })
      }

      const affectedUserIds = await prisma.$transaction(async (tx) => {
        const ids = new Set<string>([userId])
        const usersByChapter = new Map<string, Set<string>>()
        for (const chapter of cascadeChapters) {
          const scopedIds = new Set([userId, ...await getChapterAccountUserIds(chapter.chapterId, tx)])
          usersByChapter.set(chapter.chapterId, scopedIds)
          scopedIds.forEach((memberId) => ids.add(memberId))
        }
        const nonAdminUsers = await tx.user.findMany({ where: { id: { in: Array.from(ids) }, role: { not: 'ADMIN' } }, select: { id: true } })
        const lockedUserIds = nonAdminUsers.map((user) => user.id)
        await tx.user.updateMany({ where: { id: { in: lockedUserIds } }, data: { status: 'LOCKED', auth_version: { increment: 1 } } })
        for (const chapter of cascadeChapters) {
          const sourceReference = `chapter-manager-disabled:${userId}:${chapter.chapterId}`
          await createChapterCascadeRestrictions(tx, {
            organizationUnitId: chapter.organizationUnitId!,
            userIds: lockedUserIds.filter((memberId) => usersByChapter.get(chapter.chapterId)?.has(memberId)),
            reason: 'Chapter manager was disabled by Admin.',
            createdByUserId: auth.context!.userId,
            sourceReference,
          })
        }
        await tx.auditLog.create({
          data: {
            actor_user_id: auth.context!.userId,
            action: 'DISABLE_CHAPTER_MANAGER_CASCADE',
            entity_type: 'USER',
            entity_id: userId,
            metadata: JSON.stringify({ chapterIds: cascadeChapters.map((chapter) => chapter.chapterId), affectedUserIds: lockedUserIds }),
          },
        })
        return lockedUserIds
      })
      affectedUserIds.forEach(invalidateUserAuthCache)
      invalidateServerUsersCache()
      invalidateAdminOverviewCache()
      return NextResponse.json({ userId, status: 'LOCKED', cascadedChapterIds: cascadeChapters.map((chapter) => chapter.chapterId), lockedUsers: affectedUserIds.length }, { status: 200 })
    }
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
