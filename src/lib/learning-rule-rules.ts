export interface LearningRuleInput {
  courseId: string
  organizationUnitId: string | null
  positionId: string | null
  mandatory: boolean
  canView: boolean
  canAssess: boolean
  canEarnStars: boolean
  dueDays: number | null
  effectiveFrom: Date
  effectiveUntil: Date | null
}

export type LearningRuleInputResult =
  | { ok: true; value: LearningRuleInput }
  | { ok: false; code: 'ValidationError'; message: string }

function optionalId(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !value.trim()) return undefined
  const id = value.trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return undefined
  return id
}

function optionalDate(value: unknown, defaultValue: Date | null): Date | null | undefined {
  if (value === undefined || value === null) return defaultValue
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).trim()
  if (!text) return undefined
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function optionalBoolean(value: unknown, defaultValue: boolean): boolean | undefined {
  if (value === undefined) return defaultValue
  return typeof value === 'boolean' ? value : undefined
}

export function parseLearningRuleInput(input: unknown, now = new Date()): LearningRuleInputResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'ValidationError', message: 'Request body must be an object.' }
  }
  const body = input as Record<string, unknown>
  const courseId = optionalId(body.courseId)
  const organizationUnitId = optionalId(body.organizationUnitId)
  const positionId = optionalId(body.positionId)
  const effectiveFrom = optionalDate(body.effectiveFrom, now)
  const effectiveUntil = optionalDate(body.effectiveUntil, null)
  const dueDaysRaw = body.dueDays
  const dueDays = dueDaysRaw === undefined || dueDaysRaw === null || dueDaysRaw === ''
    ? null
    : typeof dueDaysRaw === 'number' || (typeof dueDaysRaw === 'string' && /^\d+$/.test(dueDaysRaw.trim()))
      ? Number(dueDaysRaw)
      : Number.NaN

  const mandatory = optionalBoolean(body.mandatory, true)
  const canView = optionalBoolean(body.canView, true)
  const canAssess = optionalBoolean(body.canAssess, true)
  const canEarnStars = optionalBoolean(body.canEarnStars, canAssess === true && canView === true)

  if (!courseId || organizationUnitId === undefined || positionId === undefined) {
    return { ok: false, code: 'ValidationError', message: 'A valid course and valid optional organization/position IDs are required.' }
  }
  if (!effectiveFrom || effectiveUntil === undefined || (effectiveUntil && effectiveUntil <= effectiveFrom)) {
    return { ok: false, code: 'ValidationError', message: 'Effective dates must be valid and the end must be later than the start.' }
  }
  if (dueDays !== null && (!Number.isSafeInteger(dueDays) || dueDays < 1 || dueDays > 3650)) {
    return { ok: false, code: 'ValidationError', message: 'dueDays must be an integer between 1 and 3650, or null.' }
  }
  if (mandatory === undefined || canView === undefined || canAssess === undefined || canEarnStars === undefined) {
    return { ok: false, code: 'ValidationError', message: 'Learning rule flags must be booleans.' }
  }
  if ((!canView && (canAssess || canEarnStars)) || (!canAssess && canEarnStars)) {
    return { ok: false, code: 'ValidationError', message: 'A rule that cannot be viewed or assessed cannot allow quiz attempts or Stars.' }
  }

  return {
    ok: true,
    value: {
      courseId,
      organizationUnitId,
      positionId,
      mandatory,
      canView,
      canAssess,
      canEarnStars,
      dueDays,
      effectiveFrom,
      effectiveUntil,
    },
  }
}
