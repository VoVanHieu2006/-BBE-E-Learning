export interface LearningRulePositionScope {
  positionId: string | null
  organizationUnitId: string | null
}

export interface AssignedPositionScope {
  positionId: string
  unitId: string
}

/**
 * A position-only rule applies to active holders anywhere. When a rule also
 * names an organization unit, the tenure must be in that unit or a descendant;
 * an identically named position in another Chapter must not grant access.
 */
export function matchesLearningRulePositionScope(
  rule: LearningRulePositionScope,
  assignments: readonly AssignedPositionScope[],
  eligibleUnitIds?: ReadonlySet<string>,
): boolean {
  if (!rule.positionId) return true
  if (rule.organizationUnitId && !eligibleUnitIds) return false

  return assignments.some((assignment) =>
    assignment.positionId === rule.positionId &&
    (!rule.organizationUnitId || eligibleUnitIds!.has(assignment.unitId)),
  )
}
