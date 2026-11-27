import { competitionMonthBounds } from './learning-cycle-rules'

export const MAX_LESSON_QUIZ_QUESTIONS = 200
export const MAX_LESSON_QUIZ_POOLS = 20
export const LOCKING_ATTEMPT_STATUSES = ['IN_PROGRESS', 'SUBMITTED', 'AUTO_SUBMITTED'] as const
export const DEFAULT_QUIZ_POOL_NAME = 'Nhóm 1'

export interface AssessmentConfig { questionCount: number; durationMinutes: number }
export interface AssessmentSchedule extends AssessmentConfig { effectiveAt: Date; effectiveMonthKey: string }

export function nextCompetitionMonthSchedule(now: Date): { effectiveAt: Date; effectiveMonthKey: string } {
  const effectiveAt = competitionMonthBounds(now).endsAt
  return { effectiveAt, effectiveMonthKey: competitionMonthBounds(effectiveAt).key }
}

export type LessonBankIssueCode =
  | 'QuestionBankSizeInvalid' | 'QuestionPoolCountInvalid' | 'QuestionPoolIncomplete'
  | 'QuestionCountInvalid' | 'QuestionCountBelowPools' | 'QuestionPoolQuotaExceeded'
  | 'ScheduledQuestionCountInvalid' | 'ScheduledQuestionCountExceedsBank' | 'ScheduledQuestionCountBelowPools'
export type LessonBankValidation =
  | { ok: true; minAllowed: number; maxAllowed: number }
  | { ok: false; code: LessonBankIssueCode; message: string; minAllowed: number; maxAllowed: number; requestedScheduledCount?: number }

export function validateLessonBankForCounts(input: {
  questionCount: number; scheduledQuestionCount?: number | null; poolCounts: number[]; totalQuestions: number
}): LessonBankValidation {
  const { questionCount, scheduledQuestionCount, poolCounts, totalQuestions } = input
  const pools = poolCounts.length
  const minAllowed = Math.max(1, pools)
  const maxAllowed = pools ? Math.min(totalQuestions, pools * Math.min(...poolCounts)) : totalQuestions
  const fail = (code: LessonBankIssueCode, message: string, requestedScheduledCount?: number): LessonBankValidation =>
    ({ ok: false, code, message, minAllowed, maxAllowed, ...(requestedScheduledCount === undefined ? {} : { requestedScheduledCount }) })

  if (!Number.isInteger(totalQuestions) || totalQuestions < 1 || totalQuestions > MAX_LESSON_QUIZ_QUESTIONS) return fail('QuestionBankSizeInvalid', `Ngân hàng câu hỏi phải có từ 1 đến ${MAX_LESSON_QUIZ_QUESTIONS} câu.`)
  if (pools > MAX_LESSON_QUIZ_POOLS) return fail('QuestionPoolCountInvalid', `Quiz chỉ được tối đa ${MAX_LESSON_QUIZ_POOLS} nhóm câu hỏi.`)
  if (poolCounts.some(count => !Number.isInteger(count) || count < 1)) return fail('QuestionPoolIncomplete', 'Mỗi nhóm câu hỏi phải có ít nhất 1 câu.')
  if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > totalQuestions) return fail('QuestionCountInvalid', `Số câu mỗi lượt phải là số nguyên từ 1 đến ${totalQuestions} (tổng số câu trong ngân hàng).`)
  if (questionCount < minAllowed) return fail('QuestionCountBelowPools', `Số câu mỗi lượt (${questionCount}) không thể ít hơn số nhóm câu hỏi (${pools}).`)
  if (questionCount > maxAllowed) return fail('QuestionPoolQuotaExceeded', `Với ${pools} nhóm và nhóm ít câu nhất có ${Math.min(...poolCounts)} câu, mỗi lượt chỉ được chọn tối đa ${maxAllowed} câu để bảo đảm phân phối cân bằng.`)
  if (scheduledQuestionCount === null || scheduledQuestionCount === undefined) return { ok: true, minAllowed, maxAllowed }
  if (!Number.isInteger(scheduledQuestionCount) || scheduledQuestionCount < 1) return fail('ScheduledQuestionCountInvalid', 'Số câu hẹn cho tháng sau phải là số nguyên từ 1 trở lên.', scheduledQuestionCount)
  if (scheduledQuestionCount > maxAllowed) return fail('ScheduledQuestionCountExceedsBank', `Lịch tháng sau đang hẹn ${scheduledQuestionCount} câu mỗi lượt nhưng ngân hàng hiện chỉ đáp ứng tối đa ${maxAllowed} câu. Hãy thêm hoặc cân bằng câu hỏi giữa các nhóm trong ngân hàng, hoặc giảm/hủy số câu hẹn tháng sau xuống không quá ${maxAllowed} câu.`, scheduledQuestionCount)
  if (scheduledQuestionCount < minAllowed) return fail('ScheduledQuestionCountBelowPools', `Lịch tháng sau đang hẹn ${scheduledQuestionCount} câu mỗi lượt, ít hơn số nhóm câu hỏi (${pools}). Hãy bớt nhóm câu hỏi, hoặc tăng số câu hẹn tháng sau lên ít nhất ${pools} câu (hoặc hủy lịch tháng sau).`, scheduledQuestionCount)
  return { ok: true, minAllowed, maxAllowed }
}

export interface AssessmentConfigUpdateInput {
  current: AssessmentConfig
  existingSchedule: AssessmentSchedule | null
  requested: AssessmentConfig & { scheduledQuestionCount?: number | null; scheduledDurationMinutes?: number | null; cancelSchedule?: boolean }
  hasCurrentMonthLockingAttempts: boolean
  now: Date
}
export interface AssessmentConfigUpdate extends AssessmentConfig {
  scheduleAction: 'CLEAR' | 'KEEP' | 'UPSERT'
  schedule: AssessmentSchedule | null
  wasScheduled: boolean
}

export function resolveAssessmentConfigUpdate(input: AssessmentConfigUpdateInput): AssessmentConfigUpdate {
  const { current, existingSchedule, requested, now } = input
  if (!input.hasCurrentMonthLockingAttempts) return { questionCount: requested.questionCount, durationMinutes: requested.durationMinutes, scheduleAction: 'CLEAR', schedule: null, wasScheduled: false }
  const active = { questionCount: current.questionCount, durationMinutes: current.durationMinutes }
  if (requested.cancelSchedule === true) return { ...active, scheduleAction: 'CLEAR', schedule: null, wasScheduled: false }
  const explicitCount = requested.scheduledQuestionCount ?? null
  const explicitDuration = requested.scheduledDurationMinutes ?? null
  const countChanged = requested.questionCount !== current.questionCount
  const durationChanged = requested.durationMinutes !== current.durationMinutes
  if (explicitCount === null && explicitDuration === null && !countChanged && !durationChanged) return { ...active, scheduleAction: 'KEEP', schedule: existingSchedule, wasScheduled: false }
  const questionCount = explicitCount ?? (countChanged ? requested.questionCount : existingSchedule?.questionCount ?? current.questionCount)
  const durationMinutes = explicitDuration ?? (durationChanged ? requested.durationMinutes : existingSchedule?.durationMinutes ?? current.durationMinutes)
  if (questionCount === current.questionCount && durationMinutes === current.durationMinutes) return { ...active, scheduleAction: 'CLEAR', schedule: null, wasScheduled: false }
  return { ...active, scheduleAction: 'UPSERT', schedule: { questionCount, durationMinutes, ...nextCompetitionMonthSchedule(now) }, wasScheduled: true }
}

export interface QuizBankPool { id?: string; name: string }
export type QuizBankMerge<T> =
  | { ok: true; pools: QuizBankPool[]; questions: T[] }
  | { ok: false; code: 'QuestionBankLimitExceeded' | 'QuestionPoolLimitExceeded'; message: string }

const poolKey = (name: string) => name.trim().toLowerCase()

export function mergeImportedQuizBank<T extends { poolIndex?: number }>(input: {
  mode: 'append' | 'replace'; existingPools: QuizBankPool[]; existingQuestions: T[]; importedPools: string[]; importedQuestions: T[]
}): QuizBankMerge<T> {
  const append = input.mode === 'append'
  const kept = append ? input.existingQuestions : []
  const pools: QuizBankPool[] = !append ? [] : input.existingPools.length || !kept.length ? [...input.existingPools] : [{ name: DEFAULT_QUIZ_POOL_NAME }]
  const indexByKey = new Map<string, number>()
  pools.forEach((pool, index) => { if (!indexByKey.has(poolKey(pool.name))) indexByKey.set(poolKey(pool.name), index) })
  const importedNames = input.importedPools.length ? input.importedPools : input.importedQuestions.length || !append ? [DEFAULT_QUIZ_POOL_NAME] : []
  const remap = importedNames.map(name => {
    const key = poolKey(name)
    const merged = append ? indexByKey.get(key) : undefined
    if (merged !== undefined) return merged
    indexByKey.set(key, pools.length)
    return pools.push({ name: name.trim() }) - 1
  })
  const imported = input.importedQuestions.map((question, index) => {
    const given = question.poolIndex
    const importedIndex = given !== undefined && Number.isInteger(given) && given >= 0 && given < remap.length ? given : index % remap.length
    return { ...question, poolIndex: remap[importedIndex] }
  })
  const total = kept.length + imported.length
  if (pools.length > MAX_LESSON_QUIZ_POOLS) return {
    ok: false, code: 'QuestionPoolLimitExceeded',
    message: append
      ? `Ngân hàng chỉ được tối đa ${MAX_LESSON_QUIZ_POOLS} nhóm câu hỏi, nhưng sau khi nhập sẽ có ${pools.length} nhóm. Hãy gộp bớt tab trong file nhập hoặc xóa bớt nhóm hiện có.`
      : `File nhập có ${pools.length} nhóm, vượt giới hạn ${MAX_LESSON_QUIZ_POOLS} nhóm câu hỏi của ngân hàng. Hãy gộp bớt tab trong file nhập.`,
  }
  if (total > MAX_LESSON_QUIZ_QUESTIONS) return {
    ok: false, code: 'QuestionBankLimitExceeded',
    message: append
      ? `Ngân hàng chỉ được tối đa ${MAX_LESSON_QUIZ_QUESTIONS} câu hỏi: đang có ${kept.length} câu, nhập thêm ${imported.length} câu sẽ thành ${total} câu. Hãy bớt câu trong file nhập hoặc xóa bớt câu hiện có.`
      : `File nhập có ${imported.length} câu, vượt giới hạn ${MAX_LESSON_QUIZ_QUESTIONS} câu của ngân hàng. Hãy bớt câu trong file nhập.`,
  }
  return { ok: true, pools, questions: [...kept, ...imported] }
}
