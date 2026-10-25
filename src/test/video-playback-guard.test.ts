import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { VideoPlaybackGuard } from '../lib/video-playback-guard'

describe('PHASE A — Reproduction & Proof of Previous Buggy Guard Logic', () => {
  /**
   * The flawed legacy guard implemented in YouTubePlayer.tsx line 684:
   * const ct = playerRef.current?.getCurrentTime?.() || 0;
   * const maxAllowed = serverConfirmedFurthestRef.current;
   * if (ct > maxAllowed + 3) {
   *   playerRef.current?.seekTo?.(maxAllowed, true);
   *   setCurrentTime(maxAllowed);
   * }
   */
  function legacyGuardCheck(ct: number, serverConfirmedFurthest: number): { shouldSeek: boolean; seekTarget: number } {
    const maxAllowed = serverConfirmedFurthest;
    if (ct > maxAllowed + 3) {
      return { shouldSeek: true, seekTarget: maxAllowed };
    }
    return { shouldSeek: false, seekTarget: ct };
  }

  it('Reproduces Scenario A (1x): Video pulls back at second 3.5 because heartbeat interval is 10s', () => {
    let serverConfirmedFurthest = 0;
    const seekEvents: number[] = [];

    // Simulate 1x playback ticking every 500ms for 10 seconds (before first heartbeat arrives)
    for (let t = 0; t <= 10; t += 0.5) {
      const check = legacyGuardCheck(t, serverConfirmedFurthest);
      if (check.shouldSeek) {
        seekEvents.push(t);
        // Player would be forcibly pulled back to 0!
      }
    }

    // In the legacy code, every tick from 3.5s to 10s triggered seekTo(0)!
    assert.ok(seekEvents.length > 0, 'Legacy guard must reproduce the seek-back bug');
    assert.equal(seekEvents[0], 3.5, 'First seek-back triggered at ct=3.5s');
  })

  it('Reproduces Scenario B (2x): Video pulls back at second 1.75s of real time', () => {
    let serverConfirmedFurthest = 0;
    const seekEvents: number[] = [];

    // At 2x, content time advances twice as fast
    for (let wallTime = 0; wallTime <= 5; wallTime += 0.5) {
      const contentTime = wallTime * 2;
      const check = legacyGuardCheck(contentTime, serverConfirmedFurthest);
      if (check.shouldSeek) {
        seekEvents.push(contentTime);
      }
    }

    assert.ok(seekEvents.length > 0, 'Legacy guard must reproduce 2x seek-back bug');
    // At wallTime = 2.0s, contentTime = 4.0s > 0 + 3 => seekTo(0)
    assert.equal(seekEvents[0], 4.0, 'First seek-back triggered when ct=4.0s (after only 2s real time)');
  })

  it('Reproduces Scenario D: Out-of-order response overwrites serverConfirmedFurthest with older value', () => {
    let serverConfirmedFurthest = 0;

    // Heartbeat 2 arrives with 20s
    serverConfirmedFurthest = 20;

    // Heartbeat 1 (delayed) arrives later with 10s and blindly overwrites!
    serverConfirmedFurthest = 10; // legacy applyServerProgress did not check Math.max or sequence

    // Player is at 22s
    const check = legacyGuardCheck(22, serverConfirmedFurthest);
    assert.equal(check.shouldSeek, true, 'Player at 22s is forcibly pulled back to 10s due to stale response!');
    assert.equal(check.seekTarget, 10);
  })
})

describe('PHASE B & C — VideoPlaybackGuard Robust Architecture Verification', () => {
  it('Scenario A (1x continuous playback): Plays 30 seconds smoothly with 0 seek-backs', () => {
    const corrections: any[] = [];
    const guard = new VideoPlaybackGuard({
      lessonId: 'lesson-101',
      videoId: 'yt-abc',
      duration: 180,
      initialPosition: 0,
      initialFurthest: 0,
      onSeekCorrection: (target, reason) => corrections.push({ target, reason }),
    });

    guard.onStateChange(1, 0, 1000); // PLAYING at t=1000ms

    // Simulate 30 seconds of playback ticking every 500ms
    let now = 1000;
    let ct = 0;
    for (let step = 0; step < 60; step++) {
      now += 500;
      ct += 0.5;

      // Every 10 seconds, send a heartbeat and receive response
      if (step === 20) { // t = 10s
        const req = guard.createProgressRequest(ct, now);
        // Server responds with 10s
        guard.onServerProgressResponse(req.seq, { furthestWatchedPositionSeconds: 10 });
      }
      if (step === 40) { // t = 20s
        const req = guard.createProgressRequest(ct, now);
        guard.onServerProgressResponse(req.seq, { furthestWatchedPositionSeconds: 20 });
      }

      const res = guard.onTick(ct, now);
      assert.equal(res.shouldSeek, false, `Must NOT seek at content time ${ct}s`);
    }

    assert.equal(corrections.length, 0, 'Zero seek corrections during legitimate 1x continuous playback');
    assert.equal(guard.localContinuousPosition, 30);
  })

  it('Scenario B (2x continuous playback): Plays at 2x smoothly with 0 seek-backs', () => {
    const corrections: any[] = [];
    const guard = new VideoPlaybackGuard({
      lessonId: 'lesson-101',
      videoId: 'yt-abc',
      duration: 180,
      initialPosition: 0,
      initialFurthest: 0,
      onSeekCorrection: (target, reason) => corrections.push({ target, reason }),
    });

    guard.setPlaybackRate(2);
    guard.onStateChange(1, 0, 1000);

    let now = 1000;
    let ct = 0;
    // 15 seconds real time = 30 seconds content time at 2x
    for (let step = 0; step < 30; step++) {
      now += 500;
      ct += 1.0; // 1s content per 500ms real time at 2x

      if (step === 20) { // 10s real time (ct = 20s)
        const req = guard.createProgressRequest(ct, now);
        guard.onServerProgressResponse(req.seq, { furthestWatchedPositionSeconds: 20 });
      }

      const res = guard.onTick(ct, now);
      assert.equal(res.shouldSeek, false, `Must NOT seek at 2x content time ${ct}s`);
    }

    assert.equal(corrections.length, 0, 'Zero seek corrections during legitimate 2x continuous playback');
    assert.equal(guard.localContinuousPosition, 30);
  })

  it('Scenario B2 (All supported rates: 1.25x, 1.5x, 1.75x): Play smoothly', () => {
    for (const rate of [1.25, 1.5, 1.75]) {
      const guard = new VideoPlaybackGuard({
        lessonId: 'lesson-rates',
        videoId: 'yt-rates',
        duration: 120,
        initialPosition: 0,
        initialFurthest: 0,
      });
      guard.setPlaybackRate(rate);
      guard.onStateChange(1, 0, 1000);

      let now = 1000;
      let ct = 0;
      for (let step = 0; step < 20; step++) {
        now += 500;
        ct += 0.5 * rate;
        const res = guard.onTick(ct, now);
        assert.equal(res.shouldSeek, false, `Rate ${rate}x should not seek at ct=${ct}`);
      }
      assert.ok(guard.localContinuousPosition > 0);
    }
  })

  it('Scenario C: Slow heartbeat response (delayed 5 seconds) does not interrupt playback', () => {
    const corrections: any[] = [];
    const guard = new VideoPlaybackGuard({
      lessonId: 'lesson-101',
      videoId: 'yt-abc',
      duration: 180,
      initialPosition: 10,
      initialFurthest: 10,
      onSeekCorrection: (target, reason) => corrections.push({ target, reason }),
    });

    guard.onStateChange(1, 10, 1000);

    let now = 1000;
    let ct = 10;
    // Send heartbeat at ct = 10s
    const req = guard.createProgressRequest(ct, now);

    // Player continues playing for 5 seconds while heartbeat response is in-flight
    for (let step = 0; step < 10; step++) {
      now += 500;
      ct += 0.5;
      const res = guard.onTick(ct, now);
      assert.equal(res.shouldSeek, false, `Playing continuously while waiting for slow heartbeat at ct=${ct}`);
    }

    // Now response finally arrives after 5 seconds delay
    const applyRes = guard.onServerProgressResponse(req.seq, { furthestWatchedPositionSeconds: 15 });
    assert.equal(applyRes.applied, true);
    assert.equal(guard.serverConfirmedFurthest, 15);
    assert.equal(corrections.length, 0, 'No seeks during slow network response');
  })

  it('Scenario D: Out-of-order heartbeat responses do not downgrade furthest or seek back', () => {
    const guard = new VideoPlaybackGuard({
      lessonId: 'lesson-101',
      videoId: 'yt-abc',
      duration: 180,
      initialPosition: 0,
      initialFurthest: 0,
    });

    const req1 = guard.createProgressRequest(10, 10000); // seq = 1
    const req2 = guard.createProgressRequest(20, 20000); // seq = 2

    // req2 arrives first
    const res2 = guard.onServerProgressResponse(req2.seq, { furthestWatchedPositionSeconds: 20 });
    assert.equal(res2.applied, true);
    assert.equal(guard.serverConfirmedFurthest, 20);

    // req1 arrives later with older value 10s
    const res1 = guard.onServerProgressResponse(req1.seq, { furthestWatchedPositionSeconds: 10 });
    assert.equal(res1.applied, false, 'Stale sequence response should be rejected');
    assert.equal(guard.serverConfirmedFurthest, 20, 'serverConfirmedFurthest must NOT decrease');

    // Player is at 25s
    guard.onStateChange(1, 20, 20000);
    const tick = guard.onTick(25, 25000);
    assert.equal(tick.shouldSeek, false, 'No seek triggered after out-of-order response');
  })

  it('Scenario E: Unauthorized forward jump (cheat attempt) is blocked and corrected', () => {
    const corrections: any[] = [];
    const guard = new VideoPlaybackGuard({
      lessonId: 'lesson-101',
      videoId: 'yt-abc',
      duration: 180,
      initialPosition: 20,
      initialFurthest: 20,
      onSeekCorrection: (target, reason, details) => corrections.push({ target, reason, details }),
    });

    guard.onStateChange(1, 20, 1000);

    // Suddenly in 500ms, player jumps from 20s to 90s!
    const tick = guard.onTick(90, 1500);

    assert.equal(tick.shouldSeek, true, 'Unauthorized forward jump must trigger seek correction');
    assert.equal(tick.seekTarget, 20, 'Must clamp back to the maximum allowed position (20s)');
    assert.equal(corrections.length, 1);
    assert.equal(corrections[0].reason, 'UNAUTHORIZED_FORWARD_SEEK');
  })

  it('Scenario F: Backward seek and re-watching within watched segment is fully permitted', () => {
    const corrections: any[] = [];
    const guard = new VideoPlaybackGuard({
      lessonId: 'lesson-101',
      videoId: 'yt-abc',
      duration: 180,
      initialPosition: 50,
      initialFurthest: 50,
      onSeekCorrection: (target, reason) => corrections.push({ target, reason }),
    });

    // Learner rewinds to 10s
    const seekResult = guard.clampManualSeek(10);
    assert.equal(seekResult.clampedTime, 10);
    assert.equal(seekResult.wasClamped, false);

    guard.onStateChange(1, 10, 1000);

    // Learner plays from 10s to 30s
    let now = 1000;
    let ct = 10;
    for (let step = 0; step < 40; step++) {
      now += 500;
      ct += 0.5;
      const res = guard.onTick(ct, now);
      assert.equal(res.shouldSeek, false, 'Re-watching previously earned content must not seek');
    }
    assert.equal(corrections.length, 0);
  })

  it('Scenario G: Free seek accounts (Admin / Guest / Completed) can seek anywhere without blockage', () => {
    const adminGuard = new VideoPlaybackGuard({
      lessonId: 'lesson-admin',
      videoId: 'yt-admin',
      duration: 300,
      allowFreeSeek: true,
    });

    adminGuard.onStateChange(1, 0, 1000);
    const tick = adminGuard.onTick(280, 1500); // Direct jump to 280s
    assert.equal(tick.shouldSeek, false, 'Admin / free-seek must not be blocked');

    const completedGuard = new VideoPlaybackGuard({
      lessonId: 'lesson-comp',
      videoId: 'yt-comp',
      duration: 300,
      isCompleted: true,
    });
    const completedTick = completedGuard.onTick(250, 1500);
    assert.equal(completedTick.shouldSeek, false, 'Completed video allows review seeking');
  })

  it('Scenario H: Manual seek UI clamp respects allowed boundaries', () => {
    const memberGuard = new VideoPlaybackGuard({
      lessonId: 'lesson-member',
      videoId: 'yt-member',
      duration: 200,
      initialFurthest: 40,
    });

    // Member attempts to click at 150s on timeline
    const clamp150 = memberGuard.clampManualSeek(150);
    assert.equal(clamp150.wasClamped, true);
    assert.equal(clamp150.clampedTime, 40, 'Must clamp to 40s');

    // Member clicks at 25s on timeline (already watched)
    const clamp25 = memberGuard.clampManualSeek(25);
    assert.equal(clamp25.wasClamped, false);
    assert.equal(clamp25.clampedTime, 25);
  })

  it('Scenario I: Pause and Buffering transitions do not allow fake time leaps', () => {
    const guard = new VideoPlaybackGuard({
      lessonId: 'lesson-buffer',
      videoId: 'yt-buf',
      duration: 200,
      initialFurthest: 10,
    });

    guard.onStateChange(1, 10, 1000);
    // User pauses
    guard.onStateChange(2, 10, 2000);

    // 10 real seconds pass while paused
    // When resuming, player reports same position:
    guard.onStateChange(1, 10, 12000);
    const tick = guard.onTick(10.5, 12500);
    assert.equal(tick.shouldSeek, false);

    // What if malicious script tried to jump to 50s while claiming to resume?
    const cheatTick = guard.onTick(50, 13000);
    assert.equal(cheatTick.shouldSeek, true, 'Cannot leap forward after pause');
    assert.equal(cheatTick.seekTarget, 10.5);
  })
})

describe('SECTION 6 — MANDATORY ACCEPTANCE TESTS (Test mới quan trọng nhất)', () => {
  it('TEST 1: Continuous playback from 20s with delayed heartbeat does NOT seek back to 20s', () => {
    let seekBackTriggered = false;
    let seekTarget: number | null = null;

    const guard = new VideoPlaybackGuard({
      lessonId: 'lesson-sec6',
      videoId: 'yt-sec6',
      duration: 300,
      initialPosition: 20,
      initialFurthest: 20,
      onSeekCorrection: (target) => {
        seekBackTriggered = true;
        seekTarget = target;
      },
    });

    assert.equal(guard.serverConfirmedFurthest, 20);

    // Video begins continuous playback at second 20
    let now = 1000;
    guard.onStateChange(1, 20, now);

    // Next heartbeat has not returned a response in 10 seconds.
    // Player advances to second 21, 22, 23, 24, 25... up to 30.
    for (let ct = 20; ct <= 30; ct += 0.5) {
      now += 500;
      const res = guard.onTick(ct, now);
      assert.equal(
        res.shouldSeek,
        false,
        `Video must continue playing normally at ct=${ct}s, must NOT seek back to 20s`
      );
    }

    assert.equal(seekBackTriggered, false, 'No automatic seek-back was triggered during continuous playback');
    assert.equal(seekTarget, null);
    assert.ok(guard.localContinuousPosition >= 30, 'Continuous position tracked legitimately up to 30s');
  })

  it('TEST 2: Active seek from 20s to 90s when server confirmed is 20s is strictly blocked', () => {
    let seekCorrectionCalled = false;
    let correctedTo: number | null = null;

    const guard = new VideoPlaybackGuard({
      lessonId: 'lesson-sec6',
      videoId: 'yt-sec6',
      duration: 300,
      initialPosition: 20,
      initialFurthest: 20,
      onSeekCorrection: (target) => {
        seekCorrectionCalled = true;
        correctedTo = target;
      },
    });

    // 1. Learner clicks or drags timeline to 90s
    const manualSeek = guard.clampManualSeek(90);
    assert.equal(manualSeek.wasClamped, true, 'Manual seek to 90s must be clamped by UI');
    assert.equal(manualSeek.clampedTime, 20, 'Manual seek must be clamped to max allowed (20s)');

    // 2. Malicious user hacks the player directly to jump to 90s
    guard.onStateChange(1, 20, 1000);
    const tickCheat = guard.onTick(90, 1500); // 90s after only 500ms

    assert.equal(tickCheat.shouldSeek, true, 'Unauthorized seek jump to 90s must be intercepted');
    assert.equal(tickCheat.seekTarget, 20, 'Seek target must be reset to allowed boundary (20s)');
    assert.equal(seekCorrectionCalled, true);
    assert.equal(correctedTo, 20);
  })
})
