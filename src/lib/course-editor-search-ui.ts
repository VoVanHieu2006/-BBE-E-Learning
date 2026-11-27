import { MAX_LESSON_QUIZ_POOLS, MAX_LESSON_QUIZ_QUESTIONS, mergeImportedQuizBank, nextCompetitionMonthSchedule, validateLessonBankForCounts } from './quiz-schedule-rules'
import { CourseQuestionSearchResult, QuizQuestionMatch, SearchableCourseSession, SearchableQuizQuestion, matchQuizQuestion, normalizeVietnameseSearch } from './quiz-search'

/** Pure helpers behind the Admin quiz editor: search, import, monthly schedule and course-wide jump. */

export interface EditorQuestion extends SearchableQuizQuestion { id?: string }

export const questionKeyOf = (question: { id?: string }, index: number) => question.id || `idx-${index}`
export const questionDomId = (key: string) => `quiz-question-${key.replace(/[^\w-]/g, '_')}`

export interface FilteredQuestionEntry<T> { index: number; question: T; match: QuizQuestionMatch }
export interface FilteredQuizBank<T> {
  active: boolean
  entries: FilteredQuestionEntry<T>[]
  byPool: Map<number, FilteredQuestionEntry<T>[]>
  visiblePools: number[]
  matchCount: number
  total: number
}

export const isQuizFilterActive = (query: string, poolFilter: number | null) => normalizeVietnameseSearch(query) !== '' || poolFilter !== null

/** Every entry keeps its index in the full question list: all edits must use `index`, never the position in `entries`. */
export function filterQuizBank<T extends EditorQuestion>(questions: T[], poolCount: number, query: string, poolFilter: number | null): FilteredQuizBank<T> {
  const active = isQuizFilterActive(query, poolFilter)
  const entries: FilteredQuestionEntry<T>[] = []
  questions.forEach((question, index) => {
    const match = matchQuizQuestion(question, query, poolFilter)
    if (match.matched) entries.push({ index, question, match })
  })
  const byPool = new Map<number, FilteredQuestionEntry<T>[]>()
  for (const entry of entries) {
    const pool = entry.question.poolIndex ?? 0
    byPool.set(pool, [...(byPool.get(pool) || []), entry])
  }
  const visiblePools = Array.from({ length: poolCount }, (_, pool) => pool).filter(pool => !active || byPool.has(pool))
  return { active, entries, byPool, visiblePools, matchCount: entries.length, total: questions.length }
}

export function updateQuestionAt<T>(questions: T[], index: number, update: (question: T) => T): T[] {
  if (!Number.isInteger(index) || index < 0 || index >= questions.length) return questions
  return questions.map((question, i) => i === index ? update(question) : question)
}

export function removeQuestionAt<T>(questions: T[], index: number): T[] {
  if (!Number.isInteger(index) || index < 0 || index >= questions.length) return questions
  return questions.filter((_, i) => i !== index)
}

export type QuizImportMode = 'append' | 'replace'
export const defaultImportMode = (questionCount: number): QuizImportMode => questionCount > 0 ? 'append' : 'replace'
/** Replace discards the drafted list, so any existing question (even one unsaved) needs confirmation. */
export const needsReplaceConfirm = (questionCount: number) => questionCount > 0

export type QuizImportResult<T> =
  | { ok: true; poolNames: string[]; poolIds: string[]; questions: T[] }
  | { ok: false; message: string }

export function applyQuizImport<T extends { poolIndex?: number }>(input: {
  mode: QuizImportMode; poolNames: string[]; poolIds: string[]; questions: T[]
  importedPools: string[]; importedQuestions: T[]; newId: () => string
}): QuizImportResult<T> {
  const merged = mergeImportedQuizBank({
    mode: input.mode,
    existingPools: input.poolNames.map((name, index) => ({ name, id: input.poolIds[index] })),
    existingQuestions: input.questions,
    importedPools: input.importedPools,
    importedQuestions: input.importedQuestions,
  })
  if (merged.ok === false) return { ok: false, message: merged.message }
  return { ok: true, poolNames: merged.pools.map(pool => pool.name), poolIds: merged.pools.map(pool => pool.id || input.newId()), questions: merged.questions }
}

export interface ScheduleBudgetIssue { message: string; minAllowed: number; maxAllowed: number; reduceTo: number | null; raiseTo: number | null }

/** Dual budget: the bank must serve this month's active count and next month's scheduled count. */
export function checkScheduledBudget(input: {
  mode: 'LESSON' | 'COURSE_FINAL'; activeCount: number; scheduledCount: number | null
  poolCounts: number[]; totalQuestions: number; availableQuestions: number
}): ScheduleBudgetIssue | null {
  const { scheduledCount } = input
  if (input.mode === 'COURSE_FINAL') {
    if (scheduledCount === null) return null
    if (scheduledCount <= input.availableQuestions) return null
    return {
      message: `Lịch tháng sau đang hẹn ${scheduledCount} câu mỗi lượt nhưng ngân hàng quiz các bài học chỉ có ${input.availableQuestions} câu. Hãy bổ sung quiz bài học, hoặc giảm/hủy lịch tháng sau xuống không quá ${input.availableQuestions} câu.`,
      minAllowed: 1, maxAllowed: input.availableQuestions, reduceTo: input.availableQuestions >= 1 ? input.availableQuestions : null, raiseTo: null,
    }
  }
  const result = validateLessonBankForCounts({ questionCount: input.activeCount, scheduledQuestionCount: scheduledCount, poolCounts: input.poolCounts, totalQuestions: input.totalQuestions })
  if (result.ok !== false) return null
  const scheduledProblem = result.code === 'ScheduledQuestionCountExceedsBank' || result.code === 'ScheduledQuestionCountBelowPools' || result.code === 'ScheduledQuestionCountInvalid'
  const reduceTo = scheduledProblem && result.code === 'ScheduledQuestionCountExceedsBank' && result.maxAllowed >= Math.max(1, result.minAllowed) ? result.maxAllowed : null
  const raiseTo = scheduledProblem && result.code === 'ScheduledQuestionCountBelowPools' && result.minAllowed <= result.maxAllowed ? result.minAllowed : null
  return { message: result.message, minAllowed: result.minAllowed, maxAllowed: result.maxAllowed, reduceTo, raiseTo }
}

export interface ScheduleMeta {
  hasCurrentMonthAttempts: boolean; currentQuestionCount: number; currentDurationMinutes: number
  scheduledConfig: { questionCount: number; durationMinutes: number; effectiveAt?: string; effectiveMonthKey?: string | null } | null
}
export interface ScheduleForm { questionCount: number | null; durationMinutes: number | null }
export const EMPTY_SCHEDULE_FORM: ScheduleForm = { questionCount: null, durationMinutes: null }

export const toScheduleMeta = (value: any): ScheduleMeta | null => value && typeof value.currentQuestionCount === 'number' ? {
  hasCurrentMonthAttempts: value.hasCurrentMonthAttempts === true, currentQuestionCount: value.currentQuestionCount,
  currentDurationMinutes: value.currentDurationMinutes, scheduledConfig: value.scheduledConfig || null,
} : null

/** The schedule already stored for an assessment, from a draft assessment or an API payload. */
export function scheduleFormFrom(assessment: any, meta: ScheduleMeta | null): ScheduleForm {
  if (!meta?.hasCurrentMonthAttempts || !assessment || assessment.cancelSchedule === true) return { ...EMPTY_SCHEDULE_FORM }
  const count = assessment.scheduledQuestionCount ?? assessment.scheduledConfig?.questionCount ?? meta.scheduledConfig?.questionCount ?? null
  const duration = assessment.scheduledDurationMinutes ?? assessment.scheduledConfig?.durationMinutes ?? meta.scheduledConfig?.durationMinutes ?? null
  return { questionCount: count === meta.currentQuestionCount ? null : count, durationMinutes: duration === meta.currentDurationMinutes ? null : duration }
}

export const effectiveScheduleValues = (meta: ScheduleMeta, form: ScheduleForm) =>
  ({ questionCount: form.questionCount ?? meta.currentQuestionCount, durationMinutes: form.durationMinutes ?? meta.currentDurationMinutes })

export const hasPendingSchedule = (meta: ScheduleMeta | null, form: ScheduleForm) => {
  if (!meta?.hasCurrentMonthAttempts) return false
  const values = effectiveScheduleValues(meta, form)
  return values.questionCount !== meta.currentQuestionCount || values.durationMinutes !== meta.currentDurationMinutes
}

export interface AssessmentConfigPayload {
  questionCount: number; durationMinutes: number
  scheduledQuestionCount?: number | null; scheduledDurationMinutes?: number | null; cancelSchedule?: boolean
  scheduledEffectiveAt?: string | null; scheduledEffectiveMonthKey?: string | null
}

/** Without a locking attempt the numbers apply now; with one the active numbers stay and edits become the next-month schedule. */
export function buildConfigPayload(input: { meta: ScheduleMeta | null; form: ScheduleForm; questionCount: number; durationMinutes: number; now?: Date }): AssessmentConfigPayload {
  const { meta, form } = input
  if (!meta?.hasCurrentMonthAttempts) return { questionCount: input.questionCount, durationMinutes: input.durationMinutes, scheduledQuestionCount: null, scheduledDurationMinutes: null, cancelSchedule: false, scheduledEffectiveAt: null, scheduledEffectiveMonthKey: null }
  const active = { questionCount: meta.currentQuestionCount, durationMinutes: meta.currentDurationMinutes }
  if (!hasPendingSchedule(meta, form)) return { ...active, scheduledQuestionCount: null, scheduledDurationMinutes: null, cancelSchedule: true, scheduledEffectiveAt: null, scheduledEffectiveMonthKey: null }
  const values = effectiveScheduleValues(meta, form)
  const next = nextCompetitionMonthSchedule(input.now || new Date())
  return {
    ...active, scheduledQuestionCount: values.questionCount, scheduledDurationMinutes: values.durationMinutes, cancelSchedule: false,
    scheduledEffectiveAt: meta.scheduledConfig?.effectiveAt || next.effectiveAt.toISOString(), scheduledEffectiveMonthKey: meta.scheduledConfig?.effectiveMonthKey || next.effectiveMonthKey,
  }
}

export const formatMonthKey = (key: string | null | undefined) => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key || '')
  return match ? `${match[2]}/${match[1]}` : ''
}
export const nextMonthKey = (now = new Date()) => nextCompetitionMonthSchedule(now).effectiveMonthKey
export const effectiveDateLabel = (key: string | null | undefined, now = new Date()) => `00:00 ngày 01/${formatMonthKey(key || nextMonthKey(now))} (giờ VN)`

/** Pending next-month config of an assessment, whether it came from a draft or from an API response. */
export function pendingScheduleOf(assessment: any): { questionCount: number; durationMinutes: number; monthKey: string | null } | null {
  if (!assessment || assessment.cancelSchedule === true) return null
  const count = assessment.scheduledQuestionCount ?? assessment.scheduledConfig?.questionCount ?? null
  const duration = assessment.scheduledDurationMinutes ?? assessment.scheduledConfig?.durationMinutes ?? null
  if (count === null && duration === null) return null
  return {
    questionCount: count ?? assessment.questionCount, durationMinutes: duration ?? assessment.durationMinutes,
    monthKey: assessment.scheduledEffectiveMonthKey ?? assessment.scheduledConfig?.effectiveMonthKey ?? null,
  }
}

export interface ScheduledUpdateLike {
  type: 'LESSON' | 'COURSE_FINAL'; lessonId: string | null; currentQuestionCount: number; currentDurationMinutes: number
  questionCount: number; durationMinutes: number; effectiveMonthKey: string
}
export function describeScheduledUpdates(updates: ScheduledUpdateLike[] | null | undefined, lessonTitle: (lessonId: string) => string | null): string | null {
  if (!updates?.length) return null
  const lines = updates.map(update => {
    const name = update.type === 'COURSE_FINAL' ? 'Bài thi cuối khóa' : `Quiz "${(update.lessonId && lessonTitle(update.lessonId)) || 'bài học'}"`
    return `${name}: ${update.currentQuestionCount} câu / ${update.currentDurationMinutes} phút giữ nguyên tháng này, từ ${effectiveDateLabel(update.effectiveMonthKey)} sẽ là ${update.questionCount} câu / ${update.durationMinutes} phút`
  })
  return `Đã cập nhật khóa học. ${updates.length} quiz đã có lượt làm trong tháng nên cấu hình mới được hẹn sang tháng sau: ${lines.join('; ')}.`
}

export interface CourseSearchTarget { sessionId: string | null; lessonId: string; questionId: string | null; questionIndex: number; questionKey: string }

/** Course-wide result → the lesson to open and the question to focus (by id when persisted, else by index). */
export function courseSearchTarget(result: CourseQuestionSearchResult): CourseSearchTarget | null {
  if (!result.lessonId) return null
  return { sessionId: result.sessionId, lessonId: result.lessonId, questionId: result.questionId, questionIndex: result.questionIndex, questionKey: questionKeyOf({ id: result.questionId || undefined }, result.questionIndex) }
}

export function findLessonForTarget(sessions: any[] | null | undefined, target: CourseSearchTarget): { sessionId: string; lesson: any } | null {
  for (const session of sessions || []) {
    const lesson = (session.lessons || []).find((row: any) => (row.lessonId || row.id) === target.lessonId)
    if (lesson) return { sessionId: session.sessionId || session.id, lesson }
  }
  return null
}

/** Accepts both the editor course (draft projection) and GET /courses/{id}/questions. */
export function toSearchableSessions(sessions: any[] | null | undefined): SearchableCourseSession[] {
  return (sessions || []).map(session => ({
    id: session.sessionId || session.id, title: session.title,
    lessons: (session.lessons || []).map((lesson: any) => ({
      id: lesson.lessonId || lesson.id, title: lesson.title,
      assessment: lesson.assessment && Array.isArray(lesson.assessment.questions) ? {
        pools: (lesson.assessment.pools || []).map((pool: any) => ({ id: pool.poolId || pool.id, name: pool.name })),
        questions: lesson.assessment.questions.map((question: any) => ({
          id: question.id || question.questionId, questionText: question.questionText ?? question.question_text ?? '', explanation: question.explanation || '',
          poolId: question.poolId ?? null, poolIndex: question.poolIndex,
          options: (question.options || []).map((option: any) => ({ optionText: option.optionText ?? option.option_text ?? '' })),
        })),
      } : null,
    })),
  }))
}

export const bankLimitsText = `tối đa ${MAX_LESSON_QUIZ_QUESTIONS} câu / ${MAX_LESSON_QUIZ_POOLS} nhóm`
export const isBankFull = (questionCount: number) => questionCount >= MAX_LESSON_QUIZ_QUESTIONS
export const isPoolLimitReached = (poolCount: number) => poolCount >= MAX_LESSON_QUIZ_POOLS
