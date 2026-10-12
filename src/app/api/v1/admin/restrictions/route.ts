import { NextRequest, NextResponse } from 'next/server'
import { authenticate, invalidateUserAuthCache } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createChapterCascadeRestrictions, getChapterAccountUserIds, getUserManagedChapterScopes, getUsersWithActiveAccountRestrictions } from '@/lib/account-restrictions'
import { canActivateAfterRestrictionLift } from '@/lib/account-restriction-rules'
import { isOrganizationId } from '@/lib/organization-admin-rules'

/** Admin-only account locking with an auditable cause. BĐHU/DNA managers never unlock accounts. */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context?.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })

  const url = new URL(request.url)
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50))
  const [items, total] = await Promise.all([
    prisma.accessRestriction.findMany({
      include: {
        user: { select: { id: true, email: true } },
        organization_unit: { select: { id: true, name: true, type: true, chapter: { select: { id: true, name: true } } } },
        created_by: { select: { id: true, email: true } },
        lifted_by: { select: { id: true, email: true } },
      },
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.accessRestriction.count(),
  ])
  return NextResponse.json({ items, total, page, limit, totalPages: Math.ceil(total / limit) })
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const actor = auth.context!
  if (actor.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied', message: 'Only Admin can change account locks.' } }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: { code: 'ValidationError', message: 'Request body must be an object.' } }, { status: 400 })
  if (body.action !== undefined && !['LOCK', 'LIFT'].includes(body.action)) return NextResponse.json({ error: { code: 'ValidationError', message: 'action must be LOCK or LIFT.' } }, { status: 400 })
  if (body.targetType !== undefined && !['USER', 'CHAPTER'].includes(body.targetType)) return NextResponse.json({ error: { code: 'ValidationError', message: 'targetType must be USER or CHAPTER.' } }, { status: 400 })
  if (body.reasonType !== undefined && !['DIRECT_ADMIN', 'DEADLINE'].includes(body.reasonType)) return NextResponse.json({ error: { code: 'ValidationError', message: 'reasonType must be DIRECT_ADMIN or DEADLINE.' } }, { status: 400 })
  if (body.sourceReference !== undefined && body.sourceReference !== null && (typeof body.sourceReference !== 'string' || body.sourceReference.length > 255)) return NextResponse.json({ error: { code: 'ValidationError', message: 'sourceReference must be at most 255 characters.' } }, { status: 400 })
  const action = body.action === 'LIFT' ? 'LIFT' : 'LOCK'
  const targetType = body.targetType === 'CHAPTER' ? 'CHAPTER' : 'USER'
  const targetId = typeof body.targetId === 'string' ? body.targetId : ''
  if (!isOrganizationId(targetId)) return NextResponse.json({ error: { code: 'ValidationError', message: 'targetId must be a valid ID.' } }, { status: 400 })

  if (targetType === 'USER') {
    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, role: true } })
    if (!target) return NextResponse.json({ error: { code: 'NotFound', message: 'User not found.' } }, { status: 404 })
    if (action === 'LOCK') {
      if (target.role === 'ADMIN') return NextResponse.json({ error: { code: 'InvalidTransition', message: 'Admin accounts cannot be locked through this endpoint.' } }, { status: 403 })
      const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'Locked by Admin'
      const type = body.reasonType === 'DEADLINE' ? 'DEADLINE' : 'DIRECT_ADMIN'
      const cascadeChapters = type === 'DIRECT_ADMIN' ? await getUserManagedChapterScopes(targetId, target.role === 'CHAPTER_LEADER') : []
      if (cascadeChapters.some((chapter) => !chapter.organizationUnitId)) {
        return NextResponse.json({ error: { code: 'ChapterOrganizationMissing', message: 'Cannot cascade-lock a Chapter until its organization unit is configured.' } }, { status: 409 })
      }
      const result = await prisma.$transaction(async (tx) => {
        const ids = new Set<string>([targetId])
        const usersByChapter = new Map<string, Set<string>>()
        for (const chapter of cascadeChapters) {
          const scopedIds = new Set([targetId, ...await getChapterAccountUserIds(chapter.chapterId, tx)])
          usersByChapter.set(chapter.chapterId, scopedIds)
          scopedIds.forEach((memberId) => ids.add(memberId))
        }
        const eligibleUsers = await tx.user.findMany({ where: { id: { in: Array.from(ids) }, role: { not: 'ADMIN' } }, select: { id: true } })
        const lockedUserIds = eligibleUsers.map((user) => user.id)
        await tx.user.updateMany({ where: { id: { in: lockedUserIds } }, data: { status: 'LOCKED', auth_version: { increment: 1 } } })
        const restriction = await tx.accessRestriction.create({ data: { user_id: targetId, type, reason, source_reference: typeof body.sourceReference === 'string' ? body.sourceReference : null, created_by_user_id: actor.userId } })
        for (const chapter of cascadeChapters) {
          const sourceReference = `admin-lock:${targetId}:${chapter.chapterId}`
          await createChapterCascadeRestrictions(tx, {
            organizationUnitId: chapter.organizationUnitId!,
            userIds: lockedUserIds.filter((memberId) => usersByChapter.get(chapter.chapterId)?.has(memberId)),
            reason,
            createdByUserId: actor.userId,
            sourceReference,
          })
        }
        return { restriction, lockedUserIds }
      })
      result.lockedUserIds.forEach(invalidateUserAuthCache)
      return NextResponse.json({ restriction: result.restriction, status: 'LOCKED', cascadedChapterIds: cascadeChapters.map((chapter) => chapter.chapterId), lockedUsers: result.lockedUserIds.length }, { status: 201 })
    }

    await prisma.$transaction(async (tx) => {
      await tx.accessRestriction.updateMany({ where: { user_id: targetId, lifted_at: null }, data: { lifted_at: new Date(), lifted_by_user_id: actor.userId } })
      // A Chapter cascade also covers OrganizationMembership and active tenures,
      // not only the legacy chapter_members join table.
      const stillRestricted = await getUsersWithActiveAccountRestrictions([targetId], tx)
      if (canActivateAfterRestrictionLift(stillRestricted.has(targetId))) {
        await tx.user.update({ where: { id: targetId }, data: { status: 'ACTIVE', auth_version: { increment: 1 } } })
      }
    })
    invalidateUserAuthCache(targetId)
    const stillRestricted = await getUsersWithActiveAccountRestrictions([targetId])
    return NextResponse.json({ userId: targetId, unlocked: !stillRestricted.has(targetId), remainingRestriction: stillRestricted.has(targetId) ? 'CHAPTER_CASCADE' : null })
  }

  const chapter = await prisma.chapter.findUnique({ where: { id: targetId }, select: { id: true, organization_unit_id: true } })
  if (!chapter?.organization_unit_id) return NextResponse.json({ error: { code: 'ChapterOrganizationMissing', message: 'Chapter must be migrated to an organization unit first.' } }, { status: 409 })
  const memberIds = await getChapterAccountUserIds(chapter.id)
  const memberAccountIds = (await prisma.user.findMany({ where: { id: { in: memberIds }, role: { not: 'ADMIN' } }, select: { id: true } })).map((user) => user.id)
  if (action === 'LOCK') {
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'Primary BĐHU disabled; Chapter accounts locked.'
    const restriction = await prisma.$transaction(async (tx) => {
      await tx.user.updateMany({ where: { id: { in: memberAccountIds } }, data: { status: 'LOCKED', auth_version: { increment: 1 } } })
      return createChapterCascadeRestrictions(tx, {
        organizationUnitId: chapter.organization_unit_id!,
        userIds: memberAccountIds,
        reason,
        createdByUserId: actor.userId,
        sourceReference: typeof body.sourceReference === 'string' && body.sourceReference.trim()
          ? body.sourceReference.trim()
          : `admin-chapter-lock:${chapter.id}:${Date.now()}`,
      })
    })
    memberAccountIds.forEach(invalidateUserAuthCache)
    return NextResponse.json({ restriction, lockedUsers: memberAccountIds.length }, { status: 201 })
  }

  const unlockedUserIds = await prisma.$transaction(async (tx) => {
    await tx.accessRestriction.updateMany({ where: { organization_unit_id: chapter.organization_unit_id!, type: 'CHAPTER_CASCADE', lifted_at: null }, data: { lifted_at: new Date(), lifted_by_user_id: actor.userId } })
    const stillRestricted = await getUsersWithActiveAccountRestrictions(memberAccountIds, tx)
    const canUnlock = memberAccountIds.filter((id) => !stillRestricted.has(id))
    await tx.user.updateMany({ where: { id: { in: canUnlock } }, data: { status: 'ACTIVE', auth_version: { increment: 1 } } })
    return canUnlock
  })
  memberAccountIds.forEach(invalidateUserAuthCache)
  return NextResponse.json({ chapterId: chapter.id, unlocked: unlockedUserIds.length === memberAccountIds.length, unlockedUsers: unlockedUserIds.length, stillLockedUsers: Math.max(0, memberAccountIds.length - unlockedUserIds.length) })
}
