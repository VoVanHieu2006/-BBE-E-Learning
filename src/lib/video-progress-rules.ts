/** Supported playback rates. The server never trusts a rate above the fastest option. */
export const SUPPORTED_PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2] as const
export const MAX_VIDEO_PLAYBACK_RATE = 2

export type VideoProgressEvent = 'PLAY' | 'HEARTBEAT' | 'PAUSE' | 'ENDED'

/** Video completion is strict: unknown/invalid duration is never proof of completion. */
export function hasWatchedFullVideo(positionSeconds: number, durationSeconds: number): boolean {
  return Number.isFinite(positionSeconds)
    && Number.isFinite(durationSeconds)
    && durationSeconds > 0
    && positionSeconds >= durationSeconds
}

/** The client may report a rate, but progress is always capped at the supported maximum. */
export function normalizePlaybackRate(value: unknown): number {
  const rate = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(rate) || rate <= 0) return MAX_VIDEO_PLAYBACK_RATE
  return Math.min(MAX_VIDEO_PLAYBACK_RATE, Math.max(1, Math.round(rate * 100) / 100))
}

/**
 * A small end-of-video allowance covers the final partial heartbeat window and
 * network latency. It is never enough to complete a video without observed time.
 */
export function videoHeartbeatGraceSeconds(playbackRate: number): number {
  return Math.min(6, Math.max(2, normalizePlaybackRate(playbackRate) * 1.5))
}

/**
 * An explicit ENDED event may claim slightly more wall-clock content than the
 * previous committed heartbeat, because queueing/lock contention shaves the
 * measured gap and the final seconds never trigger a scheduled heartbeat.
 * Bounded addition only: normal heartbeats never receive it.
 */
export function endedReachAllowanceSeconds(playbackRate: number): number {
  return Math.min(6, videoHeartbeatGraceSeconds(playbackRate) + 2)
}

/**
 * Completion tolerance for an explicit ENDED event. The backend stores the
 * duration as an integer written by an administrator, while the player reports
 * fractional seconds — a strict equality would strand honest viewers at 99.x%.
 * Never exceeds 10% of the duration so short videos stay proportionally strict.
 */
export function endedCompletionToleranceSeconds(durationSeconds: number): number {
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0
  if (duration <= 0) return 0
  return Math.min(1.5, duration * 0.1, duration / 3, Math.max(0.6, duration * 0.005))
}

/**
 * Completeness check that only relaxes the threshold for a backend-accepted
 * ENDED event. Every other event keeps the strict rule, so a seek to the very
 * end can never mark a video complete without real observed playback.
 */
export function hasCompletedVideoAtEnd(
  furthestWatchedPositionSeconds: number,
  durationSeconds: number,
  event: VideoProgressEvent,
): boolean {
  if (event !== 'ENDED') return hasWatchedFullVideo(furthestWatchedPositionSeconds, durationSeconds)
  const tolerance = endedCompletionToleranceSeconds(durationSeconds)
  return tolerance > 0
    && Number.isFinite(furthestWatchedPositionSeconds)
    && durationSeconds > 0
    && furthestWatchedPositionSeconds >= durationSeconds - tolerance
    && furthestWatchedPositionSeconds <= durationSeconds + endedReachAllowanceSeconds(MAX_VIDEO_PLAYBACK_RATE)
}

/**
 * Cap client-reported watch progress to the elapsed wall time at the fastest
 * supported playback rate. Keeping this pure makes the anti-seek rule testable.
 *
 * - `currentFurthestSeconds` is the server's accepted content position.
 * - `elapsedSeconds` is the verified server-side gap between heartbeats.
 * - `graceSeconds` is only supplied for an explicit ENDED event.
 */
export function capVideoProgress(
  currentFurthestSeconds: number,
  requestedPositionSeconds: number,
  requestedFurthestSeconds: number,
  elapsedSeconds: number,
  maxPlaybackRate = MAX_VIDEO_PLAYBACK_RATE,
  graceSeconds = 0,
): { furthestWatchedPositionSeconds: number; lastPositionSeconds: number } {
  const nonNegative = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0
  const current = nonNegative(currentFurthestSeconds)
  const position = nonNegative(requestedPositionSeconds)
  const requestedFurthest = nonNegative(requestedFurthestSeconds)
  const elapsed = nonNegative(elapsedSeconds)
  const rate = Math.min(MAX_VIDEO_PLAYBACK_RATE, nonNegative(maxPlaybackRate))
  const grace = Math.min(10, nonNegative(graceSeconds))
  const maximumReachable = current + elapsed * rate + grace
  const furthestWatchedPositionSeconds = Math.max(
    current,
    Math.min(Math.max(position, requestedFurthest), maximumReachable),
  )

  return {
    furthestWatchedPositionSeconds,
    lastPositionSeconds: Math.min(position, furthestWatchedPositionSeconds),
  }
}
