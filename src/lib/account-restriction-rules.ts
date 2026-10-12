/** Combine legacy roster membership, current organization membership, and active tenure. */
export function collectChapterAccountIds(...sources: string[][]): string[] {
  return Array.from(new Set(sources.flat().filter(Boolean)))
}

/** A lifted restriction must not reactivate an account while any other lock remains. */
export function canActivateAfterRestrictionLift(hasAnyActiveRestriction: boolean): boolean {
  return !hasAnyActiveRestriction
}

/** Automated learning deadlines must never disable a platform Admin account. */
export function canDeadlineLockAccount(role: string): boolean {
  return role !== 'ADMIN'
}
