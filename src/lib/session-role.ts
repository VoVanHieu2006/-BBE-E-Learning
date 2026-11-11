import { isAccountRole, isLeadRole } from './roles'

export type ManagerKind = 'LEAD_CHAPTER' | 'LEAD_DNA' | null

export function hasCurrentSessionClaims(payload: { [key: string]: unknown; role?: unknown; authVersion?: unknown }) {
  return isAccountRole(payload.role) && Number.isInteger(payload.authVersion) && Number(payload.authVersion) >= 0
}

export function sessionMatchesAccount(payload: { [key: string]: unknown; role?: unknown; authVersion?: unknown }, user: { role: string; auth_version: number }) {
  return hasCurrentSessionClaims(payload) && payload.role === user.role && payload.authVersion === user.auth_version
}

export function accountHome(role: unknown, managerKind?: unknown) {
  if (role === 'ADMIN') return '/admin/dashboard'
  if (isLeadRole(role)) return managerKind === 'LEAD_CHAPTER' ? '/chapter-manager/dashboard' : '/organization-manager'
  return '/student/dashboard'
}

export function canOpenManagerArea(area: 'CHAPTER' | 'DNA', role: unknown, managerKind?: unknown) {
  return role === 'ADMIN' || (isLeadRole(role) && managerKind === (area === 'CHAPTER' ? 'LEAD_CHAPTER' : 'LEAD_DNA'))
}
