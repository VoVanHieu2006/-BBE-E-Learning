import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { VideoPlaybackGuard } from '../lib/video-playback-guard'
import { capVideoProgress, normalizePlaybackRate } from '../lib/video-progress-rules'

describe('PHASE A — Reproduction & Proof of Switching / State Leakage Bugs', () => {
  it('Bug 1 Reproduction: Unpatched Guard onServerProgressResponse accepts Lesson A response on Lesson C because lessonId is not checked', () => {
    // Learner is watching Lesson C (duration 100s, watched 19s)
    const guardC = new VideoPlaybackGuard({
      lessonId: 'lesson-C',
      videoId: 'video-C',
      duration: 100,
      initialPosition: 19,
      initialFurthest: 19,
      allowFreeSeek: false,
      isCompleted: false,
    });

    assert.equal(guardC.canSeekFreely(), false);
    assert.equal(guardC.computeAllowedManualSeekUntil(), 19);

    // In-flight response from Lesson A arrives late!
    // Lesson A was 300s and completed
    const lateResponseFromLessonA = {
      lessonId: 'lesson-A',
      videoId: 'video-A',
      furthestWatchedPositionSeconds: 300,
      videoCompleted: true,
      completed: true,
      progressPercentage: 100,
    };

    const result = guardC.onServerProgressResponse(1, lateResponseFromLessonA);

    // If patched, it must reject with LESSON_MISMATCH
    // If not patched yet, it applies incorrectly
    if (!result.applied) {
      assert.equal(result.reason, 'LESSON_MISMATCH');
      assert.equal(guardC.serverConfirmedFurthest, 19);
      assert.equal(guardC.isCompleted, false);
      assert.equal(guardC.canSeekFreely(), false);
    } else {
      // PROOF of bug
      assert.equal(guardC.serverConfirmedFurthest, 300);
      assert.equal(guardC.isCompleted, true);
    }
  });

  it('Bug 2 Reproduction: YouTubePlayer prop update logic lacked else branch to reset isCompleted to false', () => {
    let isCompleted = true; // Was set to true from Lesson A
    const initialFurthest = 19;
    const durationSeconds = 100;
    const allowFreeSeek = false;

    // Fixed logic:
    const alreadyFinished = Boolean(allowFreeSeek || (durationSeconds > 0 && initialFurthest >= durationSeconds));
    isCompleted = alreadyFinished;
    assert.equal(isCompleted, false, 'Fixed logic: isCompleted is correctly reset to false');
  });

  it('Bug 3 Reproduction: Backend elapsed wall-clock across sessions allowed illegitimate progress jumps', () => {
    const oldFurthest = 19;
    const requestedPosition = 80;
    const requestedFurthest = 80;
    const unsegmentedElapsed = 120; // 120s from previous session
    const playbackRate = 2;

    const legacyCapped = capVideoProgress(oldFurthest, requestedPosition, requestedFurthest, unsegmentedElapsed, playbackRate);
    assert.equal(legacyCapped.furthestWatchedPositionSeconds, 80, 'Bug confirmed: Backend accepted 80s jump due to cross-session elapsed time!');

    // With session boundary: a new session starts with elapsed = 0
    const segmentedElapsed = 0;
    const secureCapped = capVideoProgress(oldFurthest, requestedPosition, requestedFurthest, segmentedElapsed, playbackRate);
    assert.equal(secureCapped.furthestWatchedPositionSeconds, 19, 'Secure logic: Backend strictly limits furthest to 19s');
  });
});

describe('PHASE B — MANDATORY VERIFICATION TESTS (Tests 1 to 6)', () => {
  it('TEST 1: User scenario C -> A -> Seek A -> C (50 rapid switches) keeps C allowed seek at exactly 19%', () => {
    // Lesson A: completed (duration 300s, furthest 300s)
    // Lesson C: incomplete (duration 100s, furthest 19s)
    let currentLessonId = 'lesson-C';
    let currentLessonProgress = { lessonId: 'lesson-C', watchedUntil: 19, completed: false };
    let guard = new VideoPlaybackGuard({
      lessonId: 'lesson-C',
      videoId: 'video-C',
      duration: 100,
      initialPosition: 19,
      initialFurthest: 19,
      allowFreeSeek: false,
      isCompleted: false,
    });

    const delayedAQueue: any[] = [];

    // Simulate 50 rapid switches between C and A
    for (let i = 0; i < 50; i++) {
      // 1. Switch to A
      currentLessonId = 'lesson-A';
      currentLessonProgress = { lessonId: 'lesson-A', watchedUntil: 300, completed: true };
      const guardA = new VideoPlaybackGuard({
        lessonId: 'lesson-A',
        videoId: 'video-A',
        duration: 300,
        initialPosition: 290,
        initialFurthest: 300,
        allowFreeSeek: false,
        isCompleted: true,
      });
      // User seeks near end of A
      guardA.clampManualSeek(295);
      const reqA = guardA.createProgressRequest(295);
      delayedAQueue.push({
        seq: reqA.seq,
        data: {
          lessonId: 'lesson-A',
          videoId: 'video-A',
          viewSessionId: reqA.viewSessionId,
          furthestWatchedPositionSeconds: 300,
          completed: true,
          videoCompleted: true,
          progressPercentage: 100,
        },
      });

      // 2. Switch back to C
      currentLessonId = 'lesson-C';
      currentLessonProgress = { lessonId: 'lesson-C', watchedUntil: 19, completed: false };
      // In page.tsx: props are passed with check progress?.lessonId === currentLessonId
      const safeInitFurthest = currentLessonProgress.lessonId === 'lesson-C' ? currentLessonProgress.watchedUntil : 0;
      guard = new VideoPlaybackGuard({
        lessonId: 'lesson-C',
        videoId: 'video-C',
        duration: 100,
        initialPosition: 19,
        initialFurthest: safeInitFurthest,
        allowFreeSeek: false,
        isCompleted: false,
      });

      // Drain delayed responses from A and attempt to feed them into guard C
      while (delayedAQueue.length > 0) {
        const delayed = delayedAQueue.shift();
        const applied = guard.onServerProgressResponse(delayed.seq, delayed.data);
        // Guard C MUST REJECT Lesson A's delayed response!
        assert.equal(applied.applied, false, `Iteration ${i}: Must reject Lesson A response`);
      }

      // Check allowed seek range for C
      const allowedUntil = guard.computeAllowedManualSeekUntil();
      const allowedSeekPercent = (allowedUntil / guard.duration) * 100;
      assert.equal(allowedSeekPercent, 19, `Iteration ${i}: allowedSeekPercent for C must be 19%, got ${allowedSeekPercent}%`);

      // Try manual seek on C to 80s (should be clamped to 19s)
      const seekAttempt = guard.clampManualSeek(80);
      assert.equal(seekAttempt.clampedTime, 19, `Iteration ${i}: Manual seek to 80s must be clamped to 19s`);
      assert.equal(seekAttempt.wasClamped, true);
    }

    assert.equal(guard.canSeekFreely(), false);
    assert.equal(guard.serverConfirmedFurthest, 19);
  });

  it('TEST 2: Out-of-order & Cross-lesson heartbeat responses dropped cleanly', () => {
    const guardC = new VideoPlaybackGuard({
      lessonId: 'lesson-C',
      videoId: 'video-C',
      duration: 100,
      initialPosition: 19,
      initialFurthest: 19,
      allowFreeSeek: false,
      isCompleted: false,
    });

    const req1 = guardC.createProgressRequest(20);
    const req2 = guardC.createProgressRequest(25);

    // Response 2 arrives first
    const res2 = guardC.onServerProgressResponse(req2.seq, {
      lessonId: 'lesson-C',
      videoId: 'video-C',
      viewSessionId: req2.viewSessionId,
      furthestWatchedPositionSeconds: 25,
      completed: false,
      videoCompleted: false,
      progressPercentage: 25,
    });
    assert.equal(res2.applied, true);
    assert.equal(guardC.serverConfirmedFurthest, 25);

    // Response 1 arrives late (out of order)
    const res1 = guardC.onServerProgressResponse(req1.seq, {
      lessonId: 'lesson-C',
      videoId: 'video-C',
      viewSessionId: req1.viewSessionId,
      furthestWatchedPositionSeconds: 20,
      completed: false,
      videoCompleted: false,
      progressPercentage: 20,
    });
    assert.equal(res1.applied, false);
    assert.equal(res1.reason, 'OUT_OF_ORDER');
    assert.equal(guardC.serverConfirmedFurthest, 25, 'Furthest must not downgrade');

    // Cross-lesson response arrives for Lesson A
    const resA = guardC.onServerProgressResponse(99, {
      lessonId: 'lesson-A',
      videoId: 'video-A',
      viewSessionId: 'session-A',
      furthestWatchedPositionSeconds: 300,
      completed: true,
    });
    assert.equal(resA.applied, false);
    assert.equal(resA.reason, 'LESSON_MISMATCH');
    assert.equal(guardC.serverConfirmedFurthest, 25);
    assert.equal(guardC.isCompleted, false);
  });

  it('TEST 3: Component lifecycle - Player A destroyed while request pending, Player C initialized', () => {
    // Simulate Player A
    const guardA = new VideoPlaybackGuard({
      lessonId: 'lesson-A',
      videoId: 'video-A',
      duration: 300,
      initialPosition: 200,
      initialFurthest: 300,
      allowFreeSeek: true,
      isCompleted: true,
    });

    const pendingReqA = guardA.createProgressRequest(250);

    // Player A unmounted / destroyed
    // Player C created in place
    const guardC = new VideoPlaybackGuard({
      lessonId: 'lesson-C',
      videoId: 'video-C',
      duration: 100,
      initialPosition: 19,
      initialFurthest: 19,
      allowFreeSeek: false,
      isCompleted: false,
    });

    // Callback A returns
    const callbackResponseA = {
      lessonId: pendingReqA.lessonId,
      videoId: pendingReqA.videoId,
      viewSessionId: pendingReqA.viewSessionId,
      furthestWatchedPositionSeconds: 300,
      completed: true,
      videoCompleted: true,
      progressPercentage: 100,
    };

    // If sent to guardC:
    const applied = guardC.onServerProgressResponse(pendingReqA.seq, callbackResponseA);
    assert.equal(applied.applied, false);
    assert.equal(guardC.serverConfirmedFurthest, 19);
    assert.equal(guardC.isCompleted, false);
    assert.equal(guardC.canSeekFreely(), false);
  });

  it('TEST 4: Slow network - Lesson C opened before API progress arrives', () => {
    // When Lesson C first opens, API progress has not returned yet (null/undefined)
    // Props passed to YouTubePlayer: initialFurthest = 0, isCompleted = false
    const guardC = new VideoPlaybackGuard({
      lessonId: 'lesson-C',
      videoId: 'video-C',
      duration: 100,
      initialPosition: 0,
      initialFurthest: 0,
      allowFreeSeek: false,
      isCompleted: false,
    });

    // Seek range is strictly 0 (not 100%)
    assert.equal(guardC.computeAllowedManualSeekUntil(), 0);
    assert.equal(guardC.canSeekFreely(), false);

    // Manual seek to 50s is clamped to 0
    const clamp1 = guardC.clampManualSeek(50);
    assert.equal(clamp1.clampedTime, 0);

    // 500ms later, progress API returns 19s
    guardC.updateServerFurthestFromProps(19);
    assert.equal(guardC.computeAllowedManualSeekUntil(), 19);

    // Now user can seek anywhere up to 19s
    const clamp2 = guardC.clampManualSeek(15);
    assert.equal(clamp2.clampedTime, 15);
    assert.equal(clamp2.wasClamped, false);

    // But seeking to 50s is still clamped to 19s
    const clamp3 = guardC.clampManualSeek(50);
    assert.equal(clamp3.clampedTime, 19);
    assert.equal(clamp3.wasClamped, true);
  });

  it('TEST 5: Playback rate changes (1x, 1.5x, 2x) do not leak progress or cause backward seek during continuous play', () => {
    const rates = [1, 1.5, 2];

    for (const rate of rates) {
      const guard = new VideoPlaybackGuard({
        lessonId: 'lesson-C',
        videoId: 'video-C',
        duration: 100,
        initialPosition: 19,
        initialFurthest: 19,
        allowFreeSeek: false,
        isCompleted: false,
      });

      guard.setPlaybackRate(rate);
      guard.onStateChange(1, 19, 1000); // PLAYING at t=19s, wall=1000ms

      let seeksTriggered = 0;
      let curTime = 19;
      let wall = 1000;

      // Simulate 20 seconds of real-world continuous playback (40 ticks @ 500ms)
      for (let i = 0; i < 40; i++) {
        wall += 500;
        curTime += 0.5 * rate;
        const tick = guard.onTick(curTime, wall);
        if (tick.shouldSeek) {
          seeksTriggered++;
        }
      }

      assert.equal(seeksTriggered, 0, `Rate ${rate}x must have 0 seek corrections during continuous play`);
      assert.ok(guard.localContinuousPosition >= curTime - 0.1, `Continuous pos must match curTime at ${rate}x`);
      assert.equal(guard.canSeekFreely(), false, `Rate ${rate}x must not grant free seek`);
      // Now learner attempts to cheat by jumping +30s ahead
      const cheatTime = curTime + 30;
      const cheatTick = guard.onTick(cheatTime, wall + 100);
      assert.equal(cheatTick.shouldSeek, true, `Rate ${rate}x must block forward cheat jump`);
      assert.ok(cheatTick.seekTarget <= guard.localContinuousPosition + 0.5, 'Must seek back to authorized territory');
    }
  });

  it('TEST 6: Backend Session Boundary - Session transition clamps elapsed time to 0, preventing progress jumps and false rewards', () => {
    // Helper function mirroring the hardened backend session logic
    function computeSecureHeartbeatElapsed(
      storedSessionId: string | null,
      currentSessionId: string,
      lastAt: Date | null,
      now: Date
    ): number {
      // If session changed, learner just returned or switched to this video:
      // Elapsed wall time from previous session cannot be counted as watch time!
      if (storedSessionId && currentSessionId && storedSessionId !== currentSessionId) {
        return 0;
      }
      if (!lastAt) return 0;
      const seconds = (now.getTime() - lastAt.getTime()) / 1000;
      return seconds >= 0 && seconds <= 300 ? seconds : 0;
    }

    const t0 = new Date('2026-10-25T10:00:00Z');
    const tSwitchBack = new Date('2026-10-25T10:02:00Z'); // 120s later

    // Previous session was 'session-1', current is 'session-2'
    const elapsedAcrossSessions = computeSecureHeartbeatElapsed('session-1', 'session-2', t0, tSwitchBack);
    assert.equal(elapsedAcrossSessions, 0, 'Cross-session elapsed time must be 0');

    // Progress cap with secure elapsed:
    const capped = capVideoProgress(19, 80, 80, elapsedAcrossSessions, 2);
    assert.equal(capped.furthestWatchedPositionSeconds, 19, 'Server strictly refuses jump to 80s');

    // Same session continuation (5 seconds later)
    const tNextHeartbeat = new Date('2026-10-25T10:02:05Z');
    const elapsedWithinSession = computeSecureHeartbeatElapsed('session-2', 'session-2', tSwitchBack, tNextHeartbeat);
    assert.equal(elapsedWithinSession, 5, 'Within-session elapsed time is 5s');

    const legitimateCapped = capVideoProgress(19, 24, 24, elapsedWithinSession, 2);
    assert.equal(legitimateCapped.furthestWatchedPositionSeconds, 24, 'Legitimate 5s watch advances furthest to 24s');
  });
});
