import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getOrganizationUnitTreeIds } from '@/lib/learning-assignments'
import { isOrganizationId } from '@/lib/organization-admin-rules'

/** Converts a rule to stable per-user assignments. Historical assignments are never deleted. */
export async function POST(request: NextRequest, { params }: { params: { ruleId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context?.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  if (!isOrganizationId(params.ruleId)) return NextResponse.json({ error: { code: 'ValidationError', message: 'A valid learning rule ID is required.' } }, { status: 400 })
  const rule = await prisma.learningRule.findUnique({ where: { id: params.ruleId } })
  if (!rule) return NextResponse.json({ error: { code: 'RuleNotFound' } }, { status: 404 })
  const now = new Date()
  if (rule.effective_from > now || (rule.effective_until && rule.effective_until <= now)) {
    return NextResponse.json({ error: { code: 'RuleInactive' } }, { status: 409 })
  }
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body) || (body.dueAt !== undefined && body.dueAt !== null && typeof body.dueAt !== 'string' && typeof body.dueAt !== 'number')) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Request body or dueAt is invalid.' } }, { status: 400 })
  }
  const dueAt = body.dueAt ? new Date(body.dueAt) : rule.due_days ? new Date(Date.now() + rule.due_days * 24 * 60 * 60 * 1000) : null
  if (dueAt && Number.isNaN(dueAt.getTime())) return NextResponse.json({ error: { code: 'ValidationError', message: 'Invalid dueAt.' } }, { status: 400 })

  const eligibleUnitIds = rule.organization_unit_id
    ? await getOrganizationUnitTreeIds(rule.organization_unit_id)
    : null

  const users = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      ...(eligibleUnitIds ? { organization_memberships: { some: { unit_id: { in: eligibleUnitIds }, status: 'ACTIVE', starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] } } } : {}),
      ...(rule.position_id ? { position_assignments: { some: {
        position_id: rule.position_id,
        ...(eligibleUnitIds ? { unit_id: { in: eligibleUnitIds } } : {}),
        starts_at: { lte: now },
        OR: [{ ends_at: null }, { ends_at: { gt: now } }],
      } } } : {}),
    },
    select: { id: true },
  })
  let created = 0
  for (const user of users) {
    const existing = await prisma.userLearningAssignment.findFirst({ where: { user_id: user.id, rule_id: rule.id, ended_at: null }, select: { id: true } })
    if (!existing) {
      await prisma.userLearningAssignment.create({ data: {
        user_id: user.id, course_id: rule.course_id, rule_id: rule.id, mandatory: rule.mandatory,
        can_view: rule.can_view, can_assess: rule.can_assess, can_earn_stars: rule.can_earn_stars, due_at: dueAt,
      } })
      created++
    }
  }
  return NextResponse.json({ ruleId: rule.id, eligibleUsers: users.length, createdAssignments: created })
}
