import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { matchesLearningRulePositionScope } from '@/lib/learning-rule-scope'

/** Returns an organization unit and all descendants, with cycle protection. */
export async function getOrganizationUnitTreeIds(rootUnitId: string): Promise<string[]> {
  const ids = new Set<string>([rootUnitId])
  let frontier = [rootUnitId]
  while (frontier.length) {
    const children = await prisma.organizationUnit.findMany({
      where: { parent_id: { in: frontier }, id: { notIn: Array.from(ids) } },
      select: { id: true },
    })
    frontier = children.map((child) => child.id)
    frontier.forEach((id) => ids.add(id))
  }
  return Array.from(ids)
}

/** Reconciles active assignments when an organization membership or tenure changes. */
export async function reconcileLearningAssignmentsForUser(
  userId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<{ created: number; ended: number }> {
  const now = new Date()
  const [memberships, positions, rules, activeAssignments] = await Promise.all([
    db.organizationMembership.findMany({ where: { user_id: userId, status: 'ACTIVE', starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] }, select: { unit_id: true } }),
    db.positionAssignment.findMany({ where: { user_id: userId, starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }] }, select: { position_id: true, unit_id: true } }),
    db.learningRule.findMany({ where: { effective_from: { lte: now }, OR: [{ effective_until: null }, { effective_until: { gt: now } }] } }),
    db.userLearningAssignment.findMany({ where: { user_id: userId }, select: { id: true, rule_id: true, course_id: true, status: true, due_at: true, completed_at: true, ended_at: true } }),
  ])
  const unitIds = new Set<string>()
  let unitFrontier = memberships.map((membership) => membership.unit_id)
  while (unitFrontier.length) {
    const newIds = unitFrontier.filter((id) => !unitIds.has(id))
    if (!newIds.length) break
    newIds.forEach((id) => unitIds.add(id))
    const ancestors = await db.organizationUnit.findMany({ where: { id: { in: newIds } }, select: { parent_id: true } })
    unitFrontier = ancestors.map((unit) => unit.parent_id).filter((id): id is string => Boolean(id))
  }
  const scopedUnitRoots = Array.from(new Set(
    rules.filter((rule) => rule.organization_unit_id && rule.position_id)
      .map((rule) => rule.organization_unit_id!),
  ))
  const eligibleUnitsByRule = new Map<string, Set<string>>()
  await Promise.all(scopedUnitRoots.map(async (rootId) => {
    const descendants = new Set([rootId])
    let frontier = [rootId]
    while (frontier.length) {
      const children = await db.organizationUnit.findMany({
        where: { parent_id: { in: frontier }, id: { notIn: Array.from(descendants) } },
        select: { id: true },
      })
      frontier = children.map((child) => child.id)
      frontier.forEach((id) => descendants.add(id))
    }
    eligibleUnitsByRule.set(rootId, descendants)
  }))
  const assignedPositionScopes = positions.map((position) => ({
    positionId: position.position_id,
    unitId: position.unit_id,
  }))

  const applicable = rules.filter((rule) =>
    (!rule.organization_unit_id || unitIds.has(rule.organization_unit_id)) &&
    matchesLearningRulePositionScope(
      { positionId: rule.position_id, organizationUnitId: rule.organization_unit_id },
      assignedPositionScopes,
      rule.organization_unit_id ? eligibleUnitsByRule.get(rule.organization_unit_id) : undefined,
    )
  )
  const applicableIds = new Set(applicable.map((rule) => rule.id))
  const obsolete = activeAssignments.filter((assignment) => !assignment.ended_at && assignment.rule_id && !applicableIds.has(assignment.rule_id))
  if (obsolete.length) {
    const obsoleteIds = obsolete.map((assignment) => assignment.id)
    // The requirement ends, while the earned capability remains available.
    // This lets former LT members keep learning, testing and earning stars.
    await db.userLearningAssignment.updateMany({ where: { id: { in: obsoleteIds } }, data: { mandatory: false, due_at: null } })
    await db.userLearningAssignment.updateMany({
      where: { id: { in: obsoleteIds }, status: { in: ['ASSIGNED', 'IN_PROGRESS', 'OVERDUE'] } },
      data: { status: 'ENDED' },
    })
  }
  const activeRuleIds = new Set(activeAssignments.filter((assignment) => !assignment.ended_at).map((assignment) => assignment.rule_id).filter(Boolean))
  for (const rule of applicable) {
    const existing = activeAssignments.find((assignment) => !assignment.ended_at && (assignment.rule_id === rule.id || assignment.course_id === rule.course_id))
    if (!existing) continue
    const completed = existing.status === 'COMPLETED' || Boolean(existing.completed_at)
    // Rule: Không cộng thêm thời gian nếu khóa học đã có trong danh sách bắt buộc (dù đang học dở)
    const preservedDueAt = completed ? null : (existing.due_at || (rule.due_days ? new Date(now.getTime() + rule.due_days * 86400000) : null))
    await db.userLearningAssignment.update({
      where: { id: existing.id },
      data: {
        mandatory: rule.mandatory,
        rule_id: rule.id,
        can_view: rule.can_view,
        can_assess: rule.can_assess,
        can_earn_stars: rule.can_earn_stars,
        status: completed ? 'COMPLETED' : (existing.status || 'ASSIGNED'),
        due_at: preservedDueAt,
      },
    })
  }
  const missing = applicable.filter((rule) => !activeRuleIds.has(rule.id))
  const completedCourseIds = new Set(activeAssignments.filter((assignment) => assignment.status === 'COMPLETED' || assignment.completed_at).map((assignment) => assignment.course_id))
  const coursesToCheck = Array.from(new Set(missing.map((rule) => rule.course_id).filter((courseId) => !completedCourseIds.has(courseId))))
  await Promise.all(coursesToCheck.map(async (courseId) => {
    const lessons = await db.lesson.findMany({ where: { session: { course_id: courseId } }, select: { id: true, assessment: { select: { id: true } } } })
    if (!lessons.length) return
    const completedLessons = await db.lessonProgress.count({ where: { user_id: userId, lesson_id: { in: lessons.map((lesson) => lesson.id) }, completed: true } })
    if (completedLessons !== lessons.length) return
    const final = await db.assessment.findFirst({ where: { course_id: courseId, type: 'COURSE_FINAL' }, select: { id: true } })
    const assessmentIds = [...lessons.flatMap((lesson) => lesson.assessment ? [lesson.assessment.id] : []), ...(final ? [final.id] : [])]
    if (assessmentIds.length) {
      const passed = await db.attempt.findMany({ where: { user_id: userId, assessment_id: { in: assessmentIds }, passed: true, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } }, select: { assessment_id: true }, distinct: ['assessment_id'] })
      if (new Set(passed.map((attempt) => attempt.assessment_id)).size !== assessmentIds.length) return
    }
    completedCourseIds.add(courseId)
  }))
  if (missing.length) await db.userLearningAssignment.createMany({ data: missing.map((rule) => ({
    status: completedCourseIds.has(rule.course_id) ? 'COMPLETED' as const : 'ASSIGNED' as const,
    completed_at: completedCourseIds.has(rule.course_id) ? now : null,
    user_id: userId, course_id: rule.course_id, rule_id: rule.id, mandatory: rule.mandatory,
    can_view: rule.can_view, can_assess: rule.can_assess, can_earn_stars: rule.can_earn_stars,
    due_at: completedCourseIds.has(rule.course_id)
      ? null : rule.due_days ? new Date(now.getTime() + rule.due_days * 24 * 60 * 60 * 1000) : null,
  })) })
  return { created: missing.length, ended: obsolete.length }
}

/** Materializes course completion onto active assignments for deadline enforcement. */
export async function syncCourseAssignmentCompletion(userId: string, courseId: string): Promise<boolean> {
  const [lessons, course] = await Promise.all([
    prisma.lesson.findMany({
      where: { session: { course_id: courseId } },
      select: { id: true, assessment: { select: { id: true } } },
    }),
    prisma.course.findUnique({ where: { id: courseId }, select: { final_assessment: { select: { id: true } } } }),
  ])
  if (!lessons.length) return false
  const completed = await prisma.lessonProgress.count({
    where: { user_id: userId, lesson_id: { in: lessons.map((lesson) => lesson.id) }, completed: true },
  })
  if (completed !== lessons.length) return false
  const requiredAssessmentIds = [
    ...lessons.flatMap((lesson) => lesson.assessment ? [lesson.assessment.id] : []),
    ...(course?.final_assessment ? [course.final_assessment.id] : []),
  ]
  if (requiredAssessmentIds.length) {
    const passed = await prisma.attempt.findMany({
      where: {
        user_id: userId,
        assessment_id: { in: requiredAssessmentIds },
        passed: true,
        status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
      },
      select: { assessment_id: true },
      distinct: ['assessment_id'],
    })
    if (new Set(passed.map((attempt) => attempt.assessment_id)).size !== requiredAssessmentIds.length) return false
  }
  await prisma.userLearningAssignment.updateMany({
    where: { user_id: userId, course_id: courseId, ended_at: null, status: { in: ['ASSIGNED', 'IN_PROGRESS', 'OVERDUE'] } },
    data: { status: 'COMPLETED', completed_at: new Date() },
  })
  return true
}
