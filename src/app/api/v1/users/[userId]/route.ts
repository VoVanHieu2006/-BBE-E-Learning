import { NextRequest, NextResponse } from 'next/server'
import { authenticate, invalidateUserAuthCache } from '@/lib/auth'
import { canAccessChapterPermission } from '@/lib/authorization'
import { getOrganizationUnitTreeIds } from '@/lib/learning-assignments'
import { prisma } from '@/lib/prisma'
import { invalidateServerUsersCache, invalidateAdminOverviewCache } from '@/lib/server-cache'
import { createChapterCascadeRestrictions, getChapterAccountUserIds, getUserManagedChapterScopes, hasActiveAccountRestrictions } from '@/lib/account-restrictions'
import { invalidateChapterLeaderboardCache } from '@/lib/chapter-leaderboard-cache'
import { invalidateMemberLeaderboardCache } from '@/lib/member-leaderboard-cache'

import { assertCanChangeUserStatus } from '@/lib/user-status-rules'

export async function PATCH(request: NextRequest, { params }: { params: { userId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const userId = params.userId
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Request body không hợp lệ' } }, { status: 400 })
  }
  const { status, chapterId, extensionDays } = body as { status?: unknown; chapterId?: unknown; extensionDays?: unknown }

  if (typeof status !== 'string' || !['ACTIVE', 'INACTIVE'].includes(status)) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'status phải là ACTIVE hoặc INACTIVE' } }, { status: 400 })
  }

  // Find target user
  const target = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      chapter_members: true,
      restrictions: { where: { lifted_at: null }, orderBy: { created_at: 'desc' } },
    },
  })
  if (!target) return NextResponse.json({ error: { code: 'UserNotFound', message: 'Người dùng không tồn tại' } }, { status: 404 })

  if (target.anonymized_at) return NextResponse.json({ error: { code: 'AccountRetired' } }, { status: 409 })

  const actor = auth.context!
  const isAdmin = actor.role === 'ADMIN'

  // Centralized status change guard
  const guard = assertCanChangeUserStatus(actor, target, status as 'ACTIVE' | 'INACTIVE')
  if (!guard.allowed) {
    return NextResponse.json({ error: { code: guard.code, message: guard.message } }, { status: 403 })
  }

  // If actor is not Admin (i.e. Chapter Leader or Unit Manager)
  if (!isAdmin) {
    // Verify target belongs to the managed Chapter
    const managedChapterId = (typeof chapterId === 'string' && chapterId) ? chapterId : actor.chapterId
    if (!managedChapterId) {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'Thiếu thông tin Chapter quản lý.' } }, { status: 403 })
    }

    const hasPermission = actor.role === 'CHAPTER_LEADER'
      ? actor.chapterId === managedChapterId
      : await canAccessChapterPermission(actor, managedChapterId, 'MANAGE_CHAPTER_MEMBERS')
    if (!hasPermission) {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'Không có quyền quản lý thành viên trong Chapter này.' } }, { status: 403 })
    }

    const chapter = await prisma.chapter.findUnique({ where: { id: managedChapterId }, select: { organization_unit_id: true } })
    const unitIds = chapter?.organization_unit_id ? await getOrganizationUnitTreeIds(chapter.organization_unit_id) : []
    const [legacyMembership, orgMembership] = await Promise.all([
      prisma.chapterMember.findFirst({ where: { user_id: userId, chapter_id: managedChapterId }, select: { id: true } }),
      unitIds.length
        ? prisma.organizationMembership.findFirst({
            where: { user_id: userId, unit_id: { in: unitIds }, status: 'ACTIVE', starts_at: { lte: new Date() }, OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }] },
            select: { id: true },
          })
        : Promise.resolve(null),
    ])

    if (!legacyMembership && !orgMembership) {
      return NextResponse.json({ error: { code: 'AccessDenied', message: 'Người dùng không phải thành viên của Chapter được quản lý.' } }, { status: 403 })
    }
  }

  // TRANSACTION: Execute status transition
  const result = await prisma.$transaction(async (tx) => {
    let affectedUserIds: string[] = [userId]

    if (status === 'INACTIVE') {
      // 1. Check if deactivating a Chapter Leader by Admin -> Cascade deactivation to active members
      const isLead = target.role === 'CHAPTER_LEADER'
      const cascadeScopes = (isAdmin && isLead) ? await getUserManagedChapterScopes(userId, true, tx) : []

      if (cascadeScopes.length) {
        for (const scope of cascadeScopes) {
          const chapterUserIds = await getChapterAccountUserIds(scope.chapterId, tx)
          // Only cascade deactivate members who are CURRENTLY ACTIVE (do not override previously deactivated members)
          const activeMembers = await tx.user.findMany({
            where: {
              id: { in: chapterUserIds.filter((id) => id !== userId) },
              role: { not: 'ADMIN' },
              status: 'ACTIVE',
            },
            select: { id: true },
          })
          const activeMemberIds = activeMembers.map((m) => m.id)

          if (activeMemberIds.length > 0) {
            await tx.user.updateMany({
              where: { id: { in: activeMemberIds } },
              data: {
                status: 'INACTIVE',
                cascade_lead_id: userId,
                deactivated_by_user_id: actor.userId,
                deactivated_by_role: 'ADMIN',
                deactivated_at: new Date(),
                auth_version: { increment: 1 },
              },
            })
            affectedUserIds.push(...activeMemberIds)
          }
        }
      }

      // Deactivate target user
      await tx.user.update({
        where: { id: userId },
        data: {
          status: 'INACTIVE',
          deactivated_by_user_id: actor.userId,
          deactivated_by_role: isAdmin ? 'ADMIN' : 'LEAD',
          deactivated_at: target.status === 'INACTIVE' ? target.deactivated_at : new Date(),
          cascade_lead_id: null,
          auth_version: { increment: 1 },
        },
      })

      // Lift any active restrictions if turning into INACTIVE
      await tx.accessRestriction.updateMany({
        where: { user_id: userId, lifted_at: null, type: { not: 'DEADLINE' } },
        data: { lifted_at: new Date(), lifted_by_user_id: actor.userId },
      })
    } else {
      // 2. Reactivating account (status: ACTIVE)
      // If activating a Chapter Leader by Admin -> Auto-reactivate members that were cascade-deactivated by this Lead
      if (isAdmin && (target.role === 'CHAPTER_LEADER' || target.cascade_lead_id)) {
        const cascadedMembers = await tx.user.findMany({
          where: { cascade_lead_id: userId, status: 'INACTIVE', anonymized_at: null },
          select: { id: true },
        })
        const cascadedMemberIds = cascadedMembers.map((m) => m.id)

        if (cascadedMemberIds.length > 0) {
          await tx.user.updateMany({
            where: { id: { in: cascadedMemberIds } },
            data: {
              status: 'ACTIVE',
              cascade_lead_id: null,
              deactivated_by_user_id: null,
              deactivated_by_role: null,
              deactivated_at: null,
              auth_version: { increment: 1 },
            },
          })
          affectedUserIds.push(...cascadedMemberIds)
        }
      }

      // If user was locked due to DEADLINE / Overdue learning: extend deadlines if requested
      const hasDeadlineLock = target.restrictions.some((r) => r.type === 'DEADLINE')
      if (isAdmin && (target.status === 'LOCKED' || hasDeadlineLock)) {
        const extDays = Math.max(1, Math.min(365, Number(extensionDays) || 7))
        const newDueAt = new Date(Date.now() + extDays * 24 * 60 * 60 * 1000)

        // Extend all overdue mandatory assignments for this user
        await tx.userLearningAssignment.updateMany({
          where: { user_id: userId, status: 'OVERDUE' },
          data: { status: 'IN_PROGRESS', due_at: newDueAt },
        })
      }

      // Lift all active restrictions for this user
      await tx.accessRestriction.updateMany({
        where: { user_id: userId, lifted_at: null },
        data: { lifted_at: new Date(), lifted_by_user_id: actor.userId },
      })

      // Update target user to ACTIVE
      await tx.user.update({
        where: { id: userId },
        data: {
          status: 'ACTIVE',
          failed_login_count: 0,
          locked_until: null,
          lock_reason: null,
          cascade_lead_id: null,
          deactivated_by_user_id: null,
          deactivated_by_role: null,
          deactivated_at: null,
          auth_version: { increment: 1 },
        },
      })
    }

    // Audit log
    await tx.auditLog.create({
      data: {
        actor_user_id: actor.userId,
        action: 'UPDATE_STATUS',
        entity_type: 'USER',
        entity_id: userId,
        metadata: JSON.stringify({
          oldStatus: target.status,
          newStatus: status,
          extensionDays: status === 'ACTIVE' ? extensionDays : undefined,
          cascadedCount: affectedUserIds.length - 1,
        }),
      },
    })

    return { affectedUserIds }
  })

  // Invalidate auth and data caches
  result.affectedUserIds.forEach(invalidateUserAuthCache)
  invalidateServerUsersCache()
  invalidateAdminOverviewCache()
  invalidateChapterLeaderboardCache()
  invalidateMemberLeaderboardCache()

  return NextResponse.json({
    userId,
    status,
    affectedCount: result.affectedUserIds.length,
  }, { status: 200 })
}
