/** Supported playback rates. The server never trusts a rate above the fastest option. */
export const SUPPORTED_PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2] as const
export const MAX_VIDEO_PLAYBACK_RATE = 2

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
