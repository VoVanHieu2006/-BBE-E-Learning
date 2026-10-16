import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { authenticate, invalidateUserAuthCache } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canAccessOrganizationUnitPermission, memberManagementPermission } from '@/lib/authorization'
import { getOrganizationUnitTreeIds, reconcileLearningAssignmentsForUser } from '@/lib/learning-assignments'
import { listChapterMembers } from '@/lib/chapter-members'
import { isOrganizationId, normalizeOrganizationPagination, normalizeOrganizationSearch } from '@/lib/organization-admin-rules'
import { calculateBatchUsersProgress, getPublishedSystemData } from '@/lib/progress/calculator'
import { canViewInactiveChapterMember } from '@/lib/inactive-member-access'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function findParentChapter(unitId: string): Promise<{ id: string; organizationUnitId: string } | null> {
  const visited = new Set<string>()
  let currentId: string | null = unitId
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const current: { id: string; type: string; parent_id: string | null; chapter: { id: string } | null } | null = await prisma.organizationUnit.findUnique({
      where: { id: currentId },
      select: { id: true, type: true, parent_id: true, chapter: { select: { id: true } } },
    })
    if (!current) return null
    if (current.type === 'CHAPTER' && current.chapter) return { id: current.chapter.id, organizationUnitId: current.id }
    currentId = current.parent_id
  }
  return null
}

/** A manager can see only members attached to this authorized unit subtree. */
export async function GET(request: NextRequest, { params }: { params: { unitId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (!isOrganizationId(params.unitId)) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
  if (!await canAccessOrganizationUnitPermission(auth.context!, params.unitId, 'VIEW_MEMBER_PROGRESS')) {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }

  const unit = await prisma.organizationUnit.findUnique({
    where: { id: params.unitId },
    select: { id: true, name: true, type: true, chapter: { select: { id: true } } },
  })
  if (!unit) return NextResponse.json({ error: { code: 'OrganizationUnitNotFound' } }, { status: 404 })

  const paramsUrl = new URL(request.url).searchParams
  const search = normalizeOrganizationSearch(paramsUrl.get('search'))
  const includeInactive = paramsUrl.get('includeInactive') === '1'
  if (includeInactive && !(auth.context!.role === 'ADMIN' || (unit.chapter && await canViewInactiveChapterMember(auth.context!, unit.chapter.id)))) {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }
  const now = new Date()
  let members: Array<{ userId: string; email: string; role: string; status: string; joinedAt: Date }> = []

  if (unit.chapter) {
    const chapterRows = await listChapterMembers(unit.chapter.id, {
      roles: ['MEMBER'],
      status: includeInactive ? undefined : 'ACTIVE',
      search,
    })
    members = chapterRows.map((row) => ({
      userId: row.userId,
      email: row.email,
      role: row.role,
      status: row.status,
      joinedAt: row.joinedAt,
    }))
  } else {
    const unitIds = await getOrganizationUnitTreeIds(unit.id)
    const rows = await prisma.organizationMembership.findMany({
      where: {
        unit_id: { in: unitIds },
        status: 'ACTIVE',
        starts_at: { lte: now },
        OR: [{ ends_at: null }, { ends_at: { gt: now } }],
        user: {
          role: 'MEMBER',
          position_assignments: { none: { position: { code: 'DNA_LEAD' }, starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] } },
          ...(includeInactive ? {} : { status: 'ACTIVE' }),
          ...(search ? { email: { contains: search, mode: 'insensitive' } } : {}),
        },
      },
      select: {
        starts_at: true,
        user: { select: { id: true, email: true, role: true, status: true } },
      },
      orderBy: { starts_at: 'asc' },
    })
    const byUser = new Map<string, (typeof members)[number]>()
    for (const row of rows) {
      if (!byUser.has(row.user.id)) byUser.set(row.user.id, {
        userId: row.user.id,
        email: row.user.email,
        role: row.user.role,
        status: row.user.status,
        joinedAt: row.starts_at,
      })
    }
    members = Array.from(byUser.values())
  }

  members.sort((a, b) => a.email.localeCompare(b.email))
  const pagination = normalizeOrganizationPagination(paramsUrl.get('page'), paramsUrl.get('limit'), members.length, 20, 50)
  const pageMembers = members.slice(pagination.skip, pagination.skip + pagination.limit)
  const userIds = pageMembers.map((member) => member.userId)
  const system = await getPublishedSystemData()
  const [progress, starRows, canManageMembers, affiliationRows, positionRows, userRows] = await Promise.all([
    calculateBatchUsersProgress(userIds, system),
    userIds.length
      ? prisma.starLedger.groupBy({ where: { user_id: { in: userIds } }, by: ['user_id'], _sum: { amount: true } })
      : Promise.resolve([]),
    canAccessOrganizationUnitPermission(auth.context!, unit.id, memberManagementPermission(unit.type)),
    prisma.organizationMembership.findMany({
      where: { user_id: { in: userIds }, status: 'ACTIVE', starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
      select: { user_id: true, unit: { select: { id: true, name: true, type: true, parent: { select: { id: true, name: true, type: true } } } } },
    }),
    prisma.positionAssignment.findMany({
      where: { user_id: { in: userIds }, starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
      select: { user_id: true, position: { select: { code: true, name: true, scope: true } }, unit: { select: { id: true, name: true, type: true } } },
    }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, display_name: true } }),
  ])
  const starsByUser = new Map(starRows.map((row) => [row.user_id, row._sum.amount || 0]))
  const namesByUser = new Map(userRows.map((row) => [row.id, row.display_name]))
  const items = pageMembers.map((member) => {
    const summary = progress.get(member.userId)
    const affiliations = affiliationRows.filter((row) => row.user_id === member.userId).map((row) => row.unit)
    const department = affiliations.find((candidate) => candidate.type === 'DEPARTMENT')
    const dna = affiliations.find((candidate) => candidate.type === 'DNA' || candidate.type === 'DNA_GROUP')
    return {
      ...member,
      displayName: namesByUser.get(member.userId) || null,
      department: department ? { id: department.id, name: department.name } : null,
      dna: dna ? { active: true, name: dna.type === 'DNA' ? dna.name : dna.parent?.name, group: dna.type === 'DNA_GROUP' ? dna.name : null } : { active: false, name: null, group: null },
      positions: positionRows.filter((row) => row.user_id === member.userId).map((row) => ({ ...row.position, unitName: row.unit.name })),
      completedCourses: summary?.completedCourses || 0,
      totalCourses: system.totalCourses,
      completedLessons: summary?.completedLessons || 0,
      totalLessons: system.totalLessons,
      progressPercent: summary?.overallProgressPercent || 0,
      stars: starsByUser.get(member.userId) || 0,
    }
  })

  return NextResponse.json({
    unit: { id: unit.id, name: unit.name, type: unit.type },
    canManageMembers,
    items,
    pagination: { page: pagination.page, limit: pagination.limit, total: pagination.total, totalPages: pagination.totalPages },
  })
}

/** Adds an existing active learner to the unit or ends their membership in this unit subtree. */
export async function POST(request: NextRequest, { params }: { params: { unitId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (!isOrganizationId(params.unitId)) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })

  const unit = await prisma.organizationUnit.findUnique({ where: { id: params.unitId }, select: { id: true, type: true, status: true } })
  if (!unit || unit.status !== 'ACTIVE') return NextResponse.json({ error: { code: 'OrganizationUnitNotFound' } }, { status: 404 })
  if (!await canAccessOrganizationUnitPermission(auth.context!, unit.id, memberManagementPermission(unit.type))) {
    return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  }
  const unitIds = await getOrganizationUnitTreeIds(unit.id)
  const parentChapter = await findParentChapter(unit.id)

  if (body.action === 'ADD_MEMBER') {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!EMAIL_REGEX.test(email) || email.length > 255) return NextResponse.json({ error: { code: 'ValidationError', message: 'A valid member email is required.' } }, { status: 400 })
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, status: true } })
    if (!user || user.role !== 'MEMBER') return NextResponse.json({ error: { code: 'MemberNotFound' } }, { status: 404 })
    if (user.status !== 'ACTIVE') return NextResponse.json({ error: { code: 'AccountInactive', message: 'Only an already-active account can be added; only Admin can unlock accounts.' } }, { status: 409 })
    const existing = await prisma.organizationMembership.findFirst({
      where: { user_id: user.id, unit_id: unit.id, status: 'ACTIVE', starts_at: { lte: new Date() }, OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }] },
      select: { id: true },
    })
    if (existing) return NextResponse.json({ error: { code: 'MembershipExists' } }, { status: 409 })
    if (parentChapter) {
      const otherChapter = await prisma.chapterMember.findFirst({
        where: { user_id: user.id, chapter_id: { not: parentChapter.id } },
        select: { chapter: { select: { name: true } } },
      })
      if (otherChapter) return NextResponse.json({ error: { code: 'ChapterMembershipConflict', message: `Email này đã thuộc ${otherChapter.chapter.name}; mỗi tài khoản chỉ được thuộc một Chapter.` } }, { status: 409 })
    }
    try {
      const membership = await prisma.$transaction(async (tx) => {
        const created = await tx.organizationMembership.create({ data: { user_id: user.id, unit_id: unit.id } })
        if (parentChapter) {
          await tx.chapterMember.upsert({
            where: { chapter_id_user_id: { chapter_id: parentChapter.id, user_id: user.id } },
            create: { chapter_id: parentChapter.id, user_id: user.id },
            update: {},
          })
        }
        await tx.auditLog.create({
          data: {
            actor_user_id: auth.context!.userId,
            action: 'ADD_ORGANIZATION_MEMBER',
            entity_type: 'ORGANIZATION_MEMBERSHIP',
            entity_id: created.id,
            metadata: { unitId: unit.id, userId: user.id },
          },
        })
        return created
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
      await reconcileLearningAssignmentsForUser(user.id)
      invalidateUserAuthCache(user.id)
      return NextResponse.json({ membership }, { status: 201 })
    } catch (error: any) {
      if (error?.code === 'P2034') return NextResponse.json({ error: { code: 'MembershipChangedConcurrently' } }, { status: 409 })
      if (error?.code === 'P2002') return NextResponse.json({ error: { code: 'MembershipExists' } }, { status: 409 })
      throw error
    }
  }

  if (body.action === 'REMOVE_MEMBER') {
    if (!isOrganizationId(body.userId)) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
    const active = await prisma.organizationMembership.findMany({
      where: { user_id: body.userId, unit_id: { in: unitIds }, status: 'ACTIVE', starts_at: { lte: new Date() }, OR: [{ ends_at: null }, { ends_at: { gt: new Date() } }] },
      select: { id: true },
    })
    if (!active.length) return NextResponse.json({ error: { code: 'MembershipNotFound' } }, { status: 404 })
    const now = new Date()
    await prisma.$transaction(async (tx) => {
      await tx.organizationMembership.updateMany({ where: { id: { in: active.map((item) => item.id) } }, data: { status: 'ENDED', ends_at: now } })
      await tx.auditLog.create({
        data: {
          actor_user_id: auth.context!.userId,
          action: 'REMOVE_ORGANIZATION_MEMBER',
          entity_type: 'ORGANIZATION_MEMBERSHIP',
          entity_id: active[0].id,
          metadata: { unitId: unit.id, userId: body.userId, endedMembershipIds: active.map((item) => item.id) },
        },
      })
      if (parentChapter) {
        const chapterUnitIds = await getOrganizationUnitTreeIds(parentChapter.organizationUnitId)
        const stillInChapter = await tx.organizationMembership.count({
          where: { user_id: body.userId, unit_id: { in: chapterUnitIds }, status: 'ACTIVE', starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
        })
        if (!stillInChapter) await tx.chapterMember.deleteMany({ where: { chapter_id: parentChapter.id, user_id: body.userId } })
      }
    })
    await reconcileLearningAssignmentsForUser(body.userId)
    invalidateUserAuthCache(body.userId)
    return NextResponse.json({ removed: true, endedMemberships: active.length })
  }

  return NextResponse.json({ error: { code: 'UnknownAction' } }, { status: 400 })
}
