import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  capVideoProgress,
  hasWatchedFullVideo,
  hasCompletedVideoAtEnd,
  endedCompletionToleranceSeconds,
  endedReachAllowanceSeconds,
} from '../lib/video-progress-rules'
import { VideoPlaybackGuard } from '../lib/video-playback-guard'

describe('P0 — Video Continuity & Anti-Seek Verification Suite (Section 6 Scenarios)', () => {
  const DURATION_600 = 600

  it('Scenario 1: Xem từ 0 đến 60 giây ở 1x -> Ghi nhận khoảng 60 giây hợp lệ', () => {
    let currentFurthest = 0
    let lastPosition = 0
    const rate = 1

    // 6 heartbeats of 10s each at 1x
    for (let i = 1; i <= 6; i++) {
      const position = i * 10
      const elapsed = 10
      const cap = capVideoProgress(currentFurthest, position, position, elapsed, rate, 0)
      currentFurthest = cap.furthestWatchedPositionSeconds
      lastPosition = cap.lastPositionSeconds
      assert.equal(currentFurthest, position, `Heartbeat ${i} should advance furthest to ${position}s`)
      assert.equal(lastPosition, position)
    }

    assert.equal(currentFurthest, 60)
    assert.equal(hasCompletedVideoAtEnd(currentFurthest, DURATION_600, 'HEARTBEAT'), false)
  })

  it('Scenario 2: Xem từ 0 đến 60 giây ở 2x -> Ghi nhận khoảng 60 giây sau khoảng 30 giây thực', () => {
    let currentFurthest = 0
    let lastPosition = 0
    const rate = 2 // 2x playback speed

    // 3 heartbeats of 10s wall-clock each at 2x = 20s content progress per heartbeat
    for (let i = 1; i <= 3; i++) {
      const position = i * 20
      const elapsed = 10 // 10s elapsed wall time
      const cap = capVideoProgress(currentFurthest, position, position, elapsed, rate, 0)
      currentFurthest = cap.furthestWatchedPositionSeconds
      lastPosition = cap.lastPositionSeconds
      assert.equal(currentFurthest, position, `Heartbeat ${i} at 2x should advance furthest to ${position}s`)
      assert.equal(lastPosition, position)
    }

    // 30 seconds of real wall-clock time watched 60 seconds of video
    assert.equal(currentFurthest, 60)
  })

  it('Scenario 3: Xem đến giây 60, tua tới 540 -> Không mở quyền học đoạn 60–540', () => {
    const currentFurthest = 60
    const requestedPosition = 540
    const requestedFurthest = 540
    const elapsedSeconds = 1 // 1s instantaneous seek
    const rate = 1

    const cap = capVideoProgress(currentFurthest, requestedPosition, requestedFurthest, elapsedSeconds, rate, 0)

    // Must NOT advance furthest into unverified territory
    assert.equal(cap.furthestWatchedPositionSeconds, 60, 'Furthest must remain at 60s, blocking 60-540s')
    assert.equal(cap.lastPositionSeconds, 60, 'Last position must be clamped to authorized 60s')
  })

  it('Scenario 4: Tua tới 540, xem thêm 30 giây -> Không được cộng 30 giây đó như bằng chứng đã xem liên tục từ giây 60', () => {
    // Current server confirmed furthest is 60s.
    // Learner skipped to 540s and watched from 540s to 570s over 30 seconds.
    const currentFurthest = 60
    const requestedPosition = 570
    const requestedFurthest = 570
    const elapsedSeconds = 30
    const rate = 1

    const cap = capVideoProgress(currentFurthest, requestedPosition, requestedFurthest, elapsedSeconds, rate, 0)

    // The learner NEVER watched 60-90s, so furthest must NOT be 90s!
    // It must remain strictly at 60s.
    assert.equal(
      cap.furthestWatchedPositionSeconds,
      60,
      'Watching at 540s-570s cannot be credited as continuous watch time from 60s'
    )
    assert.equal(cap.lastPositionSeconds, 60)
  })

  it('Scenario 5: Tua lùi từ 60 về 30 -> Cho phép, furthest giữ nguyên 60, lastPosition là 30', () => {
    const currentFurthest = 60
    const requestedPosition = 30 // Rewound to 30s
    const requestedFurthest = 60
    const elapsedSeconds = 5
    const rate = 1

    const cap = capVideoProgress(currentFurthest, requestedPosition, requestedFurthest, elapsedSeconds, rate, 0)

    // Furthest is monotonic and stays at 60s
    assert.equal(cap.furthestWatchedPositionSeconds, 60)
    // lastPosition reflects rewound playback position
    assert.equal(cap.lastPositionSeconds, 30)
  })

  it('Scenario 6: Pause 30 giây -> Không tăng tiến độ', () => {
    const currentFurthest = 60
    const requestedPosition = 60 // Did not advance while paused
    const requestedFurthest = 60
    const elapsedSeconds = 30 // 30 seconds elapsed on clock while paused
    const rate = 1

    const cap = capVideoProgress(currentFurthest, requestedPosition, requestedFurthest, elapsedSeconds, rate, 0)

    assert.equal(cap.furthestWatchedPositionSeconds, 60, 'Pause cannot increase progress')
    assert.equal(cap.lastPositionSeconds, 60)
  })

  it('Scenario 7: Buffering 20 giây -> Không tăng tiến độ', () => {
    const currentFurthest = 45
    const requestedPosition = 45 // Buffering at 45s
    const requestedFurthest = 45
    const elapsedSeconds = 20
    const rate = 1

    const cap = capVideoProgress(currentFurthest, requestedPosition, requestedFurthest, elapsedSeconds, rate, 0)

    assert.equal(cap.furthestWatchedPositionSeconds, 45, 'Buffering cannot increase progress')
    assert.equal(cap.lastPositionSeconds, 45)
  })

  it('Scenario 8: Xem đủ video rồi ENDED -> Hoàn thành và thưởng theo quy tắc', () => {
    const duration = 600
    // Honest viewer watched continuously to 597s
    let currentFurthest = 597
    const tolerance = endedCompletionToleranceSeconds(duration) // 3s
    const rate = 1
    const endGrace = endedReachAllowanceSeconds(rate)

    // Final heartbeat with ENDED: 3s elapsed from 597s to 600s
    const finalCap = capVideoProgress(currentFurthest, 600, 600, 3, rate, endGrace)

    assert.equal(finalCap.furthestWatchedPositionSeconds, 600)
    const isCompleted = hasCompletedVideoAtEnd(finalCap.furthestWatchedPositionSeconds, duration, 'ENDED')
    assert.equal(isCompleted, true, 'Honest full watch must complete successfully')
  })

  it('Scenario 9: Gửi ENDED sau khi tua đến cuối -> Không hoàn thành', () => {
    const duration = 600
    // Learner only watched up to 60s, then jumped to 600s and fired ENDED
    const currentFurthest = 60
    const maliciousPosition = 600
    const elapsedSeconds = 2
    const rate = 2
    const endGrace = endedReachAllowanceSeconds(rate)

    const cap = capVideoProgress(currentFurthest, maliciousPosition, maliciousPosition, elapsedSeconds, rate, endGrace)

    // Cannot jump from 60s to 600s in 2 seconds
    assert.equal(cap.furthestWatchedPositionSeconds, 60, 'Furthest must not jump to end')

    const isCompleted = hasCompletedVideoAtEnd(cap.furthestWatchedPositionSeconds, duration, 'ENDED')
    assert.equal(isCompleted, false, 'Malicious jump to end followed by ENDED must NOT complete')
  })

  it('Scenario 10: Đổi A -> B -> A nhanh -> Không rò rỉ session/progress', () => {
    const guardA = new VideoPlaybackGuard({
      lessonId: 'lesson-A',
      videoId: 'video-A',
      duration: 600,
      initialFurthest: 60,
      initialPosition: 60,
      allowFreeSeek: false,
      isCompleted: false,
    })

    const guardB = new VideoPlaybackGuard({
      lessonId: 'lesson-B',
      videoId: 'video-B',
      duration: 300,
      initialFurthest: 300,
      initialPosition: 300,
      allowFreeSeek: true,
      isCompleted: true,
    })

    // In-flight response from B with 300s
    const lateResponseFromB = {
      lessonId: 'lesson-B',
      videoId: 'video-B',
      furthestWatchedPositionSeconds: 300,
      videoCompleted: true,
    }

    const res = guardA.onServerProgressResponse(1, lateResponseFromB)
    assert.equal(res.applied, false)
    assert.equal(res.reason, 'LESSON_MISMATCH')
    assert.equal(guardA.serverConfirmedFurthest, 60)
    assert.equal(guardA.isCompleted, false)
    assert.equal(guardA.canSeekFreely(), false)
  })
})
