import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { reconcileLearningAssignmentsForUser } from '@/lib/learning-assignments'

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

async function resolveScopes() {
  const [positions, departments, dna] = await Promise.all([
    prisma.position.findMany({ where: { code: { in: ['MEMBER', 'DEPARTMENT_LEAD'] } } }),
    prisma.organizationUnit.findMany({ where: { type: 'DEPARTMENT' } }),
    prisma.organizationUnit.findFirst({ where: { type: 'DNA' }, orderBy: { created_at: 'asc' } }),
  ])
  const memberPosition = positions.find((position) => position.code === 'MEMBER')
  const leadPosition = positions.find((position) => position.code === 'DEPARTMENT_LEAD')
  const byKey = new Map<string, Array<{ organizationUnitId: string | null; positionId: string | null }>>()
  for (const target of targets) {
    if ('department' in target) {
      const needle = target.department.toLocaleLowerCase('vi')
      byKey.set(target.key, departments.filter((unit) => unit.name.toLocaleLowerCase('vi').includes(needle)).map((unit) => ({ organizationUnitId: unit.id, positionId: memberPosition?.id || null })))
    } else if ('position' in target) byKey.set(target.key, leadPosition ? [{ organizationUnitId: null, positionId: leadPosition.id }] : [])
    else byKey.set(target.key, dna ? [{ organizationUnitId: dna.id, positionId: null }] : [])
  }
  return byKey
}

export async function GET(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context?.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  const [courses, rules, scopes] = await Promise.all([
    prisma.course.findMany({ orderBy: { title: 'asc' }, select: { id: true, title: true, status: true } }),
    prisma.learningRule.findMany({ where: { effective_until: null }, select: { course_id: true, organization_unit_id: true, position_id: true, due_days: true } }),
    resolveScopes(),
  ])
  const cells: Record<string, Record<string, { enabled: boolean; dueDays: number | null }>> = {}
  for (const course of courses) {
    cells[course.id] = {}
    for (const target of targets) {
      const scope = scopes.get(target.key) || []
      const matched = rules.filter((rule) => rule.course_id === course.id && scope.some((item) => item.organizationUnitId === rule.organization_unit_id && item.positionId === rule.position_id))
      cells[course.id][target.key] = { enabled: matched.length > 0, dueDays: matched.find((rule) => rule.due_days)?.due_days || null }
    }
  }
  return NextResponse.json({ courses, targets, cells })
}

export async function PUT(request: NextRequest) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context?.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  const body = await request.json().catch(() => null)
  const courseId = String(body?.courseId || '')
  const targetKey = String(body?.targetKey || '')
  const enabled = body?.enabled === true
  const dueDays = enabled ? Number(body?.dueDays) : null
  if (!courseId || !targets.some((target) => target.key === targetKey) || (enabled && (!Number.isInteger(dueDays) || dueDays < 1 || dueDays > 3650))) return NextResponse.json({ error: { code: 'ValidationError', message: 'Cấu hình không hợp lệ.' } }, { status: 400 })
  const scopes = (await resolveScopes()).get(targetKey) || []
  if (!scopes.length) return NextResponse.json({ error: { code: 'ScopeNotConfigured', message: 'Chưa có đơn vị/chức vụ tương ứng trong hệ thống.' } }, { status: 409 })
  await prisma.$transaction(async (tx) => {
    for (const scope of scopes) {
      const existingRules = await tx.learningRule.findMany({
        where: { course_id: courseId, organization_unit_id: scope.organizationUnitId, position_id: scope.positionId, effective_until: null },
        select: { id: true },
      })
      if (existingRules.length) {
        await tx.userLearningAssignment.updateMany({
          where: {
            rule_id: { in: existingRules.map((rule) => rule.id) },
            status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
          },
          data: { mandatory: false, status: 'ENDED', due_at: null, ended_at: new Date() },
        })
      }
      await tx.learningRule.deleteMany({ where: { course_id: courseId, organization_unit_id: scope.organizationUnitId, position_id: scope.positionId, effective_until: null } })
      if (enabled) await tx.learningRule.create({ data: { course_id: courseId, organization_unit_id: scope.organizationUnitId, position_id: scope.positionId, mandatory: true, can_view: true, can_assess: true, can_earn_stars: true, due_days: dueDays } })
    }
  })
  const users = await prisma.user.findMany({ where: { role: { not: 'ADMIN' } }, select: { id: true } })
  for (let index = 0; index < users.length; index += 10) await Promise.all(users.slice(index, index + 10).map((user) => reconcileLearningAssignmentsForUser(user.id)))
  return NextResponse.json({ courseId, targetKey, enabled, dueDays })
}
