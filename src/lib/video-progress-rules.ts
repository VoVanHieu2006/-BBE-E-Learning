/** Video completion is strict: unknown/invalid duration is never proof of completion. */
export function hasWatchedFullVideo(positionSeconds: number, durationSeconds: number): boolean {
  return Number.isFinite(positionSeconds)
    && Number.isFinite(durationSeconds)
    && durationSeconds > 0
    && positionSeconds >= durationSeconds
}

/**
 * Cap client-reported watch progress to the elapsed wall time at the fastest
 * supported playback rate. Keeping this pure makes the anti-seek rule testable.
 */
export function capVideoProgress(
  currentFurthestSeconds: number,
  requestedPositionSeconds: number,
  requestedFurthestSeconds: number,
  elapsedSeconds: number,
  maxPlaybackRate = 2,
): { furthestWatchedPositionSeconds: number; lastPositionSeconds: number } {
  const nonNegative = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0
  const current = nonNegative(currentFurthestSeconds)
  const position = nonNegative(requestedPositionSeconds)
  const requestedFurthest = nonNegative(requestedFurthestSeconds)
  const elapsed = nonNegative(elapsedSeconds)
  const rate = nonNegative(maxPlaybackRate)
  const maximumReachable = current + elapsed * rate
  const furthestWatchedPositionSeconds = Math.max(
    current,
    Math.min(Math.max(position, requestedFurthest), maximumReachable),
  )

  return {
    furthestWatchedPositionSeconds,
    lastPositionSeconds: Math.min(position, furthestWatchedPositionSeconds),
  }
}
