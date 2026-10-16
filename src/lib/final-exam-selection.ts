export function selectBalancedFinalExamQuestions<T extends { assessment_id: string; source_assessment_id: string | null }>(
  questions: readonly T[],
  requestedCount: number,
  shuffle: <Item>(items: readonly Item[]) => Item[],
): T[] | null {
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || questions.length < requestedCount) return null
  const groups = new Map<string, T[]>()
  for (const question of questions) {
    const sourceId = question.source_assessment_id || question.assessment_id
    groups.set(sourceId, [...(groups.get(sourceId) || []), question])
  }
  const queues = shuffle(Array.from(groups.values())).map((group) => shuffle(group))
  const selected: T[] = []
  while (selected.length < requestedCount && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const question = queue.shift()
      if (question) selected.push(question)
      if (selected.length >= requestedCount) break
    }
  }
  return selected.length === requestedCount ? selected : null
}
