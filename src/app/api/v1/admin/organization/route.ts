import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { authenticate, invalidateUserAuthCache } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { reconcileLearningAssignmentsForUser } from '@/lib/learning-assignments'
import { organizationParentTypeMatches, organizationSubtreeIds, positionScopeMatchesUnitType, validateOrganizationMove } from '@/lib/organization-scope'
import { isOrganizationId, normalizeOrganizationPagination, normalizeOrganizationSearch, parseAssignmentFilterStatus, parseMembershipFilterStatus } from '@/lib/organization-admin-rules'

async function getChapterIdForUnit(unitId: string): Promise<string | null> {
  let currentId: string | null = unitId
  while (currentId) {
    const current = await prisma.organizationUnit.findUnique({
      where: { id: currentId },
      select: { type: true, parent_id: true, chapter: { select: { id: true } } },
    })
    if (!current) return null
    if (current.type === 'CHAPTER') return current.chapter?.id || null
    currentId = current.parent_id
  }
  return null
}

async function getUnitTreeIds(rootId: string): Promise<string[]> {
  const ids = [rootId]
  let parents = [rootId]
  while (parents.length) {
    const children = await prisma.organizationUnit.findMany({ where: { parent_id: { in: parents } }, select: { id: true } })
    parents = children.map((child) => child.id)
    ids.push(...parents)
  }
  return ids
}

/** Admin API for flexible organization, tenure-based positions, and memberships. */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context?.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })

  const params = new URL(request.url).searchParams
  const now = new Date()
  const membershipSearch = normalizeOrganizationSearch(params.get('membershipSearch'))
  const membershipUnitId = params.get('membershipUnitId') || ''
  const membershipStatus = parseMembershipFilterStatus(params.get('membershipStatus'))
  const assignmentSearch = normalizeOrganizationSearch(params.get('assignmentSearch'))
  const assignmentUnitId = params.get('assignmentUnitId') || ''
  const assignmentPositionId = params.get('assignmentPositionId') || ''
  const assignmentStatus = parseAssignmentFilterStatus(params.get('assignmentStatus'))
  if ([membershipUnitId, assignmentUnitId, assignmentPositionId].some((id) => id && !isOrganizationId(id))) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'A filter contains an invalid organization or position ID.' } }, { status: 400 })
  }

  const membershipWhere: Prisma.OrganizationMembershipWhereInput = {
    ...(membershipUnitId ? { unit_id: membershipUnitId } : {}),
    ...(membershipStatus !== 'ALL' ? { status: membershipStatus } : {}),
    ...(membershipSearch ? { OR: [
      { user: { email: { contains: membershipSearch, mode: 'insensitive' } } },
      { unit: { name: { contains: membershipSearch, mode: 'insensitive' } } },
    ] } : {}),
  }
  const assignmentConditions: Prisma.PositionAssignmentWhereInput[] = []
  if (assignmentUnitId) assignmentConditions.push({ unit_id: assignmentUnitId })
  if (assignmentPositionId) assignmentConditions.push({ position_id: assignmentPositionId })
  if (assignmentSearch) assignmentConditions.push({ OR: [
    { user: { email: { contains: assignmentSearch, mode: 'insensitive' } } },
    { position: { code: { contains: assignmentSearch, mode: 'insensitive' } } },
    { position: { name: { contains: assignmentSearch, mode: 'insensitive' } } },
    { unit: { name: { contains: assignmentSearch, mode: 'insensitive' } } },
  ] })
  if (assignmentStatus === 'ACTIVE') assignmentConditions.push({ starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] })
  if (assignmentStatus === 'SCHEDULED') assignmentConditions.push({ starts_at: { gt: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] })
  if (assignmentStatus === 'ENDED') assignmentConditions.push({ ends_at: { lte: now } })
  const assignmentWhere: Prisma.PositionAssignmentWhereInput = assignmentConditions.length ? { AND: assignmentConditions } : {}

  const [units, positions, permissions, positionPermissions, totalMemberships, totalPositionAssignments, recentKpis] = await Promise.all([
    prisma.organizationUnit.findMany({ include: { parent: { select: { id: true, name: true } }, _count: { select: { memberships: true, positions: true } } }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
    prisma.position.findMany({ include: { _count: { select: { assignments: true } } }, orderBy: { code: 'asc' } }),
    prisma.permission.findMany({ orderBy: { code: 'asc' } }),
    prisma.positionPermission.findMany({
      include: { position: { select: { id: true, code: true, name: true, scope: true } }, permission: { select: { id: true, code: true, description: true } } },
      orderBy: [{ position: { code: 'asc' } }, { permission: { code: 'asc' } }],
    }),
    prisma.organizationMembership.count({ where: membershipWhere }),
    prisma.positionAssignment.count({ where: assignmentWhere }),
    prisma.chapterMonthlyKpi.findMany({
      take: 60,
      include: { chapter: { select: { name: true } }, configured_by: { select: { email: true } } },
      orderBy: { updated_at: 'desc' },
    }),
  ])
  const membershipPagination = normalizeOrganizationPagination(params.get('membershipPage'), params.get('membershipLimit'), totalMemberships)
  const assignmentPagination = normalizeOrganizationPagination(params.get('assignmentPage'), params.get('assignmentLimit'), totalPositionAssignments)
  const [memberships, positionAssignments] = await Promise.all([
    prisma.organizationMembership.findMany({
      where: membershipWhere,
      include: { user: { select: { id: true, email: true } }, unit: { select: { id: true, name: true, type: true } } },
      orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
      skip: membershipPagination.skip,
      take: membershipPagination.limit,
    }),
    prisma.positionAssignment.findMany({
      where: assignmentWhere,
      include: {
        user: { select: { id: true, email: true } },
        position: { select: { id: true, code: true, name: true, scope: true } },
        unit: { select: { id: true, name: true, type: true } },
      },
      orderBy: [{ starts_at: 'desc' }, { created_at: 'desc' }],
      skip: assignmentPagination.skip,
      take: assignmentPagination.limit,
    }),
  ])
  return NextResponse.json({
    units,
    positions,
    permissions,
    positionPermissions,
    memberships,
    positionAssignments,
    membershipPagination: { page: membershipPagination.page, limit: membershipPagination.limit, total: membershipPagination.total, totalPages: membershipPagination.totalPages },
    assignmentPagination: { page: assignmentPagination.page, limit: assignmentPagination.limit, total: assignmentPagination.total, totalPages: assignmentPagination.totalPages },
    recentKpis: recentKpis.map((item) => ({ id: item.id, chapterName: item.chapter.name, month: item.month_start, status: item.status, note: item.note, updatedAt: item.updated_at, configuredBy: item.configured_by.email })),
  })
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context?.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Request body must be an object.' } }, { status: 400 })
  }
  if (body.action === 'CREATE_UNIT') {
    if (typeof body.name !== 'string' || !['ROOT', 'DNA', 'CHAPTER', 'DEPARTMENT'].includes(body.type)) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
    const name = body.name.trim()
    if (name.length > 255) return NextResponse.json({ error: { code: 'ValidationError', message: 'Organization name is too long.' } }, { status: 400 })
    if (!name) return NextResponse.json({ error: { code: 'ValidationError', message: 'Tên đơn vị không được để trống.' } }, { status: 400 })
    if (body.parentId != null && typeof body.parentId !== 'string') return NextResponse.json({ error: { code: 'ValidationError', message: 'Đơn vị cha không hợp lệ.' } }, { status: 400 })
    if (body.parentId != null && !isOrganizationId(body.parentId)) return NextResponse.json({ error: { code: 'ValidationError', message: 'Parent unit ID must be a valid ID.' } }, { status: 400 })
    const parent = body.parentId ? await prisma.organizationUnit.findUnique({ where: { id: body.parentId }, select: { id: true, type: true } }) : null
    if (body.parentId && !parent) return NextResponse.json({ error: { code: 'OrganizationParentNotFound' } }, { status: 404 })
    if (!organizationParentTypeMatches(body.type, parent?.type || null)) {
      return NextResponse.json({ error: { code: 'OrganizationParentTypeInvalid', message: 'DNA và Chapter phải thuộc Root; Ban phải thuộc trực tiếp một Chapter.' } }, { status: 400 })
    }
    try {
      const result = await prisma.$transaction(async (tx) => {
        const unit = await tx.organizationUnit.create({ data: { name, type: body.type, parent_id: body.parentId || null } })
        const chapter = body.type === 'CHAPTER'
          ? await tx.chapter.create({ data: { name, organization_unit_id: unit.id } })
          : null
        return { unit, chapter }
      })
      return NextResponse.json(result, { status: 201 })
    } catch (error: any) {
      if (error?.code === 'P2002') return NextResponse.json({ error: { code: 'DuplicateOrganizationUnit', message: 'Tên Chapter hoặc đơn vị này đã được sử dụng.' } }, { status: 409 })
      throw error
    }
  }
  if (body.action === 'MOVE_UNIT') {
    if (typeof body.unitId !== 'string' || !body.unitId || (body.parentId != null && typeof body.parentId !== 'string')) {
      return NextResponse.json({ error: { code: 'ValidationError', message: 'Đơn vị hoặc đơn vị cha không hợp lệ.' } }, { status: 400 })
    }
    if (!isOrganizationId(body.unitId) || (body.parentId != null && !isOrganizationId(body.parentId))) {
      return NextResponse.json({ error: { code: 'ValidationError', message: 'Unit IDs must be valid.' } }, { status: 400 })
    }
    const parentId = body.parentId || null
    let moveResult
    try {
      moveResult = await prisma.$transaction(async (tx) => {
        const unitRefs = await tx.organizationUnit.findMany({ select: { id: true, parent_id: true, type: true } })
        const nodes = unitRefs.map((unit) => ({ id: unit.id, parentId: unit.parent_id, type: unit.type }))
        const validation = validateOrganizationMove(nodes, body.unitId, parentId)
        if (validation.ok === false) return { validation }

        const unit = unitRefs.find((candidate) => candidate.id === body.unitId)!
        const affectedUnitIds = Array.from(organizationSubtreeIds(nodes, unit.id))
        const now = new Date()
        const [memberships, assignments, legacyChapterMembers] = await Promise.all([
          tx.organizationMembership.findMany({
            where: { unit_id: { in: affectedUnitIds }, status: 'ACTIVE', starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
            select: { user_id: true },
          }),
          tx.positionAssignment.findMany({
            where: { unit_id: { in: affectedUnitIds }, starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
            select: { user_id: true },
          }),
          tx.chapterMember.findMany({
            where: { chapter: { organization_unit_id: { in: affectedUnitIds } } },
            select: { user_id: true },
          }),
        ])
        const affectedUserIds = Array.from(new Set([
          ...memberships.map((membership) => membership.user_id),
          ...assignments.map((assignment) => assignment.user_id),
          ...legacyChapterMembers.map((membership) => membership.user_id),
        ]))

        if (unit.parent_id !== parentId) {
          await tx.organizationUnit.update({ where: { id: unit.id }, data: { parent_id: parentId } })
          await tx.auditLog.create({
            data: {
              actor_user_id: auth.context!.userId,
              action: 'MOVE_ORGANIZATION_UNIT',
              entity_type: 'ORGANIZATION_UNIT',
              entity_id: unit.id,
              metadata: { oldParentId: unit.parent_id, newParentId: parentId, affectedUnitIds, affectedUserCount: affectedUserIds.length },
            },
          })
        }
        return { validation, unitId: unit.id, oldParentId: unit.parent_id, parentId, affectedUnitIds, affectedUserIds }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
    } catch (error: any) {
      if (error?.code === 'P2034') return NextResponse.json({ error: { code: 'OrganizationChangedConcurrently', message: 'Cây tổ chức vừa được cập nhật đồng thời. Hãy tải lại rồi thử lại.' } }, { status: 409 })
      throw error
    }

    if (moveResult.validation.ok === false) {
      const status = moveResult.validation.code === 'OrganizationUnitNotFound' || moveResult.validation.code === 'OrganizationParentNotFound' ? 404 : 400
      return NextResponse.json({ error: { code: moveResult.validation.code, message: 'Không thể chuyển đơn vị vì thao tác sẽ tạo cấu trúc không hợp lệ.' } }, { status })
    }
    try {
      const userIds = moveResult.affectedUserIds || []
      for (let offset = 0; offset < userIds.length; offset += 20) {
        await Promise.all(userIds.slice(offset, offset + 20).map((userId) => reconcileLearningAssignmentsForUser(userId)))
      }
    } catch {
      return NextResponse.json({
        error: { code: 'LearningAssignmentReconciliationFailed', message: 'Đã chuyển đơn vị nhưng chưa đồng bộ đủ lộ trình học; hãy tải lại và lưu lại cùng đơn vị cha để chạy đồng bộ lần nữa.' },
        unitMoved: true,
      }, { status: 500 })
    }
    return NextResponse.json({ unitId: moveResult.unitId, oldParentId: moveResult.oldParentId, parentId: moveResult.parentId, affectedUnitCount: moveResult.affectedUnitIds.length, reconciledUserCount: moveResult.affectedUserIds.length })
  }
  if (body.action === 'CREATE_POSITION') {
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const scopes = ['PLATFORM', 'DNA', 'CHAPTER', 'DEPARTMENT']
    if (!code || code.length > 100 || !name || name.length > 255 || !scopes.includes(body.scope) || (body.isManager !== undefined && typeof body.isManager !== 'boolean')) {
      return NextResponse.json({ error: { code: 'ValidationError', message: 'Position code, name, scope or manager flag is invalid.' } }, { status: 400 })
    }
    try {
      const position = await prisma.position.create({ data: { code, name, scope: body.scope, is_manager: body.isManager ?? true } })
      return NextResponse.json({ position }, { status: 201 })
    } catch (error: any) {
      if (error?.code === 'P2002') return NextResponse.json({ error: { code: 'PositionCodeExists' } }, { status: 409 })
      throw error
    }
  }
  if (body.action === 'CREATE_PERMISSION') {
    const permissionCode = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
    if (!/^[A-Z][A-Z0-9_]{1,99}$/.test(permissionCode) || (body.description !== undefined && body.description !== null && typeof body.description !== 'string') || (typeof body.description === 'string' && body.description.trim().length > 500)) {
      return NextResponse.json({ error: { code: 'ValidationError', message: 'Permission code or description is invalid.' } }, { status: 400 })
    }
    try {
      const permission = await prisma.permission.create({ data: { code: permissionCode, description: typeof body.description === 'string' ? body.description.trim() || null : null } })
      return NextResponse.json({ permission }, { status: 201 })
    } catch (error: any) {
      if (error?.code === 'P2002') return NextResponse.json({ error: { code: 'PermissionCodeExists' } }, { status: 409 })
      throw error
    }
  }
  if (body.action === 'GRANT_PERMISSION') {
    if (!isOrganizationId(body.positionId) || !isOrganizationId(body.permissionId)) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
    const [position, permission] = await Promise.all([
      prisma.position.findUnique({ where: { id: body.positionId }, select: { id: true } }),
      prisma.permission.findUnique({ where: { id: body.permissionId }, select: { id: true } }),
    ])
    if (!position || !permission) return NextResponse.json({ error: { code: 'PermissionTargetNotFound' } }, { status: 404 })
    const grant = await prisma.positionPermission.upsert({ where: { position_id_permission_id: { position_id: body.positionId, permission_id: body.permissionId } }, create: { position_id: body.positionId, permission_id: body.permissionId }, update: {} })
    return NextResponse.json({ grant }, { status: 201 })
  }
  if (body.action === 'REVOKE_PERMISSION') {
    if (!isOrganizationId(body.positionId) || !isOrganizationId(body.permissionId)) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
    if (!body.positionId || !body.permissionId) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
    const result = await prisma.$transaction(async (tx) => {
      const revoked = await tx.positionPermission.deleteMany({ where: { position_id: body.positionId, permission_id: body.permissionId } })
      if (!revoked.count) return false
      await tx.auditLog.create({
        data: {
          actor_user_id: auth.context!.userId,
          action: 'REVOKE_POSITION_PERMISSION',
          entity_type: 'POSITION_PERMISSION',
          entity_id: body.positionId,
          metadata: { positionId: body.positionId, permissionId: body.permissionId },
        },
      })
      return true
    })
    if (!result) return NextResponse.json({ error: { code: 'PermissionGrantNotFound' } }, { status: 404 })
    return NextResponse.json({ revoked: true })
  }
  if (body.action === 'ADD_MEMBERSHIP') {
    if (!isOrganizationId(body.userId) || !isOrganizationId(body.unitId)) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
    if (!body.userId || !body.unitId) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
    const startsAt = body.startsAt ? new Date(body.startsAt) : new Date()
    if (Number.isNaN(startsAt.getTime())) return NextResponse.json({ error: { code: 'ValidationError', message: 'Ngày bắt đầu không hợp lệ.' } }, { status: 400 })
    if (startsAt > new Date()) return NextResponse.json({ error: { code: 'ValidationError', message: 'Membership đơn vị chỉ bắt đầu ngay hoặc trong quá khứ; chức vụ có thể được lên lịch trước.' } }, { status: 400 })
    const [user, unit] = await Promise.all([
      prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } }),
      prisma.organizationUnit.findUnique({ where: { id: body.unitId }, select: { id: true, type: true, parent_id: true, chapter: { select: { id: true } } } }),
    ])
    if (!user || !unit) return NextResponse.json({ error: { code: 'NotFound', message: 'Không tìm thấy người dùng hoặc đơn vị.' } }, { status: 404 })
    let chapterId = unit.chapter?.id || null
    let ancestorId = unit.parent_id
    while (!chapterId && ancestorId) {
      const ancestor = await prisma.organizationUnit.findUnique({ where: { id: ancestorId }, select: { type: true, parent_id: true, chapter: { select: { id: true } } } })
      if (!ancestor) break
      if (ancestor.type === 'CHAPTER') chapterId = ancestor.chapter?.id || null
      ancestorId = ancestor.parent_id
    }
    const duplicate = await prisma.organizationMembership.findFirst({ where: { user_id: user.id, unit_id: unit.id, status: 'ACTIVE', ends_at: null } })
    if (duplicate) return NextResponse.json({ error: { code: 'MembershipExists', message: 'Người dùng đã thuộc đơn vị này.' } }, { status: 409 })
    const membership = await prisma.$transaction(async (tx) => {
      const created = await tx.organizationMembership.create({ data: { user_id: user.id, unit_id: unit.id, starts_at: startsAt } })
      if (chapterId) {
        await tx.chapterMember.upsert({
          where: { chapter_id_user_id: { chapter_id: chapterId, user_id: user.id } },
          create: { chapter_id: chapterId, user_id: user.id, joined_at: startsAt },
          update: {},
        })
      }
      return created
    })
    await reconcileLearningAssignmentsForUser(body.userId)
    invalidateUserAuthCache(body.userId)
    return NextResponse.json({ membership }, { status: 201 })
  }
  if (body.action === 'END_MEMBERSHIP') {
    if (!isOrganizationId(body.membershipId)) return NextResponse.json({ error: { code: 'ValidationError', message: 'A valid membership ID is required.' } }, { status: 400 })
    if (!body.membershipId) return NextResponse.json({ error: { code: 'ValidationError', message: 'Thiếu membership cần kết thúc.' } }, { status: 400 })
    const membership = await prisma.organizationMembership.findUnique({ where: { id: body.membershipId } })
    if (!membership || membership.status !== 'ACTIVE' || membership.ends_at) {
      return NextResponse.json({ error: { code: 'MembershipInactive', message: 'Membership không còn hoạt động.' } }, { status: 409 })
    }
    const now = new Date()
    const chapterId = await getChapterIdForUnit(membership.unit_id)
    const chapterRecord = chapterId
      ? await prisma.chapter.findUnique({ where: { id: chapterId }, select: { organization_unit_id: true } })
      : null
    const chapterUnitIds = chapterRecord?.organization_unit_id
      ? await getUnitTreeIds(chapterRecord.organization_unit_id)
      : []
    const ended = await prisma.$transaction(async (tx) => {
      const result = await tx.organizationMembership.update({ where: { id: membership.id }, data: { status: 'ENDED', ends_at: now } })
      if (chapterId && chapterUnitIds.length) {
        // ChapterMember is retained as an active-membership compatibility index.
        const remaining = await tx.organizationMembership.count({
          where: {
            user_id: membership.user_id,
            unit_id: { in: chapterUnitIds },
            status: 'ACTIVE',
            starts_at: { lte: now },
            OR: [{ ends_at: null }, { ends_at: { gt: now } }],
          },
        })
        if (!remaining) await tx.chapterMember.deleteMany({ where: { chapter_id: chapterId, user_id: membership.user_id } })
      }
      return result
    })
    await reconcileLearningAssignmentsForUser(membership.user_id)
    invalidateUserAuthCache(membership.user_id)
    return NextResponse.json({ membership: ended })
  }
  if (body.action === 'APPOINT_POSITION') {
    if (!isOrganizationId(body.userId) || !isOrganizationId(body.positionId) || !isOrganizationId(body.unitId) || (body.isPrimary !== undefined && typeof body.isPrimary !== 'boolean')) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
    if (!body.userId || !body.positionId || !body.unitId) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
    const startsAt = body.startsAt ? new Date(body.startsAt) : new Date()
    const endsAt = body.endsAt ? new Date(body.endsAt) : null
    if (Number.isNaN(startsAt.getTime()) || (endsAt && Number.isNaN(endsAt.getTime())) || (endsAt && endsAt <= startsAt)) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
    const [user, position, unit] = await Promise.all([
      prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } }),
      prisma.position.findUnique({ where: { id: body.positionId }, select: { id: true, scope: true } }),
      prisma.organizationUnit.findUnique({ where: { id: body.unitId }, select: { id: true, type: true } }),
    ])
    if (!user || !position || !unit) return NextResponse.json({ error: { code: 'NotFound', message: 'Không tìm thấy người dùng, chức vụ hoặc đơn vị.' } }, { status: 404 })
    if (!positionScopeMatchesUnitType(position.scope, unit.type)) {
      return NextResponse.json({ error: { code: 'PositionScopeMismatch', message: 'Phạm vi chức vụ không khớp loại đơn vị được bổ nhiệm.' } }, { status: 400 })
    }
    const isPrimary = Boolean(body.isPrimary)
    const assignment = await prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.positionAssignment.updateMany({
          where: { unit_id: unit.id, is_primary: true, starts_at: { lt: startsAt }, OR: [{ ends_at: null }, { ends_at: { gt: startsAt } }] },
          data: { ends_at: startsAt },
        })
      }
      const created = await tx.positionAssignment.create({ data: {
        user_id: user.id,
        position_id: position.id,
        unit_id: unit.id,
        is_primary: isPrimary,
        starts_at: startsAt,
        ends_at: endsAt,
        appointed_by: auth.context!.userId,
      } })
      await tx.auditLog.create({
        data: {
          actor_user_id: auth.context!.userId,
          action: 'APPOINT_POSITION',
          entity_type: 'POSITION_ASSIGNMENT',
          entity_id: created.id,
          metadata: { userId: user.id, positionId: position.id, unitId: unit.id, startsAt: startsAt.toISOString(), endsAt: endsAt?.toISOString() || null, isPrimary },
        },
      })
      return created
    })
    await reconcileLearningAssignmentsForUser(body.userId)
    return NextResponse.json({ assignment }, { status: 201 })
  }
  if (body.action === 'END_POSITION') {
    if (!isOrganizationId(body.assignmentId)) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
    if (!body.assignmentId) return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
    const existing = await prisma.positionAssignment.findUnique({
      where: { id: body.assignmentId },
      select: { id: true, user_id: true, position_id: true, unit_id: true, starts_at: true, ends_at: true },
    })
    if (!existing) return NextResponse.json({ error: { code: 'AssignmentNotFound' } }, { status: 404 })
    const now = new Date()
    if (existing.ends_at && existing.ends_at <= now) {
      return NextResponse.json({ error: { code: 'AssignmentInactive', message: 'Nhiệm kỳ này đã kết thúc.' } }, { status: 409 })
    }
    // A future appointment is cancelled at its start instant; an active term ends now.
    const effectiveEnd = existing.starts_at > now ? existing.starts_at : now
    const assignment = await prisma.$transaction(async (tx) => {
      const changed = await tx.positionAssignment.updateMany({
        where: { id: existing.id, OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
        data: { ends_at: effectiveEnd },
      })
      if (!changed.count) return null
      await tx.auditLog.create({
        data: {
          actor_user_id: auth.context!.userId,
          action: 'END_POSITION_ASSIGNMENT',
          entity_type: 'POSITION_ASSIGNMENT',
          entity_id: existing.id,
          metadata: {
            userId: existing.user_id,
            positionId: existing.position_id,
            unitId: existing.unit_id,
            effectiveEnd: effectiveEnd.toISOString(),
          },
        },
      })
      return tx.positionAssignment.findUnique({ where: { id: existing.id } })
    })
    if (!assignment) return NextResponse.json({ error: { code: 'AssignmentInactive', message: 'Nhiệm kỳ đã được kết thúc trước đó.' } }, { status: 409 })
    await reconcileLearningAssignmentsForUser(existing.user_id)
    return NextResponse.json({ assignment })
  }
  return NextResponse.json({ error: { code: 'UnknownAction' } }, { status: 400 })
}
