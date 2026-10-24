import { enqueueAssignmentSync } from '@/lib/learning-periods'
import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  invalidateCoursesServerCache,
  getCachedTargetCatalog,
  setCachedTargetCatalog,
  getCachedScopes,
  setCachedScopes,
} from '@/lib/server-cache'

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
  const cached = getCachedTargetCatalog(60_000)
  if (cached) return cached
  const configured = await prisma.learningTarget.findMany({ orderBy: { sort_order: 'asc' } })
  const result = configured.length ? configured.map((row) => ({ key: row.code, label: row.label })) : [...targets]
  setCachedTargetCatalog(result)
  return result
}

async function resolveScopes(): Promise<Map<string, Scope[]>> {
  const cached = getCachedScopes(60_000)
  if (cached) return cached
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
    setCachedScopes(result)
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
  setCachedScopes(result)
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
  
  // Pre-fetch courses and their active rules in a single joined query
  const targetCourseIds = Array.from(new Set([
    ...changes.map((c) => c.courseId),
    ...rowDefaults.map((r) => r.courseId),
  ]))

  // Pre-fetch courses and their active rules in a single joined query
  const courses = await prisma.course.findMany({
    where: { id: { in: targetCourseIds } },
    relationLoadStrategy: 'join',
    select: {
      id: true,
      mandatory_default_due_days: true,
      learning_rules: {
        where: { effective_until: null },
        orderBy: { created_at: 'asc' },
      },
    },
  })

  const courseMap = new Map(courses.map((c) => [c.id, c]))
  for (const id of targetCourseIds) {
    if (!courseMap.has(id)) {
      throw new Error(`CourseNotFound: ${id}`)
    }
  }

  const rulesByScope = new Map<string, any[]>()
  for (const course of courses) {
    for (const rule of course.learning_rules) {
      const key = scopeKey(rule.course_id, rule.organization_unit_id, rule.position_id)
      const list = rulesByScope.get(key) || []
      list.push(rule)
      rulesByScope.set(key, list)
    }
  }

  // Update in-memory courseMap for rowDefaults
  for (const row of rowDefaults) {
    const c = courseMap.get(row.courseId)
    if (c) c.mandatory_default_due_days = row.dueDays
  }

  // In-memory diffing for changes
  const now = new Date()
  const ruleIdsToClose: string[] = []
  const rulesToCreate: Array<{
    course_id: string
    organization_unit_id: string | null
    position_id: string | null
    due_days: number | null
    target_code: string
  }> = []
  const rulesToUpdate: Array<{
    id: string
    due_days: number | null
    target_code: string
  }> = []

  for (const change of changes) {
    const course = courseMap.get(change.courseId)!
    for (const scope of scopes.get(change.targetKey) || []) {
      const key = scopeKey(change.courseId, scope.organizationUnitId, scope.positionId)
      const existing = rulesByScope.get(key) || []

      if (!change.enabled) {
        if (existing.length > 0) {
          for (const row of existing) ruleIdsToClose.push(row.id)
          rulesByScope.set(key, [])
        }
      } else if (!existing.length) {
        rulesToCreate.push({
          course_id: change.courseId,
          organization_unit_id: scope.organizationUnitId,
          position_id: scope.positionId,
          due_days: course.mandatory_default_due_days,
          target_code: change.targetKey,
        })
        rulesByScope.set(key, [{ id: 'pending', course_id: change.courseId, organization_unit_id: scope.organizationUnitId, position_id: scope.positionId, due_days: course.mandatory_default_due_days, target_code: change.targetKey } as any])
      } else {
        const first = existing[0]
        if (first.due_days !== course.mandatory_default_due_days || first.target_code !== change.targetKey) {
          rulesToUpdate.push({
            id: first.id,
            due_days: course.mandatory_default_due_days,
            target_code: change.targetKey,
          })
        }
        if (existing.length > 1) {
          for (const extra of existing.slice(1)) ruleIdsToClose.push(extra.id)
        }
        rulesByScope.set(key, [first])
      }
    }
  }

  // Check for No-Op
  const hasRuleChanges = rulesToCreate.length > 0 || ruleIdsToClose.length > 0 || rulesToUpdate.length > 0 || rowDefaults.length > 0

  if (!hasRuleChanges) {
    // Zero database mutations needed: log audit and return instantly
    void prisma.auditLog.create({
      data: {
        actor_user_id: guard.auth!.context!.userId,
        action: 'UPDATE_MANDATORY_MATRIX',
        entity_type: 'USER',
        entity_id: guard.auth!.context!.userId,
        metadata: { changes, rowDefaults, hasRuleChanges: false },
      },
    }).catch((err) => console.error('AuditLog error:', err))

    return NextResponse.json({ updated: changes.length, rules: { created: 0, closed: 0 } })
  }

  // Execute writes atomically in an isolated transaction
  const result = await prisma.$transaction(async (tx) => {
    const [users, closeRes, createRes] = await Promise.all([
      tx.user.findMany({ where: { anonymized_at: null }, select: { id: true } }),
      ruleIdsToClose.length > 0
        ? tx.learningRule.updateMany({
            where: { id: { in: ruleIdsToClose } },
            data: { effective_until: now },
          })
        : Promise.resolve({ count: 0 }),
      rulesToCreate.length > 0
        ? tx.learningRule.createMany({
            data: rulesToCreate,
          })
        : Promise.resolve({ count: 0 }),
      ...rowDefaults.map((row) =>
        tx.course.update({ where: { id: row.courseId }, data: { mandatory_default_due_days: row.dueDays } })
      ),
      ...rowDefaults.map((row) =>
        tx.learningRule.updateMany({ where: { course_id: row.courseId, effective_until: null }, data: { due_days: row.dueDays } })
      ),
      ...rulesToUpdate.map((updateItem) =>
        tx.learningRule.update({
          where: { id: updateItem.id },
          data: { due_days: updateItem.due_days, target_code: updateItem.target_code },
        })
      ),
    ])

    const closed = closeRes?.count || 0
    const created = createRes?.count || 0

    // High-performance bulk outbox enqueue
    const outboxRows = users.map((u) => ({
      event_key: `matrix:${now.toISOString()}:${u.id}`,
      kind: 'RECONCILE_ASSIGNMENTS' as const,
      user_id: u.id,
      payload: {},
    }))

    for (const chunk of chunks(outboxRows, 1000)) {
      await tx.learningOutbox.createMany({
        data: chunk,
        skipDuplicates: true,
      })
    }

    await tx.auditLog.create({
      data: {
        actor_user_id: guard.auth!.context!.userId,
        action: 'UPDATE_MANDATORY_MATRIX',
        entity_type: 'USER',
        entity_id: guard.auth!.context!.userId,
        metadata: { changes, rowDefaults, hasRuleChanges: true },
      },
    })

    return { created, closed }
  }, { timeout: 30_000 })

  invalidateCoursesServerCache()

  return NextResponse.json({ updated: changes.length, rules: result })
}
