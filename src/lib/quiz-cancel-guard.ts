/** A submit may have committed before React renders its result. Use synchronous state. */
export function shouldSendCancelBeacon({ attemptId, hasResult, isSubmitting, isCancelled, deadlineMs, nowMs }: {
  attemptId?: string | null
  hasResult: boolean
  isSubmitting: boolean
  isCancelled: boolean
  deadlineMs?: number | null
  nowMs: number
}): boolean {
  return Boolean(attemptId) && !hasResult && !isSubmitting && !isCancelled
    && (deadlineMs == null || nowMs < deadlineMs)
}
