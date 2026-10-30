import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { matchesLearningRulePositionScope } from '@/lib/learning-rule-scope'
import { learningContext, lockLearningUser, currentCycleAttemptFilter } from './learning-periods'
import { reconcileSharedPath } from './shared-learning-path'
import { learningTargetsForUser } from './learning-targets'
import { prepareOrganizationTransition } from './organization-transition'

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
async function reconcileAssignments(
  userId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<{ created: number; ended: number }> {
  const now = await lockLearningUser(db, userId)
  const context = await learningContext(db, userId, now)
  const dna = await db.organizationMembership.findFirst({ where: { user_id: userId, status: 'ACTIVE', starts_at: { lte: now }, OR: [{ ends_at: null }, { ends_at: { gt: now } }], unit: { type: { in: ['DNA', 'DNA_GROUP'] } } } })
  if (dna) {
    await prepareOrganizationTransition(db, userId, dna.unit_id)
    if (context.cycle.provenance === 'LEGACY') await db.learningCycle.update({ where: { id: context.cycle.id }, data: { chapter_id: null } })
  }
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

  const targetCodes = await learningTargetsForUser(db, userId, now)
  const applicable = rules.filter((rule) =>
    (!rule.target_code || targetCodes.has(rule.target_code)) &&
    (!rule.organization_unit_id || unitIds.has(rule.organization_unit_id)) &&
    matchesLearningRulePositionScope(
      { positionId: rule.position_id, organizationUnitId: rule.organization_unit_id },
      assignedPositionScopes,
      rule.organization_unit_id ? eligibleUnitsByRule.get(rule.organization_unit_id) : undefined,
    )
  )
  const byCourse = new Map<string, typeof applicable>()
  for (const rule of applicable) byCourse.set(rule.course_id, [...(byCourse.get(rule.course_id) || []), rule])
  const current = await db.userLearningAssignment.findMany({ where: { user_id: userId, learning_cycle_id: context.cycle.id } })
  let created = 0, ended = 0
  for (const assignment of current) if (!byCourse.has(assignment.course_id) && !assignment.ended_at) {
    await db.userLearningAssignment.update({ where: { id: assignment.id }, data: { mandatory: false, ended_at: now, status: assignment.completed_at ? 'COMPLETED' : 'ENDED' } })
    ended++
  }
  for (const [courseId, sources] of Array.from(byCourse)) {
    const existing = current.find((row) => row.course_id === courseId)
    const imported = !existing && context.cycle.provenance === 'LEGACY'
      ? activeAssignments.find((row) => row.course_id === courseId && !row.ended_at) : null
    const data = {
      learning_cycle_id: context.cycle.id, rule_id: sources[0].id, source_rule_ids: sources.map((row) => row.id),
      mandatory: sources.some((row) => row.mandatory), can_view: sources.every((row) => row.can_view),
      can_assess: sources.every((row) => row.can_assess), can_earn_stars: sources.every((row) => row.can_earn_stars), ended_at: null,
    }
    if (existing || imported) {
      const row = existing || imported!
      await db.userLearningAssignment.update({ where: { id: row.id }, data: { ...data, status: row.completed_at ? 'COMPLETED' : row.status === 'OVERDUE' ? 'OVERDUE' : 'ASSIGNED' } })
    } else {
      await db.userLearningAssignment.create({ data: { ...data, user_id: userId, course_id: courseId, assigned_at: now } })
      created++
    }
  }
  // Legacy duplicates remain available as history, but never enforce a second deadline.
  await db.userLearningAssignment.updateMany({ where: { user_id: userId, learning_cycle_id: null, ended_at: null }, data: { ended_at: now } })
  for (const courseId of Array.from(byCourse.keys())) await syncCourseAssignmentCompletion(userId, courseId, db)
  const requiredCourseIds = Array.from(byCourse).filter(([, sources]) => sources.some((row) => row.mandatory)).map(([courseId]) => courseId)
  await db.supplementalLearningRequirement.updateMany({ where: { user_id: userId, learning_cycle_id: context.cycle.id, ended_at: null, course_id: { notIn: requiredCourseIds } }, data: { ended_at: now } })
  await reconcileSharedPath(db, userId, context.cycle.id, now)
  return { created, ended }
}

/** Materializes course completion onto active assignments for deadline enforcement. */
export async function syncCourseAssignmentCompletion(userId: string, courseId: string, db: Prisma.TransactionClient = prisma): Promise<boolean> {
  const cycleFilter = await currentCycleAttemptFilter(db, userId)
  const [lessons, course, cycle] = await Promise.all([
    db.lesson.findMany({
      where: { session: { course_id: courseId } },
      select: { id: true, assessment: { select: { id: true } } },
    }),
    db.course.findUnique({ where: { id: courseId }, select: { final_assessment: { select: { id: true } } } }),
    db.learningCycle.findFirst({ where: { user_id: userId, ends_at: null }, select: { id: true } }),
  ])
  if (!lessons.length) return false
  const lessonIds = lessons.map((lesson) => lesson.id)
  // The active learning cycle is the source of truth for training completion.
  // Legacy rows are used only when the learner has no cycle yet.
  const completedRows = cycle
    ? await db.cycleLessonProgress.findMany({
        where: { user_id: userId, learning_cycle_id: cycle.id, lesson_id: { in: lessonIds }, completed_at: { not: null } },
        select: { lesson_id: true },
      })
    : await db.lessonProgress.findMany({ where: { user_id: userId, completed: true, lesson_id: { in: lessonIds } }, select: { lesson_id: true } })
  const completedSet = new Set(completedRows.map((row) => row.lesson_id))
  const supplements = await db.supplementalLearningRequirement.findMany({ where: { user_id: userId, course_id: courseId, ended_at: null, completed_at: null } })
  for (const supplement of supplements) if (supplement.lesson_ids.every((id) => completedSet.has(id))) await db.supplementalLearningRequirement.update({ where: { id: supplement.id }, data: { completed_at: new Date() } })
  const completed = completedSet.size
  if (completed !== lessons.length) return false
  const requiredAssessmentIds = [
    ...lessons.flatMap((lesson) => lesson.assessment ? [lesson.assessment.id] : []),
    ...(course?.final_assessment ? [course.final_assessment.id] : []),
  ]
  if (requiredAssessmentIds.length) {
    const passed = await db.attempt.findMany({
      where: {
        user_id: userId,
        assessment_id: { in: requiredAssessmentIds },
        ...cycleFilter,
        passed: true,
        status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
      },
      select: { assessment_id: true },
      distinct: ['assessment_id'],
    })
    if (new Set(passed.map((attempt) => attempt.assessment_id)).size !== requiredAssessmentIds.length) return false
  }
  await db.userLearningAssignment.updateMany({
    where: { user_id: userId, course_id: courseId, ended_at: null, status: { in: ['ASSIGNED', 'IN_PROGRESS', 'OVERDUE'] } },
    data: { status: 'COMPLETED', completed_at: new Date() },
  })
  return true
}

export async function reconcileLearningAssignmentsForUser(userId: string, db: Prisma.TransactionClient = prisma) {
  if (db !== prisma) return reconcileAssignments(userId, db)
  return prisma.$transaction((tx) => reconcileAssignments(userId, tx), { timeout: 30_000 })
}
