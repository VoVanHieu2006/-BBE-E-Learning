/**
 * Phiên 7: heartbeat 20 s cho video >= 30 s (video < 30 s giữ 3 s).
 *
 * Bộ test này mô phỏng đúng phép tính mà `recordVideoHeartbeat` dùng cho tiến độ
 * chu kỳ (capVideoProgress + heartbeatElapsed + endedReachAllowanceSeconds +
 * hasCompletedVideoAtEnd, lưu Math.floor như cột DB) và một trình phát gửi
 * PLAY/PAUSE/ẩn tab/đổi tốc độ/ENDED ngay, heartbeat theo `videoHeartbeatIntervalMs`.
 * Yêu cầu bắt buộc: xem hết video luôn được ghi nhận 100%, không kẹt ở 98–99%.
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  capVideoProgress,
  displayVideoProgressPercent,
  endedCompletionToleranceSeconds,
  endedReachAllowanceSeconds,
  hasCompletedVideoAtEnd,
  normalizePlaybackRate,
  videoHeartbeatIntervalMs,
  LONG_VIDEO_HEARTBEAT_INTERVAL_MS,
  SHORT_VIDEO_HEARTBEAT_INTERVAL_MS,
  type VideoProgressEvent,
} from '../lib/video-progress-rules'
import { heartbeatElapsed, MAX_HEARTBEAT_GAP_SECONDS } from '../lib/learning-cycle-rules'

type Sent = { wall: number; commit: number; event: VideoProgressEvent; position: number; rate: number; furthest: number; completed: boolean }

/** Server side: same math as the cycle-progress branch of recordVideoHeartbeat. */
class ServerSim {
  furthest = 0
  lastAt: Date | null = null
  completed = false
  log: Sent[] = []
  constructor(readonly duration: number, private freshReplay = false) {}

  receive(wall: number, commit: number, position: number, rate: number, event: VideoProgressEvent) {
    const now = new Date(Math.round(commit * 1000))
    const elapsed = heartbeatElapsed(this.lastAt, now)
    const playbackRate = normalizePlaybackRate(rate)
    const grace = event === 'ENDED' ? endedReachAllowanceSeconds(playbackRate) : 0
    const tolerance = endedCompletionToleranceSeconds(this.duration)
    const already = this.completed || this.furthest >= this.duration - tolerance
    let furthest: number
    if (this.freshReplay && !this.lastAt) {
      // A brand-new monthly replay: the first request only establishes the clock.
      furthest = 0
    } else {
      const cap = capVideoProgress(this.furthest, position, position, elapsed, playbackRate, grace)
      furthest = Math.min(this.duration, cap.furthestWatchedPositionSeconds)
    }
    this.completed = already || hasCompletedVideoAtEnd(furthest, this.duration, event)
    this.furthest = Math.floor(this.completed ? this.duration : furthest)
    this.lastAt = now
    this.log.push({ wall, commit, event, position, rate, furthest: this.furthest, completed: this.completed })
  }

  get percent() {
    return displayVideoProgressPercent(this.furthest, this.duration, this.completed)
  }
}

type Interruption =
  | { kind: 'pause'; atPosition: number; forSeconds: number }
  | { kind: 'hidden'; atPosition: number; forSeconds: number; throttledEveryMs: number }
  | { kind: 'speed'; atPosition: number; to: number }

/**
 * Client side: PLAY at start, scheduled HEARTBEAT every interval while playing,
 * immediate PAUSE/PLAY/visibility/speed markers, ENDED (with the player's own
 * duration) plus the player's two retries (1 s, 2 s).
 */
function watch(server: ServerSim, opts: {
  playerDuration?: number
  rate?: number
  startPosition?: number
  latency?: (index: number, event: VideoProgressEvent) => number
  interruptions?: Interruption[]
}) {
  const duration = opts.playerDuration ?? server.duration
  let rate = opts.rate ?? 1
  const latency = opts.latency ?? (() => 0.15)
  const pending = [...(opts.interruptions ?? [])].sort((a, b) => a.atPosition - b.atPosition)
  let wall = 0
  let position = opts.startPosition ?? 0
  let index = 0
  const send = (event: VideoProgressEvent, at = position, r = rate) => {
    server.receive(wall, wall + latency(index++, event), at, r, event)
  }
  const interval = videoHeartbeatIntervalMs(duration) / 1000

  send('PLAY')
  let nextBeat = wall + interval
  while (position < duration) {
    const next = pending[0]
    const wallToEnd = (duration - position) / rate
    const wallToEvent = next ? Math.max(0, (next.atPosition - position) / rate) : Infinity
    const step = Math.min(nextBeat - wall, wallToEnd, wallToEvent)
    wall += step
    position = Math.min(duration, position + step * rate)
    if (position >= duration) break
    if (next && step === wallToEvent) {
      pending.shift()
      if (next.kind === 'pause') {
        send('PAUSE')
        wall += next.forSeconds
        send('PLAY')
        nextBeat = wall + interval // stopHeartbeat on PAUSE, startHeartbeat on PLAYING
      } else if (next.kind === 'speed') {
        send('HEARTBEAT', position, rate) // setSpeed sends the old-rate checkpoint first
        rate = next.to
      } else {
        // Tab hidden while the video keeps playing: PAUSE marker now, the
        // throttled interval keeps firing, PLAY marker when visible again.
        send('PAUSE')
        const end = wall + next.forSeconds
        let throttled = wall + next.throttledEveryMs / 1000
        while (throttled <= end && position < duration) {
          const dt = throttled - wall
          wall = throttled
          position = Math.min(duration, position + dt * rate)
          if (position >= duration) break
          send('HEARTBEAT')
          throttled += next.throttledEveryMs / 1000
        }
        if (position < duration) {
          const dt = end - wall
          wall = end
          position = Math.min(duration, position + dt * rate)
          if (position < duration) send('PLAY')
          nextBeat = wall + interval
        }
      }
      continue
    }
    if (step === nextBeat - wall) {
      send('HEARTBEAT')
      nextBeat = wall + interval
    }
  }
  // finishPlayback: up to 3 ENDED attempts, waiting 1 s then 2 s.
  let endedAttempts = 0
  for (let attempt = 1; attempt <= 3 && !server.completed; attempt++) {
    endedAttempts++
    send('ENDED', duration)
    if (!server.completed && attempt < 3) wall += attempt
  }
  return { endedAttempts, wall }
}

function assertCompletedOnFirstEnded(server: ServerSim, result: { endedAttempts: number }) {
  assert.equal(server.completed, true, `video ${server.duration}s must complete: ${JSON.stringify(server.log.slice(-3))}`)
  assert.equal(server.percent, 100)
  assert.equal(server.furthest, server.duration)
  assert.equal(result.endedAttempts, 1, 'the first ENDED must already complete the lesson (no retry needed)')
}

function assertEveryRequestAccepted(server: ServerSim) {
  for (const sent of server.log) {
    if (sent.event === 'ENDED') continue
    assert.ok(sent.furthest >= Math.floor(sent.position) - 1,
      `${sent.event} at ${sent.position.toFixed(1)}s accepted only ${sent.furthest}s`)
  }
}

describe('Heartbeat cadence (Phiên 7)', () => {
  test('videos < 30 s keep 3 s; videos >= 30 s or unknown duration use 20 s', () => {
    assert.equal(SHORT_VIDEO_HEARTBEAT_INTERVAL_MS, 3000)
    assert.equal(LONG_VIDEO_HEARTBEAT_INTERVAL_MS, 20000)
    for (const d of [1, 15, 19.9, 25, 29.9]) assert.equal(videoHeartbeatIntervalMs(d), 3000, `${d}s`)
    for (const d of [30, 35, 600, 3600, 0, NaN, -1]) assert.equal(videoHeartbeatIntervalMs(d), 20000, `${d}s`)
    assert.ok(LONG_VIDEO_HEARTBEAT_INTERVAL_MS / 1000 * 3 < MAX_HEARTBEAT_GAP_SECONDS,
      '20 s is far inside the 300 s server gap window')
  })

  test('YouTubePlayer uses the shared cadence and still sends state changes immediately', () => {
    const source = readFileSync(join(__dirname, '../components/YouTubePlayer.tsx'), 'utf8')
    assert.match(source, /const intervalMs = videoHeartbeatIntervalMs\(d\);/)
    assert.doesNotMatch(source, /\? 3000 : 10000/)
    assert.match(source, /sendProgressRef\.current\(ct, serverConfirmedFurthestRef\.current, 'PLAY'\)/)
    assert.match(source, /sendProgressRef\.current\(ct, serverConfirmedFurthestRef\.current, 'PAUSE'\)/)
    assert.match(source, /document\.visibilityState === 'hidden' \? 'PAUSE' : 'PLAY'/)
    assert.match(source, /'HEARTBEAT', oldRate, true\)/)
    assert.match(source, /originSession\?\.send\(d, d, actualRate, 'ENDED'\)/)
  })
})

describe('Video completion with a 20 s heartbeat', () => {
  test('last heartbeat 19 s before the end -> ENDED completes the lesson', () => {
    const server = new ServerSim(600)
    const result = watch(server, { startPosition: 1 }) // heartbeats at 21, 41, ..., 581
    const lastBeat = server.log.filter(s => s.event === 'HEARTBEAT').at(-1)!
    assert.equal(Math.round(lastBeat.position), 581)
    assert.equal(server.log.at(-1)!.position - lastBeat.position, 19)
    assertCompletedOnFirstEnded(server, result)
  })

  test('last heartbeat 19 s before the end, committed 7 s late -> ENDED still completes', () => {
    const server = new ServerSim(600)
    const result = watch(server, {
      startPosition: 1,
      latency: (_i, event) => (event === 'HEARTBEAT' ? 7 : 0.1),
    })
    assertCompletedOnFirstEnded(server, result)
  })

  test('player duration 599.6 s vs database 600 s: first ENDED reaches 100%', () => {
    const server = new ServerSim(600)
    assertCompletedOnFirstEnded(server, watch(server, { playerDuration: 599.6 }))
  })

  test('player duration 600.4 s vs database 600 s reaches 100% (at the 600 s heartbeat or ENDED)', () => {
    const server = new ServerSim(600)
    const result = watch(server, { playerDuration: 600.4 })
    assert.equal(server.completed, true)
    assert.equal(server.percent, 100)
    assert.ok(result.endedAttempts <= 1)
  })

  for (const duration of [15, 25]) {
    test(`${duration} s video (3 s heartbeat) completes`, () => {
      const server = new ServerSim(duration)
      const result = watch(server, {})
      assert.ok(server.log.filter(s => s.event === 'HEARTBEAT').length >= Math.floor(duration / 3) - 1)
      assertEveryRequestAccepted(server)
      assertCompletedOnFirstEnded(server, result)
    })
  }

  for (const duration of [30, 35, 39]) {
    test(`${duration} s video (shortest on 20 s heartbeat) completes`, () => {
      const server = new ServerSim(duration)
      const result = watch(server, {})
      assertEveryRequestAccepted(server)
      assertCompletedOnFirstEnded(server, result)
    })
  }

  test('long video (1 h) watched straight through is accepted at every heartbeat and completes', () => {
    const server = new ServerSim(3600)
    const result = watch(server, {})
    assert.equal(server.log.filter(s => s.event === 'HEARTBEAT').length, 179)
    assertEveryRequestAccepted(server)
    assertCompletedOnFirstEnded(server, result)
  })

  for (const rate of [1.25, 1.5, 1.75, 2]) {
    test(`${rate}x playback is accepted at every heartbeat and completes`, () => {
      const server = new ServerSim(600)
      const result = watch(server, { rate, startPosition: 1 })
      assertEveryRequestAccepted(server)
      assertCompletedOnFirstEnded(server, result)
    })
  }

  test('2x with alternating 0-3 s commit latency still completes', () => {
    const server = new ServerSim(900)
    const result = watch(server, { rate: 2, latency: i => (i % 3) * 1.5 })
    assertCompletedOnFirstEnded(server, result)
  })

  test('speed changed 1x -> 2x -> 1x mid-video completes', () => {
    const server = new ServerSim(600)
    const result = watch(server, {
      interruptions: [{ kind: 'speed', atPosition: 133, to: 2 }, { kind: 'speed', atPosition: 471, to: 1 }],
    })
    assertEveryRequestAccepted(server)
    assertCompletedOnFirstEnded(server, result)
  })

  for (const pauseSeconds of [5, 120, 600]) {
    test(`pause at 590 s for ${pauseSeconds} s, then resume -> completes`, () => {
      const server = new ServerSim(600)
      const result = watch(server, { interruptions: [{ kind: 'pause', atPosition: 590, forSeconds: pauseSeconds }] })
      assertEveryRequestAccepted(server)
      assertCompletedOnFirstEnded(server, result)
    })
  }

  test('pause at 590 s for 10 min at 2x, then resume -> completes', () => {
    const server = new ServerSim(600)
    const result = watch(server, { rate: 2, interruptions: [{ kind: 'pause', atPosition: 590, forSeconds: 600 }] })
    assertCompletedOnFirstEnded(server, result)
  })

  for (const throttledEveryMs of [20000, 60000]) {
    test(`tab hidden 4 min while playing (timer every ${throttledEveryMs / 1000} s), then visible -> completes`, () => {
      const server = new ServerSim(900)
      const result = watch(server, {
        interruptions: [{ kind: 'hidden', atPosition: 300, forSeconds: 240, throttledEveryMs }],
      })
      assertEveryRequestAccepted(server)
      assertCompletedOnFirstEnded(server, result)
    })
  }

  test('tab hidden until the video ends -> ENDED still completes', () => {
    const server = new ServerSim(600)
    const result = watch(server, {
      interruptions: [{ kind: 'hidden', atPosition: 500, forSeconds: 400, throttledEveryMs: 60000 }],
    })
    assertCompletedOnFirstEnded(server, result)
  })

  test('monthly replay ("Xem lại tháng này") from 0 with 20 s heartbeat completes', () => {
    const server = new ServerSim(600, true)
    const result = watch(server, {})
    assertCompletedOnFirstEnded(server, result)
  })

  test('progress is never shown as 100% before ENDED and reaches 100% after it', () => {
    const server = new ServerSim(600)
    watch(server, {})
    const beforeEnded = server.log.filter(s => s.event !== 'ENDED')
    assert.ok(beforeEnded.every(s => !s.completed))
    assert.ok(beforeEnded.at(-1)!.furthest >= 580)
    assert.equal(server.percent, 100)
  })
})
