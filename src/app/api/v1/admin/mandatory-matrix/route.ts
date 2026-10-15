import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getOrganizationUnitTreeIds } from '@/lib/learning-assignments'

const targets = [
  { key: 'CONTENT', label: 'Thành viên ban Nội dung', department: 'Nội dung' },
  { key: 'GUEST', label: 'Thành viên ban Khách mời', department: 'Khách mời' },
  { key: 'MEMBER', label: 'Thành viên ban Thành viên', department: 'Thành viên' },
  { key: 'QUALITY', label: 'Thành viên ban Chất lượng', department: 'Chất lượng' },
  { key: 'MEDIA_EVENT', label: 'Thành viên ban TT&SK', department: 'TT&SK' },
  { key: 'SECRETARY', label: 'Thành viên ban Thư ký', department: 'Thư ký' },
  { key: 'LEAD', label: 'LT / Chủ tịch', position: 'DEPARTMENT_LEAD' },
  { key: 'DNA', label: 'DNA', dna: true },
] as const

type Scope = { organizationUnitId: string | null; positionId: string | null }
async function resolveScopes() {
  const [positions, departments, dna] = await Promise.all([
    prisma.position.findMany({ where: { code: { in: ['MEMBER', 'DEPARTMENT_LEAD'] } } }),
    prisma.organizationUnit.findMany({ where: { type: 'DEPARTMENT' } }),
    prisma.organizationUnit.findFirst({ where: { type: 'DNA' }, orderBy: { created_at: 'asc' } }),
  ])
  const memberPosition = positions.find((position) => position.code === 'MEMBER')
  const leadPosition = positions.find((position) => position.code === 'DEPARTMENT_LEAD')
  const result = new Map<string, Scope[]>()
  for (const target of targets) {
    if ('department' in target) result.set(target.key, departments.filter((unit) => unit.name.toLocaleLowerCase('vi').includes(target.department.toLocaleLowerCase('vi'))).map((unit) => ({ organizationUnitId: unit.id, positionId: memberPosition?.id || null })))
    else if ('position' in target) result.set(target.key, leadPosition ? [{ organizationUnitId: null, positionId: leadPosition.id }] : [])
    else result.set(target.key, dna ? [{ organizationUnitId: dna.id, positionId: null }] : [])
  }
  return result
}

async function requireAdmin(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return { error: NextResponse.json({ error: auth.error }, { status: 401 }) }
  if (auth.context?.role !== 'ADMIN') return { error: NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 }) }
  return { auth }
}

export async function GET(request: NextRequest) {
  const guard = await requireAdmin(request); if ('error' in guard) return guard.error
  const [courses, rules, scopes] = await Promise.all([
    prisma.course.findMany({ orderBy: { title: 'asc' }, select: { id: true, title: true, status: true, mandatory_default_due_days: true } }),
    prisma.learningRule.findMany({ where: { effective_until: null }, select: { course_id: true, organization_unit_id: true, position_id: true, due_days: true } }),
    resolveScopes(),
  ])
  const cells: Record<string, Record<string, { enabled: boolean; dueDays: number | null }>> = {}
  for (const course of courses) {
    cells[course.id] = {}
    for (const target of targets) {
      const matched = rules.filter((rule) => rule.course_id === course.id && (scopes.get(target.key) || []).some((scope) => scope.organizationUnitId === rule.organization_unit_id && scope.positionId === rule.position_id))
      cells[course.id][target.key] = { enabled: matched.length > 0, dueDays: matched.find((rule) => rule.due_days)?.due_days || null }
    }
  }
  return NextResponse.json({ courses: courses.map((course) => ({ ...course, defaultDueDays: course.mandatory_default_due_days })), targets, cells })
}

export async function PUT(request: NextRequest) {
  const guard = await requireAdmin(request); if ('error' in guard) return guard.error
  const body = await request.json().catch(() => null)
  const raw = Array.isArray(body?.changes) ? body.changes : body?.courseId ? [body] : []
  const rowDefaults = Array.isArray(body?.rowDefaults) ? body.rowDefaults.map((item: any) => ({ courseId: String(item?.courseId || ''), dueDays: Number(item?.dueDays) })) : []
  const changes = raw.map((item: any) => ({ courseId: String(item?.courseId || ''), targetKey: String(item?.targetKey || ''), enabled: item?.enabled === true, dueDays: item?.enabled === true ? Number(item?.dueDays) : null }))
  if ((!changes.length && !rowDefaults.length) || changes.some((item: any) => !item.courseId || !targets.some((target) => target.key === item.targetKey) || (item.enabled && (!Number.isInteger(item.dueDays) || item.dueDays < 1 || item.dueDays > 3650))) || rowDefaults.some((item: any) => !item.courseId || !Number.isInteger(item.dueDays) || item.dueDays < 1 || item.dueDays > 3650)) return NextResponse.json({ error: { code: 'ValidationError', message: 'Cấu hình không hợp lệ.' } }, { status: 400 })
  const scopes = await resolveScopes()
  if (changes.some((item: any) => !(scopes.get(item.targetKey) || []).length)) return NextResponse.json({ error: { code: 'ScopeNotConfigured', message: 'Chưa có đơn vị hoặc chức vụ tương ứng.' } }, { status: 409 })
  const createdRules = await prisma.$transaction(async (tx) => {
    const created: Array<{ id: string; courseId: string; organizationUnitId: string | null; positionId: string | null; dueDays: number | null }> = []
    for (const row of rowDefaults) if (row.courseId && Number.isInteger(row.dueDays) && row.dueDays >= 1 && row.dueDays <= 3650) await tx.course.update({ where: { id: row.courseId }, data: { mandatory_default_due_days: row.dueDays } })
    for (const change of changes) for (const scope of scopes.get(change.targetKey) || []) {
      const existing = await tx.learningRule.findMany({ where: { course_id: change.courseId, organization_unit_id: scope.organizationUnitId, position_id: scope.positionId, effective_until: null }, select: { id: true } })
      if (existing.length) await tx.userLearningAssignment.updateMany({ where: { rule_id: { in: existing.map((rule) => rule.id) }, status: { in: ['ASSIGNED', 'IN_PROGRESS', 'OVERDUE'] } }, data: { mandatory: false, status: 'ENDED', due_at: null, ended_at: new Date() } })
      await tx.learningRule.deleteMany({ where: { course_id: change.courseId, organization_unit_id: scope.organizationUnitId, position_id: scope.positionId, effective_until: null } })
      if (change.enabled) {
        const rule = await tx.learningRule.create({ data: { course_id: change.courseId, organization_unit_id: scope.organizationUnitId, position_id: scope.positionId, mandatory: true, can_view: true, can_assess: true, can_earn_stars: true, due_days: change.dueDays }, select: { id: true } })
        created.push({ id: rule.id, courseId: change.courseId, organizationUnitId: scope.organizationUnitId, positionId: scope.positionId, dueDays: change.dueDays })
      }
    }
    return created
  }, { timeout: 30000, maxWait: 10000 })

  // Materialize only the newly-created rules. The old implementation reconciled
  // every rule and all learning progress for every affected user in parallel,
  // which overloaded the database and regularly made this request time out.
  const now = new Date()
  for (const rule of createdRules) {
    const unitIds = rule.organizationUnitId ? await getOrganizationUnitTreeIds(rule.organizationUnitId) : []
    const [memberships, positions] = await Promise.all([
      rule.organizationUnitId
        ? prisma.organizationMembership.findMany({ where: { unit_id: { in: unitIds }, status: 'ACTIVE', starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] }, select: { user_id: true } })
        : Promise.resolve([]),
      rule.positionId
        ? prisma.positionAssignment.findMany({ where: { position_id: rule.positionId, ...(rule.organizationUnitId ? { unit_id: { in: unitIds } } : {}), starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] }, select: { user_id: true } })
        : Promise.resolve([]),
    ])
    const memberIds = new Set(memberships.map((row) => row.user_id))
    const positionIds = new Set(positions.map((row) => row.user_id))
    const userIds = rule.organizationUnitId && rule.positionId
      ? Array.from(memberIds).filter((userId) => positionIds.has(userId))
      : Array.from(rule.organizationUnitId ? memberIds : positionIds)
    if (!userIds.length) continue

    const completed = await prisma.userLearningAssignment.findMany({
      where: { user_id: { in: userIds }, course_id: rule.courseId, OR: [{ status: 'COMPLETED' }, { completed_at: { not: null } }] },
      select: { user_id: true },
      distinct: ['user_id'],
    })
    const completedUserIds = new Set(completed.map((row) => row.user_id))
    await prisma.userLearningAssignment.createMany({ data: userIds.map((userId) => {
      const isCompleted = completedUserIds.has(userId)
      return {
        user_id: userId,
        course_id: rule.courseId,
        rule_id: rule.id,
        mandatory: true,
        can_view: true,
        can_assess: true,
        can_earn_stars: true,
        status: isCompleted ? 'COMPLETED' as const : 'ASSIGNED' as const,
        completed_at: isCompleted ? now : null,
        due_at: isCompleted || !rule.dueDays ? null : new Date(now.getTime() + rule.dueDays * 86400000),
      }
    }) })
  }
  return NextResponse.json({ updated: changes.length })
}
