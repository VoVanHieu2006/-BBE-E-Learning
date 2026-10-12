import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { reconcileLearningAssignmentsForUser } from '@/lib/learning-assignments'
import { isOrganizationId } from '@/lib/organization-admin-rules'

/** Admin-only lifecycle controls for immutable learning-rule history. */
export async function PATCH(request: NextRequest, { params }: { params: { ruleId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if (auth.context?.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  if (!isOrganizationId(params.ruleId)) return NextResponse.json({ error: { code: 'ValidationError', message: 'A valid learning rule ID is required.' } }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.action !== 'DEACTIVATE') {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Action không hợp lệ.' } }, { status: 400 })
  }
  const rule = await prisma.learningRule.findUnique({ where: { id: params.ruleId } })
  if (!rule) return NextResponse.json({ error: { code: 'RuleNotFound' } }, { status: 404 })

  const now = new Date()
  if (rule.effective_until && rule.effective_until <= now) {
    return NextResponse.json({ error: { code: 'RuleInactive', message: 'Rule này đã ngừng áp dụng.' } }, { status: 409 })
  }

  // A future rule can be cancelled by giving it a zero-length effective window.
  const effectiveUntil = rule.effective_from > now ? rule.effective_from : now
  const updated = await prisma.$transaction(async (tx) => {
    const changed = await tx.learningRule.update({ where: { id: rule.id }, data: { effective_until: effectiveUntil } })
    await tx.auditLog.create({
      data: {
        actor_user_id: auth.context!.userId,
        action: 'DEACTIVATE_LEARNING_RULE',
        entity_type: 'LEARNING_RULE',
        entity_id: rule.id,
        metadata: { effectiveUntil: effectiveUntil.toISOString(), courseId: rule.course_id },
      },
    })
    return changed
  })
  const affectedAssignments = await prisma.userLearningAssignment.findMany({
    where: { rule_id: rule.id, ended_at: null },
    select: { id: true, user_id: true },
  })
  const affectedUserIds = Array.from(new Set(affectedAssignments.map((assignment) => assignment.user_id)))
  for (let index = 0; index < affectedUserIds.length; index += 25) {
    const batch = affectedUserIds.slice(index, index + 25)
    await Promise.all(batch.map((userId) => reconcileLearningAssignmentsForUser(userId)))
  }
  const endedAssignments = affectedAssignments.length
    ? await prisma.userLearningAssignment.count({ where: { id: { in: affectedAssignments.map((assignment) => assignment.id) }, ended_at: { not: null } } })
    : 0

  return NextResponse.json({ rule: updated, affectedUsers: affectedUserIds.length, endedAssignments }, { status: 200 })
}
