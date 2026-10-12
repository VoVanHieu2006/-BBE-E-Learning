export type PositionScope = 'PLATFORM' | 'DNA' | 'CHAPTER' | 'DEPARTMENT'
export type OrganizationUnitKind = 'ROOT' | 'DNA' | 'CHAPTER' | 'DEPARTMENT'

export interface OrganizationNodeRef {
  id: string
  parentId: string | null
  type?: string
}

/** Produces a stable preorder tree for admin views; orphan/cyclic rows stay visible. */
export function orderOrganizationTree<T extends OrganizationNodeRef>(units: readonly T[]): Array<{ unit: T; depth: number }> {
  const ids = new Set(units.map((unit) => unit.id))
  const childrenByParent = new Map<string | null, T[]>()
  for (const unit of units) {
    const parentId = unit.parentId && ids.has(unit.parentId) ? unit.parentId : null
    const children = childrenByParent.get(parentId) || []
    children.push(unit)
    childrenByParent.set(parentId, children)
  }
  const compare = (a: T, b: T) => (a.type || '').localeCompare(b.type || '') || a.id.localeCompare(b.id)
  const ordered: Array<{ unit: T; depth: number }> = []
  const visited = new Set<string>()
  const visit = (unit: T, depth: number) => {
    if (visited.has(unit.id)) return
    visited.add(unit.id)
    ordered.push({ unit, depth })
    for (const child of (childrenByParent.get(unit.id) || []).sort(compare)) visit(child, depth + 1)
  }
  for (const root of (childrenByParent.get(null) || []).sort(compare)) visit(root, 0)
  // Keep invalid legacy cycles visible without recursing forever.
  for (const unit of [...units].sort(compare)) visit(unit, 0)
  return ordered
}

export type OrganizationMoveValidation =
  | { ok: true }
  | { ok: false; code: 'OrganizationUnitNotFound' | 'OrganizationParentNotFound' | 'OrganizationCycle' | 'OrganizationParentTypeInvalid' }

/** DNA and Chapters are sibling systems; Departments belong directly to a Chapter. */
export function organizationParentTypeMatches(childType: string, parentType: string | null): boolean {
  if (childType === 'ROOT') return parentType === null
  if (childType === 'DNA' || childType === 'CHAPTER') return parentType === null || parentType === 'ROOT'
  if (childType === 'DEPARTMENT') return parentType === 'CHAPTER'
  return false
}

/** Returns a unit and all descendants, while remaining safe on corrupt cyclic input. */
export function organizationSubtreeIds(units: readonly OrganizationNodeRef[], rootId: string): Set<string> {
  const descendants = new Set([rootId])
  let frontier = [rootId]
  while (frontier.length) {
    const children = units.filter((unit) => unit.parentId && frontier.includes(unit.parentId) && !descendants.has(unit.id))
    frontier = children.map((unit) => unit.id)
    for (const childId of frontier) descendants.add(childId)
  }
  return descendants
}

/** Validate reparenting against the BBE DNA/Chapter/Department topology. */
export function validateOrganizationMove(
  units: readonly OrganizationNodeRef[],
  unitId: string,
  newParentId: string | null,
): OrganizationMoveValidation {
  const unit = units.find((candidate) => candidate.id === unitId)
  if (!unit) return { ok: false, code: 'OrganizationUnitNotFound' }
  const parent = newParentId === null ? null : units.find((candidate) => candidate.id === newParentId)
  if (newParentId !== null && !parent) {
    return { ok: false, code: 'OrganizationParentNotFound' }
  }
  if (newParentId && organizationSubtreeIds(units, unitId).has(newParentId)) {
    return { ok: false, code: 'OrganizationCycle' }
  }
  if (!organizationParentTypeMatches(unit.type || '', parent?.type || null)) {
    return { ok: false, code: 'OrganizationParentTypeInvalid' }
  }
  return { ok: true }
}

/** Prevents appointing a platform/DNA/chapter/department role at the wrong tree level. */
export function positionScopeMatchesUnitType(scope: string, unitType: string): boolean {
  const requiredUnitType: Record<PositionScope, OrganizationUnitKind> = {
    PLATFORM: 'ROOT',
    DNA: 'DNA',
    CHAPTER: 'CHAPTER',
    DEPARTMENT: 'DEPARTMENT',
  }
  return scope in requiredUnitType && requiredUnitType[scope as PositionScope] === unitType
}
