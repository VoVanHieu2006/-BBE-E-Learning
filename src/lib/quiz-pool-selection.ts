export interface QuizQuestionPool { id: string }
export interface QuizPoolQuestion { poolId: string | null }

export type PoolSelectionResult<T> =
  | { ok: true; mode: 'LEGACY' | 'POOLED'; questions: T[]; quotas: number[] }
  | { ok: false; code: 'QuestionPoolCountInvalid' | 'QuestionPoolQuestionUnassigned' | 'QuestionPoolIncomplete'; poolId?: string }

export interface QuizPoolAssignment { questionId: string; poolIndex: number }
export type PoolAssignmentValidation =
  | { ok: true; poolIndexByQuestionId: Record<string, number> }
  | { ok: false; code: 'QuestionPoolCountInvalid' | 'QuestionPoolAssignmentInvalid' | 'QuestionPoolIncomplete' }

export function validateQuizPoolAssignments(
  poolCount: number,
  questionIds: readonly string[],
  assignments: readonly QuizPoolAssignment[],
  minimumQuestionsPerPool = 1,
): PoolAssignmentValidation {
  if (!Number.isInteger(poolCount) || poolCount < 1 || poolCount > 20) return { ok: false, code: 'QuestionPoolCountInvalid' }
  const validIds = new Set(questionIds)
  if (!questionIds.length || validIds.size !== questionIds.length || assignments.length !== questionIds.length) return { ok: false, code: 'QuestionPoolAssignmentInvalid' }
  const counts = Array.from({ length: poolCount }, () => 0)
  const mapped: Record<string, number> = {}
  for (const item of assignments) {
    if (!validIds.has(item.questionId) || item.questionId in mapped || !Number.isInteger(item.poolIndex) || item.poolIndex < 0 || item.poolIndex >= poolCount) return { ok: false, code: 'QuestionPoolAssignmentInvalid' }
    mapped[item.questionId] = item.poolIndex
    counts[item.poolIndex]++
  }
  if (counts.some((count) => count < minimumQuestionsPerPool)) return { ok: false, code: 'QuestionPoolIncomplete' }
  return { ok: true, poolIndexByQuestionId: mapped }
}

/** Draw the configured question count as evenly as possible across every group. */
export function selectQuizQuestions<T extends QuizPoolQuestion>(
  pools: readonly QuizQuestionPool[],
  questions: readonly T[],
  shuffle: <TItem>(items: readonly TItem[]) => TItem[],
  requestedCount = questions.length,
): PoolSelectionResult<T> {
  const target = Math.max(1, Math.min(Math.floor(requestedCount), questions.length))
  if (!pools.length) {
    if (questions.some((q) => q.poolId !== null)) return { ok: false, code: 'QuestionPoolCountInvalid' }
    return { ok: true, mode: 'LEGACY', questions: shuffle(questions).slice(0, target), quotas: [target] }
  }
  if (pools.length > 20) return { ok: false, code: 'QuestionPoolCountInvalid' }
  const ids = new Set(pools.map((pool) => pool.id))
  if (questions.some((q) => !q.poolId || !ids.has(q.poolId))) return { ok: false, code: 'QuestionPoolQuestionUnassigned' }
  const grouped = pools.map((pool) => shuffle(questions.filter((q) => q.poolId === pool.id)))
  if (grouped.some((items) => items.length === 0)) return { ok: false, code: 'QuestionPoolIncomplete' }
  const quotas = grouped.map(() => Math.floor(target / pools.length))
  for (let i = 0; i < target % pools.length; i++) quotas[i]++
  let deficit = 0
  quotas.forEach((quota, i) => {
    if (quota > grouped[i].length) { deficit += quota - grouped[i].length; quotas[i] = grouped[i].length }
  })
  while (deficit > 0) {
    const index = quotas.findIndex((quota, i) => quota < grouped[i].length)
    if (index < 0) return { ok: false, code: 'QuestionPoolIncomplete' }
    quotas[index]++
    deficit--
  }
  return { ok: true, mode: 'POOLED', questions: shuffle(grouped.flatMap((items, i) => items.slice(0, quotas[i]))), quotas }
}
