/** Canonical account roles. Invitation kinds and position codes are separate. */
export type AccountRole = 'ADMIN' | 'LEAD' | 'MEMBER'

export function isLeadRole(role: unknown): role is 'LEAD' {
  return role === 'LEAD'
}

export function isAccountRole(role: unknown): role is AccountRole {
  return role === 'ADMIN' || isLeadRole(role) || role === 'MEMBER'
}

export function isLearnerRole(role: unknown): role is 'MEMBER' {
  return role === 'MEMBER'
}

export function canHoldPosition(role: unknown, code: string): boolean {
  if (isLeadRole(role)) return code === 'CHAPTER_LEAD' || code === 'DNA_LEAD'
  return isLearnerRole(role) && ['PRESIDENT', 'DEPARTMENT_LEAD', 'DEPARTMENT_MEMBER', 'DNA_MEMBER'].includes(code)
}
