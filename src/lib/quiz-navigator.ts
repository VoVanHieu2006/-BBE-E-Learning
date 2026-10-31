/** Pure helpers for the quiz countdown and the question navigator panel. */

export type QuestionNavState = 'unanswered' | 'answered' | 'flagged'

/** Whole seconds left until the server deadline; never negative. */
export function secondsUntil(deadlineMs: number, nowMs: number): number {
  if (!Number.isFinite(deadlineMs)) return 0
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000))
}

/** Countdown deadline: the server's expiresAt wins over the configured duration. */
export function quizDeadlineMs(expiresAt: unknown, durationMinutes: unknown, nowMs: number): number | null {
  const fromServer = typeof expiresAt === 'string' || expiresAt instanceof Date ? new Date(expiresAt).getTime() : Number.NaN
  if (Number.isFinite(fromServer)) return fromServer
  const minutes = Number(durationMinutes || 0)
  return minutes > 0 ? nowMs + minutes * 60_000 : null
}

export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safe / 3600)
  const mins = Math.floor((safe % 3600) / 60)
  const secs = safe % 60
  const mmss = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  return hours > 0 ? `${hours}:${mmss}` : mmss
}

/** A flag wins over the answered state so marked questions stand out. */
export function questionNavState(questionId: string, answers: Record<string, string>, flagged: ReadonlySet<string>): QuestionNavState {
  if (flagged.has(questionId)) return 'flagged'
  return answers[questionId] ? 'answered' : 'unanswered'
}

export function toggleFlag(flagged: ReadonlySet<string>, questionId: string): Set<string> {
  const next = new Set(flagged)
  if (next.has(questionId)) next.delete(questionId)
  else next.add(questionId)
  return next
}

export function countAnswered(questionIds: string[], answers: Record<string, string>): number {
  return questionIds.filter((id) => Boolean(answers[id])).length
}
