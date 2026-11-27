import { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from './prisma'
import { competitionMonthBounds } from './learning-cycle-rules'
import { AssessmentConfigUpdate, AssessmentSchedule, LOCKING_ATTEMPT_STATUSES } from './quiz-schedule-rules'
import { lockCourseExamBank } from './final-exam-bank'
import { createFinalExamVersion } from './final-exam-version'

type Tx = Prisma.TransactionClient
type Client = PrismaClient | Tx

export const CLEARED_ASSESSMENT_SCHEDULE = {
  scheduled_question_count: null, scheduled_duration_minutes: null, scheduled_effective_at: null,
  scheduled_effective_month_key: null, scheduled_by_user_id: null, scheduled_at: null,
} as const

export interface ScheduledConfig { questionCount: number; durationMinutes: number; effectiveAt: string; effectiveMonthKey: string | null }
export interface ScheduleColumns {
  question_count: number; duration_minutes: number
  scheduled_question_count: number | null; scheduled_duration_minutes: number | null
  scheduled_effective_at: Date | null; scheduled_effective_month_key: string | null
}

export function scheduledConfigOf(a: ScheduleColumns): ScheduledConfig | null {
  return a.scheduled_effective_at ? {
    questionCount: a.scheduled_question_count ?? a.question_count, durationMinutes: a.scheduled_duration_minutes ?? a.duration_minutes,
    effectiveAt: a.scheduled_effective_at.toISOString(), effectiveMonthKey: a.scheduled_effective_month_key,
  } : null
}

export function existingScheduleOf(a: ScheduleColumns | null | undefined): AssessmentSchedule | null {
  return a?.scheduled_effective_at ? {
    questionCount: a.scheduled_question_count ?? a.question_count, durationMinutes: a.scheduled_duration_minutes ?? a.duration_minutes,
    effectiveAt: a.scheduled_effective_at, effectiveMonthKey: a.scheduled_effective_month_key ?? competitionMonthBounds(a.scheduled_effective_at).key,
  } : null
}

/** Column writes for a resolved update: CLEAR nulls the schedule, KEEP leaves it, UPSERT records who scheduled what for when. */
export function scheduleColumns(update: AssessmentConfigUpdate, actor: string, now: Date) {
  if (update.scheduleAction === 'KEEP') return {}
  if (update.scheduleAction === 'CLEAR' || !update.schedule) return { ...CLEARED_ASSESSMENT_SCHEDULE }
  const s = update.schedule
  return {
    scheduled_question_count: s.questionCount, scheduled_duration_minutes: s.durationMinutes, scheduled_effective_at: s.effectiveAt,
    scheduled_effective_month_key: s.effectiveMonthKey, scheduled_by_user_id: actor, scheduled_at: now,
  }
}

/** True when the resolved schedule is new or differs from what was stored, i.e. worth telling the admin about. */
export function scheduleChanged(update: AssessmentConfigUpdate, before: AssessmentSchedule | null) {
  const s = update.scheduleAction === 'UPSERT' ? update.schedule : null
  return Boolean(s && (!before || before.questionCount !== s.questionCount || before.durationMinutes !== s.durationMinutes))
}

const lockingAttemptWhere = (now: Date) => {
  const bounds = competitionMonthBounds(now)
  return { started_at: { gte: bounds.startsAt, lt: bounds.endsAt }, status: { in: [...LOCKING_ATTEMPT_STATUSES] } }
}

/** CANCELLED attempts and attempts started in an earlier VN month never lock this month's config. */
export async function hasCurrentMonthLockingAttempts(tx: Tx, assessmentId: string, now: Date): Promise<boolean> {
  return (await tx.attempt.count({ where: { assessment_id: assessmentId, ...lockingAttemptWhere(now) } })) > 0
}

export async function currentMonthLockedAssessmentIds(client: Tx, assessmentIds: string[], now: Date): Promise<Set<string>> {
  if (!assessmentIds.length) return new Set()
  const rows = await client.attempt.findMany({ where: { assessment_id: { in: assessmentIds }, ...lockingAttemptWhere(now) }, select: { assessment_id: true }, distinct: ['assessment_id'] })
  return new Set(rows.map(row => row.assessment_id))
}

export interface AssessmentScheduleMeta {
  assessmentId: string; hasCurrentMonthAttempts: boolean; currentQuestionCount: number; currentDurationMinutes: number; scheduledConfig: ScheduledConfig | null
}
export function assessmentScheduleMeta(a: ScheduleColumns & { id: string }, locked: Set<string>): AssessmentScheduleMeta {
  return { assessmentId: a.id, hasCurrentMonthAttempts: locked.has(a.id), currentQuestionCount: a.question_count, currentDurationMinutes: a.duration_minutes, scheduledConfig: scheduledConfigOf(a) }
}

/** Keyed by lessonId, plus 'COURSE_FINAL', so editors can show the locked month and the pending next month. */
export async function courseScheduleMeta(client: Tx, course: {
  sessions: { lessons: { id: string; assessment: (ScheduleColumns & { id: string }) | null }[] }[]
  final_assessment: (ScheduleColumns & { id: string }) | null
}, now: Date): Promise<Record<string, AssessmentScheduleMeta>> {
  const lessons = course.sessions.flatMap(s => s.lessons).filter(l => l.assessment)
  const locked = await currentMonthLockedAssessmentIds(client, [...lessons.map(l => l.assessment!.id), ...(course.final_assessment ? [course.final_assessment.id] : [])], now)
  const meta: Record<string, AssessmentScheduleMeta> = {}
  for (const l of lessons) meta[l.id] = assessmentScheduleMeta(l.assessment!, locked)
  if (course.final_assessment) meta.COURSE_FINAL = assessmentScheduleMeta(course.final_assessment, locked)
  return meta
}

const dueSelect = {
  id: true, type: true, title: true, description: true, question_count: true, duration_minutes: true, created_by: true,
  scheduled_question_count: true, scheduled_duration_minutes: true, scheduled_effective_at: true, scheduled_by_user_id: true,
} satisfies Prisma.AssessmentSelect

/** Caller holds no lock; this takes the course exam-bank lock first and re-reads, so concurrent callers apply once. */
export async function applyDueCourseAssessmentSchedules(tx: Tx, courseId: string, now: Date, assessmentIds?: string[]): Promise<string[]> {
  await lockCourseExamBank(tx, courseId)
  const due = await tx.assessment.findMany({
    where: { scheduled_effective_at: { lte: now }, ...(assessmentIds ? { id: { in: assessmentIds } } : {}), OR: [{ course_id: courseId }, { lesson: { session: { course_id: courseId } } }] },
    select: dueSelect,
  })
  for (const a of due) {
    const questionCount = a.scheduled_question_count ?? a.question_count
    const durationMinutes = a.scheduled_duration_minutes ?? a.duration_minutes
    if (a.type === 'COURSE_FINAL') {
      await createFinalExamVersion(tx, courseId, { title: a.title, description: a.description, questionCount, durationMinutes }, a.scheduled_by_user_id || a.created_by)
      await tx.assessment.update({ where: { id: a.id }, data: { ...CLEARED_ASSESSMENT_SCHEDULE } })
    } else {
      await tx.assessment.update({ where: { id: a.id }, data: { question_count: questionCount, duration_minutes: durationMinutes, ...CLEARED_ASSESSMENT_SCHEDULE } })
    }
  }
  return due.map(a => a.id)
}

/**
 * Activates next-month configs whose `scheduled_effective_at` has passed. Used by cron and lazily before reads/attempt starts.
 * Attempts already in progress keep their own expires_at and question set.
 */
export async function applyDueAssessmentSchedules(client: Client = prisma, options: { assessmentId?: string; courseId?: string; now?: Date } = {}) {
  const now = options.now ?? new Date()
  const candidates = await client.assessment.findMany({
    where: {
      scheduled_effective_at: { lte: now },
      ...(options.assessmentId ? { id: options.assessmentId } : {}),
      ...(options.courseId ? { OR: [{ course_id: options.courseId }, { lesson: { session: { course_id: options.courseId } } }] } : {}),
    },
    select: { id: true, course_id: true, lesson: { select: { session: { select: { course_id: true } } } } },
  })
  const byCourse = new Map<string, string[]>()
  for (const c of candidates) {
    const courseId = c.course_id ?? c.lesson?.session.course_id
    if (courseId) byCourse.set(courseId, [...(byCourse.get(courseId) || []), c.id])
  }
  const appliedAssessmentIds: string[] = []
  for (const [courseId, ids] of Array.from(byCourse)) {
    if (!('$transaction' in client)) { appliedAssessmentIds.push(...await applyDueCourseAssessmentSchedules(client, courseId, now, ids)); continue }
    try {
      appliedAssessmentIds.push(...await client.$transaction(tx => applyDueCourseAssessmentSchedules(tx, courseId, now, ids), { timeout: 30_000, maxWait: 10_000 }))
    } catch (error) {
      // One course's broken bank must not block other courses; the schedule stays pending and is retried next call.
      console.error('[ASSESSMENT_SCHEDULE_APPLY_ERROR]', courseId, error)
    }
  }
  return { appliedCount: appliedAssessmentIds.length, appliedAssessmentIds }
}
