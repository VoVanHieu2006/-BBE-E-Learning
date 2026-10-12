export type OrganizationAssignmentStatus = 'ALL' | 'ACTIVE' | 'SCHEDULED' | 'ENDED'
export type OrganizationMembershipFilterStatus = 'ALL' | 'ACTIVE' | 'ENDED'

export interface OrganizationPagination {
  page: number
  limit: number
  total: number
  totalPages: number
  skip: number
}

function positiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback
  const raw = String(value).trim()
  if (!/^\d+$/.test(raw)) return fallback
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function normalizeOrganizationSearch(value: unknown, maxLength = 120): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

export function isOrganizationId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function normalizeOrganizationPagination(
  pageValue: unknown,
  limitValue: unknown,
  totalValue: number,
  defaultLimit = 20,
  maxLimit = 50,
): OrganizationPagination {
  const limit = Math.min(positiveInteger(limitValue, defaultLimit), maxLimit)
  const total = Number.isSafeInteger(totalValue) && totalValue > 0 ? totalValue : 0
  const totalPages = Math.ceil(total / limit)
  const requestedPage = positiveInteger(pageValue, 1)
  const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages)
  return { page, limit, total, totalPages, skip: (page - 1) * limit }
}

export function parseMembershipFilterStatus(value: unknown): OrganizationMembershipFilterStatus {
  return value === 'ACTIVE' || value === 'ENDED' ? value : 'ALL'
}

export function parseAssignmentFilterStatus(value: unknown): OrganizationAssignmentStatus {
  return value === 'ACTIVE' || value === 'SCHEDULED' || value === 'ENDED' ? value : 'ALL'
}
