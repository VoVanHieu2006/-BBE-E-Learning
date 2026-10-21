import { enqueueAssignmentSync } from '@/lib/learning-periods'
import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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
type ExpandedChange = Scope & { courseId: string; enabled: boolean; dueDays: number | null }

const scopeKey = (courseId: string, organizationUnitId: string | null, positionId: string | null) =>
  `${courseId}:${organizationUnitId || '-'}:${positionId || '-'}`

function descendantIdsByRoot(units: Array<{ id: string; parent_id: string | null }>, rootIds: string[]) {
  const children = new Map<string, string[]>()
  for (const unit of units) {
    if (!unit.parent_id) continue
    const current = children.get(unit.parent_id) || []
    current.push(unit.id)
    children.set(unit.parent_id, current)
  }
  const result = new Map<string, Set<string>>()
  for (const rootId of rootIds) {
    const ids = new Set<string>([rootId])
    const queue = [rootId]
    while (queue.length) {
      const current = queue.shift()!
      for (const childId of children.get(current) || []) {
        if (ids.has(childId)) continue
        ids.add(childId)
        queue.push(childId)
      }
    }
    result.set(rootId, ids)
  }
  return result
}

function groupsByDueDays<T extends { dueDays: number }>(items: T[]) {
  const groups = new Map<number, T[]>()
  for (const item of items) groups.set(item.dueDays, [...(groups.get(item.dueDays) || []), item])
  return groups
}

function chunks<T>(items: T[], size = 1000) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}
async function targetCatalog() {
  const configured = await prisma.learningTarget.findMany({ orderBy: { sort_order: 'asc' } })
  return configured.length ? configured.map((row) => ({ key: row.code, label: row.label })) : [...targets]
}
async function resolveScopes() {
  const configured = await prisma.learningTarget.findMany({ orderBy: { sort_order: 'asc' } })
  if (configured.length) {
    const [units, positions] = await Promise.all([
      prisma.organizationUnit.findMany({ where: { status: 'ACTIVE' } }), prisma.position.findMany(),
    ])
    const result = new Map<string, Scope[]>()
    for (const target of configured) {
      const position = target.position_code && target.position_code !== 'MEMBER' ? positions.find((row) => row.code === target.position_code) : null
      if (target.position_code && target.position_code !== 'MEMBER' && !position) { result.set(target.code, []); continue }
      const scopedUnits = units.filter((row) => target.department_code ? row.type === 'DEPARTMENT' && row.code === target.department_code : target.dna_unit_code ? ['DNA', 'DNA_GROUP'].includes(row.type) && row.code === target.dna_unit_code : false)
      result.set(target.code, target.department_code || target.dna_unit_code
        ? scopedUnits.map((row) => ({ organizationUnitId: row.id, positionId: position?.id || null }))
        : position ? [{ organizationUnitId: null, positionId: position.id }] : [])
    }
    return result
  }

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
  const targets = await targetCatalog()
  const [courses, rules, scopes] = await Promise.all([
    prisma.course.findMany({ orderBy: { title: 'asc' }, select: { id: true, title: true, status: true, mandatory_default_due_days: true } }),
    prisma.learningRule.findMany({ where: { effective_until: null }, select: { course_id: true, organization_unit_id: true, position_id: true, due_days: true } }),
    resolveScopes(),
  ])
  const rulesByScope = new Map<string, typeof rules>()
  for (const rule of rules) {
    const key = scopeKey(rule.course_id, rule.organization_unit_id, rule.position_id)
    rulesByScope.set(key, [...(rulesByScope.get(key) || []), rule])
  }
  const cells: Record<string, Record<string, { enabled: boolean; dueDays: number | null }>> = {}
  for (const course of courses) {
    cells[course.id] = {}
    for (const target of targets) {
      const matched = (scopes.get(target.key) || []).flatMap((scope) => rulesByScope.get(scopeKey(course.id, scope.organizationUnitId, scope.positionId)) || [])
      cells[course.id][target.key] = { enabled: matched.length > 0, dueDays: course.mandatory_default_due_days }
    }
  }
  return NextResponse.json({ courses: courses.map((course) => ({ ...course, defaultDueDays: course.mandatory_default_due_days })), targets, cells })
}

export async function PUT(request: NextRequest) {
  const guard = await requireAdmin(request); if ('error' in guard) return guard.error
  const targets = await targetCatalog()
  const body = await request.json().catch(() => null)
  const raw = Array.isArray(body?.changes) ? body.changes : body?.courseId ? [body] : []
  const rowDefaults = Array.isArray(body?.rowDefaults) ? body.rowDefaults.map((item: any) => ({ courseId: String(item?.courseId || ''), dueDays: Number(item?.dueDays) })) : []
  const changes = raw.map((item: any) => ({ courseId: String(item?.courseId || ''), targetKey: String(item?.targetKey || ''), enabled: item?.enabled === true, dueDays: item?.enabled === true ? Number(item?.dueDays) : null }))
  if ((!changes.length && !rowDefaults.length) || changes.some((item: any) => !item.courseId || !targets.some((target) => target.key === item.targetKey) || (item.enabled && (!Number.isInteger(item.dueDays) || item.dueDays < 1 || item.dueDays > 3650))) || rowDefaults.some((item: any) => !item.courseId || !Number.isInteger(item.dueDays) || item.dueDays < 1 || item.dueDays > 3650)) return NextResponse.json({ error: { code: 'ValidationError', message: 'Cấu hình không hợp lệ.' } }, { status: 400 })
  const scopes = await resolveScopes()
  if (changes.some((item: any) => !(scopes.get(item.targetKey) || []).length)) return NextResponse.json({ error: { code: 'ScopeNotConfigured', message: 'Chưa có đơn vị hoặc chức vụ tương ứng.' } }, { status: 409 })
  const result = await prisma.$transaction(async (tx) => {
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    const now = clock.now
    for (const row of rowDefaults) {
      await tx.course.update({ where: { id: row.courseId }, data: { mandatory_default_due_days: row.dueDays } })
      await tx.learningRule.updateMany({ where: { course_id: row.courseId, effective_until: null }, data: { due_days: row.dueDays } })
    }
    let created = 0, closed = 0
    for (const change of changes) {
      const course = await tx.course.findUniqueOrThrow({ where: { id: change.courseId } })
      for (const scope of scopes.get(change.targetKey) || []) {
        const existing = await tx.learningRule.findMany({ where: { course_id: change.courseId, organization_unit_id: scope.organizationUnitId, position_id: scope.positionId, effective_until: null }, orderBy: { created_at: 'asc' } })
        if (!change.enabled) {
          const result = await tx.learningRule.updateMany({ where: { id: { in: existing.map((row) => row.id) } }, data: { effective_until: now } })
          closed += result.count
        } else if (!existing.length) {
          await tx.learningRule.create({ data: { course_id: change.courseId, organization_unit_id: scope.organizationUnitId, position_id: scope.positionId, due_days: course.mandatory_default_due_days, target_code: change.targetKey } })
          created++
        } else {
          await tx.learningRule.update({ where: { id: existing[0].id }, data: { due_days: course.mandatory_default_due_days, target_code: change.targetKey } })
          if (existing.length > 1) await tx.learningRule.updateMany({ where: { id: { in: existing.slice(1).map((row) => row.id) } }, data: { effective_until: now } })
        }
      }
    }
    const users = await tx.user.findMany({ where: { anonymized_at: null }, select: { id: true } })
    for (const user of users) await enqueueAssignmentSync(tx, user.id, `matrix:${now.toISOString()}:${user.id}`)
    await tx.auditLog.create({ data: { actor_user_id: guard.auth!.context!.userId, action: 'UPDATE_MANDATORY_MATRIX', entity_type: 'USER', entity_id: guard.auth!.context!.userId, metadata: { changes, rowDefaults } } })
    return { created, closed }
  }, { timeout: 30_000 })
  return NextResponse.json({ updated: changes.length, rules: result })
}
