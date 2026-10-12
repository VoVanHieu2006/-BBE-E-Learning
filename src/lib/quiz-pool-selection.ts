export interface QuizQuestionPool {
  id: string
}

export interface QuizPoolQuestion {
  poolId: string | null
}

export type PoolSelectionResult<T> =
  | { ok: true; mode: 'LEGACY' | 'POOLED'; questions: T[] }
  | { ok: false; code: 'QuestionPoolCountInvalid' | 'QuestionPoolQuestionUnassigned' | 'QuestionPoolIncomplete'; poolId?: string }

export interface QuizPoolAssignment {
  questionId: string
  poolIndex: number
}

export type PoolAssignmentValidation =
  | { ok: true; poolIndexByQuestionId: Record<string, number> }
  | { ok: false; code: 'QuestionPoolCountInvalid' | 'QuestionPoolAssignmentInvalid' | 'QuestionPoolIncomplete' }

/** Validate a complete pool mapping before an admin endpoint mutates quiz data. */
export function validateQuizPoolAssignments(
  poolCount: number,
  questionIds: readonly string[],
  assignments: readonly QuizPoolAssignment[],
  questionsPerPool = 3,
): PoolAssignmentValidation {
  if (poolCount !== 5) return { ok: false, code: 'QuestionPoolCountInvalid' }

  const validQuestionIds = new Set(questionIds)
  if (
    questionIds.length === 0 ||
    validQuestionIds.size !== questionIds.length ||
    assignments.length !== questionIds.length
  ) {
    return { ok: false, code: 'QuestionPoolAssignmentInvalid' }
  }

  const poolCounts = Array.from({ length: poolCount }, () => 0)
  const poolIndexByQuestionId: Record<string, number> = {}
  for (const assignment of assignments) {
    if (
      !validQuestionIds.has(assignment.questionId) ||
      Object.prototype.hasOwnProperty.call(poolIndexByQuestionId, assignment.questionId) ||
      !Number.isInteger(assignment.poolIndex) ||
      assignment.poolIndex < 0 ||
      assignment.poolIndex >= poolCount
    ) {
      return { ok: false, code: 'QuestionPoolAssignmentInvalid' }
    }
    poolIndexByQuestionId[assignment.questionId] = assignment.poolIndex
    poolCounts[assignment.poolIndex]++
  }

  if (Object.keys(poolIndexByQuestionId).length !== validQuestionIds.size) {
    return { ok: false, code: 'QuestionPoolAssignmentInvalid' }
  }
  if (poolCounts.some((count) => count < questionsPerPool)) {
    return { ok: false, code: 'QuestionPoolIncomplete' }
  }
  return { ok: true, poolIndexByQuestionId }
}

/**
 * Select exactly three questions from each of five configured pools. Assessments
 * with no pool records and no pool assignments keep their legacy all-question behavior.
 */
export function selectQuizQuestions<T extends QuizPoolQuestion>(
  pools: readonly QuizQuestionPool[],
  questions: readonly T[],
  shuffle: <TItem>(items: readonly TItem[]) => TItem[],
  questionsPerPool = 3,
): PoolSelectionResult<T> {
  if (pools.length === 0) {
    if (questions.some((question) => question.poolId !== null)) {
      return { ok: false, code: 'QuestionPoolCountInvalid' }
    }
    return { ok: true, mode: 'LEGACY', questions: shuffle(questions) }
  }

  if (pools.length !== 5) return { ok: false, code: 'QuestionPoolCountInvalid' }

  const poolIds = new Set(pools.map((pool) => pool.id))
  if (questions.some((question) => !question.poolId || !poolIds.has(question.poolId))) {
    return { ok: false, code: 'QuestionPoolQuestionUnassigned' }
  }

  const selected: T[] = []
  for (const pool of pools) {
    const poolQuestions = questions.filter((question) => question.poolId === pool.id)
    if (poolQuestions.length < questionsPerPool) {
      return { ok: false, code: 'QuestionPoolIncomplete', poolId: pool.id }
    }
    selected.push(...shuffle(poolQuestions).slice(0, questionsPerPool))
  }

  return { ok: true, mode: 'POOLED', questions: shuffle(selected) }
}
