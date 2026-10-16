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
  const now = new Date()
  const expandedChanges: ExpandedChange[] = changes.flatMap((change: any) =>
    (scopes.get(change.targetKey) || []).map((scope) => ({ ...scope, courseId: change.courseId, enabled: change.enabled, dueDays: change.dueDays })),
  )
  const courseIds = Array.from(new Set(expandedChanges.map((change) => change.courseId)))
  const rootUnitIds = Array.from(new Set(expandedChanges.flatMap((change) => change.organizationUnitId ? [change.organizationUnitId] : [])))
  const [existingRules, organizationUnits] = await Promise.all([
    courseIds.length ? prisma.learningRule.findMany({ where: { course_id: { in: courseIds }, effective_until: null }, orderBy: { created_at: 'asc' } }) : Promise.resolve([]),
    rootUnitIds.length ? prisma.organizationUnit.findMany({ select: { id: true, parent_id: true } }) : Promise.resolve([]),
  ])
  const descendantsByRoot = descendantIdsByRoot(organizationUnits, rootUnitIds)
  const rulesByScope = new Map<string, typeof existingRules>()
  for (const rule of existingRules) {
    const key = scopeKey(rule.course_id, rule.organization_unit_id, rule.position_id)
    rulesByScope.set(key, [...(rulesByScope.get(key) || []), rule])
  }

  const result = await prisma.$transaction(async (tx) => {
    const closeRuleIds = new Set<string>()
    const dueUpdates: Array<{ id: string; dueDays: number }> = []
    const rulesToCreate: ExpandedChange[] = []

    for (const change of expandedChanges) {
      const matched = rulesByScope.get(scopeKey(change.courseId, change.organizationUnitId, change.positionId)) || []
      if (!change.enabled) {
        matched.forEach((rule) => closeRuleIds.add(rule.id))
        continue
      }
      const [canonical, ...duplicates] = matched
      duplicates.forEach((rule) => closeRuleIds.add(rule.id))
      if (!canonical) rulesToCreate.push(change)
      else if (canonical.due_days !== change.dueDays && change.dueDays !== null) dueUpdates.push({ id: canonical.id, dueDays: change.dueDays })
    }

    for (const [dueDays, rows] of Array.from(groupsByDueDays<{ courseId: string; dueDays: number }>(rowDefaults).entries())) {
      await tx.course.updateMany({ where: { id: { in: rows.map((row) => row.courseId) } }, data: { mandatory_default_due_days: dueDays } })
    }
    for (const [dueDays, rows] of Array.from(groupsByDueDays(dueUpdates).entries())) {
      const ruleIds = rows.map((row) => row.id)
      const dueAt = new Date(now.getTime() + dueDays * 86400000)
      await tx.learningRule.updateMany({ where: { id: { in: ruleIds } }, data: { due_days: dueDays } })
      await tx.userLearningAssignment.updateMany({ where: { rule_id: { in: ruleIds }, ended_at: null, status: { in: ['ASSIGNED', 'IN_PROGRESS'] } }, data: { due_at: dueAt } })
      await tx.userLearningAssignment.updateMany({ where: { rule_id: { in: ruleIds }, ended_at: null, status: 'OVERDUE' }, data: { due_at: dueAt, status: 'ASSIGNED' } })
    }

    const idsToClose = Array.from(closeRuleIds)
    if (idsToClose.length) {
      await tx.userLearningAssignment.updateMany({ where: { rule_id: { in: idsToClose }, ended_at: null, status: { in: ['ASSIGNED', 'IN_PROGRESS', 'OVERDUE'] } }, data: { status: 'ENDED' } })
      await tx.userLearningAssignment.updateMany({ where: { rule_id: { in: idsToClose }, ended_at: null }, data: { mandatory: false, due_at: null, ended_at: now } })
      await tx.learningRule.updateMany({ where: { id: { in: idsToClose } }, data: { effective_until: now } })
    }

    const createdRules = rulesToCreate.length ? await tx.learningRule.createManyAndReturn({
      data: rulesToCreate.map((change) => ({
        course_id: change.courseId,
        organization_unit_id: change.organizationUnitId,
        position_id: change.positionId,
        mandatory: true,
        can_view: true,
        can_assess: true,
        can_earn_stars: true,
        due_days: change.dueDays,
      })),
      select: { id: true, course_id: true, organization_unit_id: true, position_id: true, due_days: true },
    }) : []

    if (createdRules.length) {
      const relevantUnitIds = Array.from(new Set(createdRules.flatMap((rule) => rule.organization_unit_id ? Array.from(descendantsByRoot.get(rule.organization_unit_id) || [rule.organization_unit_id]) : [])))
      const relevantPositionIds = Array.from(new Set(createdRules.flatMap((rule) => rule.position_id ? [rule.position_id] : [])))
      const [memberships, positions] = await Promise.all([
        relevantUnitIds.length ? tx.organizationMembership.findMany({ where: { unit_id: { in: relevantUnitIds }, status: 'ACTIVE', starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] }, select: { user_id: true, unit_id: true } }) : Promise.resolve([]),
        relevantPositionIds.length ? tx.positionAssignment.findMany({ where: { position_id: { in: relevantPositionIds }, starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] }, select: { user_id: true, unit_id: true, position_id: true } }) : Promise.resolve([]),
      ])
      const assignmentCandidates: Array<{ userId: string; courseId: string; ruleId: string; dueDays: number | null }> = []
      const eligibleUsersByScope = new Map<string, string[]>()
      for (const rule of createdRules) {
        const key = scopeKey('', rule.organization_unit_id, rule.position_id)
        let userIds = eligibleUsersByScope.get(key)
        if (!userIds) {
          const unitIds = rule.organization_unit_id ? (descendantsByRoot.get(rule.organization_unit_id) || new Set([rule.organization_unit_id])) : null
          const memberIds = new Set(unitIds ? memberships.filter((row) => unitIds.has(row.unit_id)).map((row) => row.user_id) : [])
          const positionUserIds = new Set(rule.position_id ? positions.filter((row) => row.position_id === rule.position_id && (!unitIds || unitIds.has(row.unit_id))).map((row) => row.user_id) : [])
          userIds = unitIds && rule.position_id
            ? Array.from(memberIds).filter((userId) => positionUserIds.has(userId))
            : Array.from(unitIds ? memberIds : positionUserIds)
          eligibleUsersByScope.set(key, userIds)
        }
        for (const userId of userIds) assignmentCandidates.push({ userId, courseId: rule.course_id, ruleId: rule.id, dueDays: rule.due_days })
      }
      const candidateUserIds = Array.from(new Set(assignmentCandidates.map((item) => item.userId)))
      const candidateCourseIds = Array.from(new Set(assignmentCandidates.map((item) => item.courseId)))
      const completedRows = assignmentCandidates.length ? await tx.userLearningAssignment.findMany({
        where: { user_id: { in: candidateUserIds }, course_id: { in: candidateCourseIds }, OR: [{ status: 'COMPLETED' }, { completed_at: { not: null } }] },
        select: { user_id: true, course_id: true },
        distinct: ['user_id', 'course_id'],
      }) : []
      const completedKeys = new Set(completedRows.map((row) => `${row.user_id}:${row.course_id}`))
      const assignmentRows = assignmentCandidates.map((item) => {
        const completed = completedKeys.has(`${item.userId}:${item.courseId}`)
        return {
          user_id: item.userId,
          course_id: item.courseId,
          rule_id: item.ruleId,
          mandatory: true,
          can_view: true,
          can_assess: true,
          can_earn_stars: true,
          status: completed ? 'COMPLETED' as const : 'ASSIGNED' as const,
          completed_at: completed ? now : null,
          due_at: completed || !item.dueDays ? null : new Date(now.getTime() + item.dueDays * 86400000),
        }
      })
      for (const batch of chunks(assignmentRows)) await tx.userLearningAssignment.createMany({ data: batch, skipDuplicates: true })
    }

    return { created: rulesToCreate.length, updated: dueUpdates.length, closed: idsToClose.length }
  }, { timeout: 30000, maxWait: 10000 })

  return NextResponse.json({ updated: changes.length, rules: result })
}
