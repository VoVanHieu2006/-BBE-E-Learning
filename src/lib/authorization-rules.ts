/** Permissions retained for users still on the legacy Chapter Leader role. */
const LEGACY_CHAPTER_COMPATIBILITY_PERMISSIONS = new Set([
  'VIEW_MEMBER_PROGRESS',
  'MANAGE_CHAPTER_MEMBERS',
])

export function isLegacyChapterCompatibilityPermission(permissionCode: string): boolean {
  return LEGACY_CHAPTER_COMPATIBILITY_PERMISSIONS.has(permissionCode)
}

/** Legacy Chapter access must follow current membership, never a stale JWT claim. */
export function resolveLegacyChapterMembershipScope(chapterIds: readonly string[]): string | undefined {
  const unique = Array.from(new Set(chapterIds))
  return unique.length === 1 ? unique[0] : undefined
}

/** Comment moderation is scoped to the author or a global Admin. */
export function canDeleteLessonComment(actorRole: string, isAuthor: boolean): boolean {
  return isAuthor || actorRole === 'ADMIN'
}

/** A position at a unit may grant permission to that unit and descendants only. */
export function hasPermissionInOrganizationScope(
  assignedUnitIds: readonly string[],
  targetAncestors: readonly string[],
): boolean {
  const targetScope = new Set(targetAncestors)
  return assignedUnitIds.some((unitId) => targetScope.has(unitId))
}
