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

/** Student-facing percent: 100 is reserved for a server-confirmed completion. */
export function displayVideoProgressPercent(
  furthestWatchedPositionSeconds: number,
  durationSeconds: number,
  videoCompleted: boolean,
): number {
  if (!(Number.isFinite(durationSeconds) && durationSeconds > 0)) return 0
  if (videoCompleted) return 100
  const furthest = Number.isFinite(furthestWatchedPositionSeconds)
    ? Math.max(0, furthestWatchedPositionSeconds)
    : 0
  return Math.min(99, Math.max(0, Math.floor((furthest / durationSeconds) * 100)))
}

/** Completion must come from an explicit server flag, never a rounded percent. */
export function isServerVideoCompleted(
  response: { videoCompleted?: unknown; completed?: unknown } | null | undefined,
): boolean {
  return response?.videoCompleted === true || response?.completed === true
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
 * Completion tolerance for end-of-video progress. It is used by both the
 * ENDED write path and the read-path completion gates (canAssess, attempts,
 * unlocks), so a player that stops just short of the final second is not
 * stranded while the UI rounds the same progress up to 100%.
 *
 * Short videos keep the conservative 2% / 3s rule. Videos longer than
 * 10 minutes follow the 99% viewing rule (1% of duration), which removes the
 * dead band between the 0.5% display-rounding boundary and the 3s cap.
 */
export function endedCompletionToleranceSeconds(durationSeconds: number): number {
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0
  if (duration <= 0) return 0
  const longVideo = duration > 600
  const ratio = longVideo ? 0.01 : 0.02
  const cap = longVideo ? duration * 0.01 : 3
  return Math.min(cap, duration * 0.1, duration / 3, Math.max(0.6, Math.round(duration * ratio * 100) / 100))
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
 * Cap client-reported watch progress by verifying continuous playback from the
 * server-confirmed furthest point.
 *
 * Requirements:
 * 1. Legitimate continuous forward playback:
 *    - Starts within or near already authorized territory (position <= current + jitter).
 *    - Advances by at most the verified wall-clock elapsed time at the supported playback rate.
 * 2. Unauthorized forward jump / seek (e.g. from 60s to 540s):
 *    - If position exceeds what could physically be watched continuously (position > continuousCeiling),
 *      the learner is playing in unverified/skipped territory.
 *    - This remote watch time must NEVER be credited as progress from currentFurthest.
 *    - Furthest remains strictly at currentFurthest.
 * 3. Rewind or replaying inside already verified territory (position <= current):
 *    - Furthest remains at currentFurthest (monotonic).
 *    - lastPosition updates to reflect the current rewound position.
 * 4. Client-reported furthest (requestedFurthestSeconds) is never trusted independently.
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
  const elapsed = nonNegative(elapsedSeconds)
  const rate = Math.min(MAX_VIDEO_PLAYBACK_RATE, nonNegative(maxPlaybackRate))
  const grace = Math.min(10, nonNegative(graceSeconds))

  // Allow a jitter buffer (4.0s - 6.0s) for audio clock drift, mobile timer throttling and network latency
  const jitterTolerance = Math.max(4.0, rate * 2.0)
  const maxAdvance = elapsed * rate + grace + jitterTolerance
  const continuousCeiling = current + maxAdvance

  if (position <= current) {
    // Rewind or replaying inside already verified territory
    return {
      furthestWatchedPositionSeconds: current,
      lastPositionSeconds: position,
    }
  }

  if (position <= continuousCeiling) {
    // Continuous legitimate forward playback starting from or near current furthest
    return {
      furthestWatchedPositionSeconds: Math.max(current, position),
      lastPositionSeconds: position,
    }
  }

  // Handle minor network/queue jitter (within 10.0s beyond continuousCeiling) by crediting
  // the continuous forward progress up to continuousCeiling instead of dropping to zero.
  // This prevents cascading lockout where one delayed heartbeat permanently freezes progress.
  const remoteJumpThreshold = 10.0
  if (position <= continuousCeiling + remoteJumpThreshold) {
    return {
      furthestWatchedPositionSeconds: Math.min(position, continuousCeiling),
      lastPositionSeconds: position,
    }
  }

  // Unauthorized forward jump / seek into unverified territory!
  // The player is at a remote position (position > continuousCeiling).
  // This cannot be accepted as proof of continuous watch time from current.
  return {
    furthestWatchedPositionSeconds: current,
    lastPositionSeconds: current,
  }
}

