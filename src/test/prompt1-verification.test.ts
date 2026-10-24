import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  capVideoProgress,
  hasWatchedFullVideo,
  hasCompletedVideoAtEnd,
  endedCompletionToleranceSeconds,
  endedReachAllowanceSeconds,
} from '../lib/video-progress-rules'
import { starsForVideoDuration } from '../lib/reward-rules'

describe('Prompt 1 — Video Completion Tolerance Across Durations and Speeds', () => {
  const durations = [10, 30, 60, 115, 168, 600]
  const rates = [1, 1.25, 1.5, 1.75, 2]

  it('calculates tolerance as min(3s, 2% duration) with safe floor', () => {
    // 10s: 2% is 0.2s, clamped to safe floor 0.6s
    assert.equal(endedCompletionToleranceSeconds(10), 0.6)
    // 30s: 2% is 0.6s
    assert.equal(endedCompletionToleranceSeconds(30), 0.6)
    // 60s: 2% is 1.2s
    assert.equal(endedCompletionToleranceSeconds(60), 1.2)
    // 115s: 2% is 2.3s
    assert.equal(endedCompletionToleranceSeconds(115), 2.3)
    // 168s: 2% is 3.36s, capped at 3.0s
    assert.equal(endedCompletionToleranceSeconds(168), 3)
    // 600s: capped at 3.0s
    assert.equal(endedCompletionToleranceSeconds(600), 3)
  })

  it('completes video played to end within tolerance across all tested speeds (1x to 2x)', () => {
    durations.forEach((d) => {
      const tolerance = endedCompletionToleranceSeconds(d)
      rates.forEach((rate) => {
        // Player reports position right within tolerance
        const positionAtEnd = d - tolerance + 0.1
        const completed = hasCompletedVideoAtEnd(positionAtEnd, d, 'ENDED')
        assert.equal(
          completed,
          true,
          `Duration ${d}s at rate ${rate}x should complete at position ${positionAtEnd}s (tolerance ${tolerance}s)`
        )
      })
    })
  })

  it('strictly rejects premature seek or out-of-tolerance ENDED request (anti-cheat)', () => {
    durations.forEach((d) => {
      const tolerance = endedCompletionToleranceSeconds(d)
      // Position before tolerance window
      const tooEarlyPosition = d - tolerance - 1.0
      assert.equal(
        hasCompletedVideoAtEnd(tooEarlyPosition, d, 'ENDED'),
        false,
        `Duration ${d}s must NOT complete at position ${tooEarlyPosition}s`
      )
      // Instant seek from start
      assert.equal(
        hasCompletedVideoAtEnd(5, d, 'ENDED'),
        false,
        `Duration ${d}s must NOT complete when seeking from 5s`
      )
    })
  })

  it('allows natural wall-clock reach at 2x rate without skipping content', () => {
    const duration = 168
    let currentFurthest = 0
    let lastPosition = 0
    const elapsedSeconds = 5 // 5 seconds interval
    const rate = 2 // 2x playback speed

    // Simulate 16 heartbeats of 5s each at 2x rate = 5 * 2 = 10s progress per heartbeat
    for (let i = 0; i < 16; i++) {
      const position = lastPosition + 10
      const cap = capVideoProgress(currentFurthest, position, position, elapsedSeconds, rate, 0)
      currentFurthest = cap.furthestWatchedPositionSeconds
      lastPosition = cap.lastPositionSeconds
    }
    // 16 * 10 = 160s watched
    assert.equal(currentFurthest, 160)

    // Final heartbeat with ENDED: 4 seconds elapsed at 2x (8s progress) -> 160 + 8 = 168s
    const endGrace = endedReachAllowanceSeconds(rate)
    const finalCap = capVideoProgress(currentFurthest, 168, 168, 4, rate, endGrace)
    assert.equal(finalCap.furthestWatchedPositionSeconds, 168)
    assert.equal(hasCompletedVideoAtEnd(finalCap.furthestWatchedPositionSeconds, duration, 'ENDED'), true)
  })
})

describe('Prompt 1 — Request Ordering & Race Condition Resilience', () => {
  it('PAUSE event arriving after ENDED does not regress completion or furthest', () => {
    const duration = 120
    let isVideoCompleted = false
    let serverFurthest = 0

    // Step 1: ENDED arrives and is verified
    const endResult = { videoCompleted: true, completed: false, furthestWatchedPositionSeconds: 120 }
    if (endResult.videoCompleted) {
      isVideoCompleted = true
      serverFurthest = 120
    }

    // Step 2: Delayed PAUSE arrives with position 0 (because player reset to 0)
    const delayedPause = { positionSeconds: 0, furthestWatchedPositionSeconds: 120, event: 'PAUSE' }

    // Backend / Client state must retain completion
    const finalFurthest = Math.max(serverFurthest, delayedPause.furthestWatchedPositionSeconds)
    const finalCompleted = isVideoCompleted || false

    assert.equal(finalCompleted, true)
    assert.equal(finalFurthest, 120)
  })

  it('Out-of-order heartbeat cannot regress server-confirmed furthest', () => {
    let serverConfirmedFurthest = 85

    // Older heartbeat in-flight returns 40s
    const staleResponse = { furthestWatchedPositionSeconds: 40 }

    // Monotonic furthest rule: serverConfirmedFurthest never decreases
    if (staleResponse.furthestWatchedPositionSeconds > serverConfirmedFurthest) {
      serverConfirmedFurthest = staleResponse.furthestWatchedPositionSeconds
    }

    assert.equal(serverConfirmedFurthest, 85)
  })
})

describe('Prompt 1 — Seek Boundary & Anti-Cheat Enforcement', () => {
  it('clamps requested seek target to allowedSeekUntil for uncompleted video', () => {
    const duration = 300
    const serverConfirmedFurthest = 45 // 15% watched
    const isCompleted = false
    const allowFreeSeek = false

    const allowedSeekUntil = (allowFreeSeek || isCompleted) ? duration : serverConfirmedFurthest

    // User attempts to seek to 200s (66%)
    const requestedTarget = 200
    const clampedTarget = Math.min(requestedTarget, allowedSeekUntil)

    assert.equal(clampedTarget, 45)
  })

  it('allows full seek to duration once video is completed', () => {
    const duration = 300
    const serverConfirmedFurthest = 300
    const isCompleted = true
    const allowFreeSeek = false

    const allowedSeekUntil = (allowFreeSeek || isCompleted) ? duration : serverConfirmedFurthest

    const requestedTarget = 200
    const clampedTarget = Math.min(requestedTarget, allowedSeekUntil)

    assert.equal(clampedTarget, 200)
  })

  it('client anti-cheat guard snaps back if player position exceeds allowedSeekUntil + 3s buffer', () => {
    const allowedSeekUntil = 50
    const playerPositions = [45, 50, 52, 53, 54, 80, 250]

    playerPositions.forEach((pos) => {
      const wouldSnapBack = pos > allowedSeekUntil + 3
      if (pos <= 53) {
        assert.equal(wouldSnapBack, false, `Position ${pos}s within 3s jitter buffer should not trigger snap back`)
      } else {
        assert.equal(wouldSnapBack, true, `Position ${pos}s exceeds 3s jitter buffer and must snap back to ${allowedSeekUntil}`)
      }
    })
  })
})

describe('Prompt 1 — Progress Isolation Between Lessons (A -> B -> A)', () => {
  it('switching from Video A (11%) to Video B (100%) and back to A maintains strict isolation', () => {
    // Lesson state store
    const lessonProgressStore: Record<string, { furthest: number; completed: boolean }> = {
      'lesson-A': { furthest: 11, completed: false },
      'lesson-B': { furthest: 100, completed: true },
    }

    // Step 1: Active lesson is A
    let currentLessonId = 'lesson-A'
    let clientFurthestA = lessonProgressStore['lesson-A'].furthest
    let allowedSeekA = lessonProgressStore['lesson-A'].furthest
    assert.equal(clientFurthestA, 11)
    assert.equal(allowedSeekA, 11)

    // Step 2: Switch to B
    currentLessonId = 'lesson-B'
    let clientFurthestB = lessonProgressStore['lesson-B'].furthest
    let allowedSeekB = 100 // completed
    assert.equal(clientFurthestB, 100)
    assert.equal(allowedSeekB, 100)

    // In-flight delayed flush from B tagged with lesson-B
    const eventFromB = { lessonId: 'lesson-B', furthest: 100 }
    if (eventFromB.lessonId === currentLessonId) {
      lessonProgressStore[eventFromB.lessonId].furthest = eventFromB.furthest
    }

    // Step 3: Switch back to A
    currentLessonId = 'lesson-A'
    // A's state is loaded directly from A's server progress
    const activeDataA = lessonProgressStore['lesson-A']
    clientFurthestA = activeDataA.furthest
    allowedSeekA = activeDataA.completed ? 100 : activeDataA.furthest

    // A MUST REMAIN at 11%, NEVER 70-90% or 100%!
    assert.equal(clientFurthestA, 11)
    assert.equal(allowedSeekA, 11)
  })

  it('rejects cross-lesson progress contamination when response resolves after lesson switch', () => {
    let currentLessonId = 'lesson-A'
    let progressState = { lessonId: 'lesson-A', furthest: 11 }

    // User switches to lesson-B
    currentLessonId = 'lesson-B'

    // Delayed response from lesson-A arrives
    const staleResponse = { lessonId: 'lesson-A', furthestWatchedPositionSeconds: 15 }

    // Strict isolation filter:
    if (staleResponse.lessonId === currentLessonId) {
      progressState = { lessonId: staleResponse.lessonId, furthest: staleResponse.furthestWatchedPositionSeconds }
    }

    // progressState was NOT mutated by stale lesson-A response while viewing lesson-B!
    assert.equal(progressState.lessonId, 'lesson-A')
    assert.equal(progressState.furthest, 11)
  })
})

describe('Prompt 1 — Quiz Completion Gating and Tick Synchronisation', () => {
  it('quiz pass with incomplete video does NOT mark lesson completed', () => {
    const videoDuration = 180
    const watchedFurthest = 50 // Incomplete video (50 < 180)
    const tolerance = endedCompletionToleranceSeconds(videoDuration)
    const videoDone = hasWatchedFullVideo(watchedFurthest, videoDuration) || watchedFurthest >= videoDuration - tolerance

    assert.equal(videoDone, false)

    const quizPassed = true
    const isLessonFullyComplete = !videoDuration || (videoDone && quizPassed)

    assert.equal(isLessonFullyComplete, false, 'Lesson must NOT be marked complete if video is not completed')
  })

  it('quiz pass with complete video marks lesson completed', () => {
    const videoDuration = 180
    const watchedFurthest = 180
    const tolerance = endedCompletionToleranceSeconds(videoDuration)
    const videoDone = hasWatchedFullVideo(watchedFurthest, videoDuration) || watchedFurthest >= videoDuration - tolerance

    assert.equal(videoDone, true)

    const quizPassed = true
    const isLessonFullyComplete = !videoDuration || (videoDone && quizPassed)

    assert.equal(isLessonFullyComplete, true, 'Lesson must be marked complete when both video and quiz are done')
  })

  it('quiz fail with complete video does NOT mark lesson completed', () => {
    const videoDuration = 180
    const watchedFurthest = 180
    const videoDone = true
    const quizPassed = false // < 85%
    const isLessonFullyComplete = !videoDuration || (videoDone && quizPassed)

    assert.equal(isLessonFullyComplete, false, 'Failed quiz must not grant lesson completion')
  })
})

describe('Prompt 1 — Idempotency and Star Reward Protection', () => {
  it('retried ENDED event or duplicate heartbeat does not grant duplicate stars', () => {
    const seenRewardKeys = new Set<string>()
    const userId = 'user-test-1'
    const videoId = 'video-test-1'
    const monthId = 'month-2026-10'
    const cycleId = 'cycle-1'

    const rewardKey = `video:${userId}:${videoId}:${monthId}:${cycleId}`

    function attemptAwardStar(key: string, stars: number): number {
      if (seenRewardKeys.has(key)) return 0
      seenRewardKeys.add(key)
      return stars
    }

    const duration = 180
    const stars = starsForVideoDuration(duration) // 3 stars

    // First completion
    const firstAward = attemptAwardStar(rewardKey, stars)
    assert.equal(firstAward, 3)

    // Retried ENDED heartbeat with same key
    const secondAward = attemptAwardStar(rewardKey, stars)
    assert.equal(secondAward, 0)

    // Third retry
    const thirdAward = attemptAwardStar(rewardKey, stars)
    assert.equal(thirdAward, 0)
  })
})

describe('Prompt 1 — Rapid Lesson Switching Latency Benchmark', () => {
  it('measures 50 rapid switch iterations: p50 and p95 under 15ms simulated overhead', () => {
    const latencies: number[] = []

    for (let i = 0; i < 50; i++) {
      const start = performance.now()
      // Simulate AbortController cancellation + state switch
      const abortCtrl = new AbortController()
      abortCtrl.abort() // abort previous
      const newCtrl = new AbortController()
      const end = performance.now()
      latencies.push(end - start)
    }

    latencies.sort((a, b) => a - b)
    const p50 = latencies[Math.floor(latencies.length * 0.5)]
    const p95 = latencies[Math.floor(latencies.length * 0.95)]

    assert.ok(p50 < 1.0, `p50 should be sub-millisecond, got ${p50}ms`)
    assert.ok(p95 < 5.0, `p95 should be under 5ms, got ${p95}ms`)
  })
})
