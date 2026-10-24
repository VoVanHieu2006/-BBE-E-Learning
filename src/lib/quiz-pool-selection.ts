export interface QuizQuestionPool { id: string }
export interface QuizPoolQuestion { poolId: string | null }

export type PoolSelectionResult<T> =
  | { ok: true; mode: 'LEGACY' | 'POOLED'; questions: T[]; quotas: number[]; maxAllowed?: number }
  | {
      ok: false
      code: 'QuestionPoolCountInvalid' | 'QuestionPoolQuestionUnassigned' | 'QuestionPoolIncomplete' | 'QuestionPoolQuotaExceeded'
      poolId?: string
      maxAllowed?: number
      minCount?: number
    }

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

/**
 * Draw the configured question count across every group according to Plan B:
 * - K: Number of question pools.
 * - N_i: Question count in group i.
 * - Q_max = K * min(N_1, ..., N_K).
 * - Target Q must satisfy: K <= Q <= Q_max.
 * - Base quota B = floor(Q / K), Remainder R = Q mod K.
 * - R pools are randomly selected to receive B + 1 questions; other pools receive B questions.
 * - Max difference between any two pools is at most 1.
 * - Questions within each pool are shuffled independently.
 * - The combined exam questions are shuffled across the entire attempt.
 */
export function selectQuizQuestions<T extends QuizPoolQuestion>(
  pools: readonly QuizQuestionPool[],
  questions: readonly T[],
  shuffle: <TItem>(items: readonly TItem[]) => TItem[],
  requestedCount = questions.length,
): PoolSelectionResult<T> {
  const target = Math.max(1, Math.floor(requestedCount))
  if (!pools.length) {
    if (questions.some((q) => q.poolId !== null)) return { ok: false, code: 'QuestionPoolCountInvalid' }
    const actualTarget = Math.min(target, questions.length)
    return { ok: true, mode: 'LEGACY', questions: shuffle(questions).slice(0, actualTarget), quotas: [actualTarget] }
  }
  if (pools.length > 20) return { ok: false, code: 'QuestionPoolCountInvalid' }

  // Target count must be at least K to ensure representation from every pool
  if (target < pools.length) {
    return { ok: false, code: 'QuestionPoolCountInvalid' }
  }

  const ids = new Set(pools.map((pool) => pool.id))
  if (questions.some((q) => !q.poolId || !ids.has(q.poolId))) {
    return { ok: false, code: 'QuestionPoolQuestionUnassigned' }
  }

  const grouped = pools.map((pool) => questions.filter((q) => q.poolId === pool.id))
  if (grouped.some((items) => items.length === 0)) {
    return { ok: false, code: 'QuestionPoolIncomplete' }
  }

  const minCount = Math.min(...grouped.map((items) => items.length))
  const maxAllowed = pools.length * minCount
  if (target > maxAllowed) {
    return {
      ok: false,
      code: 'QuestionPoolQuotaExceeded',
      maxAllowed,
      minCount,
    }
  }

  const base = Math.floor(target / pools.length)
  const remainder = target % pools.length
  const quotas = Array.from({ length: pools.length }, () => base)

  if (remainder > 0) {
    // Pick remainder distinct pool indices randomly without bias
    const poolIndices = Array.from({ length: pools.length }, (_, i) => i)
    const shuffledIndices = shuffle(poolIndices)
    for (let r = 0; r < remainder; r++) {
      quotas[shuffledIndices[r]]++
    }
  }

  // Draw quotas[i] questions independently from each group
  const selectedPerGroup = grouped.map((items, i) => {
    const shuffledItems = shuffle(items)
    return shuffledItems.slice(0, quotas[i])
  })

  // Final exam question shuffle
  const finalQuestions = shuffle(selectedPerGroup.flat())

  return {
    ok: true,
    mode: 'POOLED',
    questions: finalQuestions,
    quotas,
    maxAllowed,
  }
}
