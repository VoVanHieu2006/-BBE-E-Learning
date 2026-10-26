import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VideoPlaybackGuard } from '../lib/video-playback-guard';
import { VideoProgressSession } from '../lib/video-progress-session';
import { capVideoProgress, hasCompletedVideoAtEnd } from '../lib/video-progress-rules';

const makeGuard = (session = 'session-a') => new VideoPlaybackGuard({
  lessonId: 'lesson-a', videoId: 'db-uuid', viewSessionId: session,
  duration: 713, initialPosition: 100, initialFurthest: 100,
});
const reply = (guard: VideoPlaybackGuard, position = 100) => ({
  ok: true, status: 200, data: {
    lessonId: guard.lessonId, videoId: guard.videoId, viewSessionId: guard.viewSessionId,
    furthestWatchedPositionSeconds: position,
  },
});
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

test('FB07 complete training never coalesces an unacknowledged monthly replay checkpoint', async () => {
  const guard = new VideoPlaybackGuard({ lessonId: 'lesson-a', videoId: 'db-uuid', duration: 862, initialFurthest: 862 });
  let release!: () => void;
  const sent: number[] = [];
  const session = new VideoProgressSession(guard, payload => {
    sent.push(payload.currentTime);
    const data = { ...reply(guard, 862).data, progressContext: { learningCycleId: 'cycle-a', competitionMonthId: 'month-a', monthlyReplayRequired: true }, replay: { learningCycleId: 'cycle-a', competitionMonthId: 'month-a', watchedSeconds: 100 } };
    if (sent.length === 1) return new Promise(resolve => { release = () => resolve({ ok: true, status: 200, data }); });
    return Promise.resolve({ ok: true, status: 200, data });
  }, () => true, () => {});
  try {
    const first = session.send(100, 862, 1, 'PLAY');
    const checkpoint = session.send(108, 862, 1, 'HEARTBEAT', true);
    const rewind = session.send(98, 862, 1, 'PLAY');
    release(); await Promise.all([first, checkpoint, rewind]);
    assert.deepEqual(sent, [100, 108, 98]);
  } finally { session.dispose(); }
});

test('FB07 failed in-flight checkpoint cannot authorize discarding queued playback proof', async () => {
  const guard = makeGuard();
  let release!: (value: any) => void;
  const sent: number[] = [];
  const session = new VideoProgressSession(guard, payload => {
    sent.push(payload.currentTime);
    return sent.length === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(reply(guard, 100));
  }, () => true, () => {});
  try {
    const requests = [session.send(108, 713, 1, 'HEARTBEAT', true), session.send(108, 713, 1, 'HEARTBEAT', true), session.send(98, 713, 2, 'PLAY')];
    release({ ok: false, status: 503 }); await Promise.all(requests);
    assert.deepEqual(sent, [108, 108, 98]);
  } finally { session.dispose(); }
});

test('FB07 completed cycle with fresh replay retains checkpoint 108 and advances 118/128/138', async () => {
  const guard = new VideoPlaybackGuard({ lessonId: 'lesson-a', videoId: 'db-uuid', duration: 862, initialFurthest: 862 });
  let replay = 100, now = 9000, lastAt = 1000;
  let release!: () => void;
  const session = new VideoProgressSession(guard, payload => new Promise(resolve => {
    const complete = () => {
      replay = capVideoProgress(replay, payload.currentTime, payload.furthest, (now - lastAt) / 1000, 1).furthestWatchedPositionSeconds;
      lastAt = now;
      resolve({ ok: true, status: 200, data: { ...reply(guard, 862).data, progressContext: { learningCycleId: 'cycle', competitionMonthId: 'month', monthlyReplayRequired: true }, replay: { learningCycleId: 'cycle', competitionMonthId: 'month', watchedSeconds: replay } } });
    };
    if (!release) release = complete; else complete();
  }), () => true, () => {});
  try {
    const first = session.send(108, 862, 1, 'HEARTBEAT', true);
    const rewind = session.send(98, 862, 1, 'PLAY');
    release(); await Promise.all([first, rewind]);
    assert.equal(replay, 108);
    for (const position of [118, 128, 138]) {
      now += 10000; await session.send(position, 862, 1);
      assert.equal(replay, position);
    }
  } finally { session.dispose(); }
});

for (const dimension of ['learningCycleId', 'competitionMonthId']) test(`FB07 ${dimension} change resets confirmed compaction floor`, async () => {
  const guard = makeGuard();
  let calls = 0, release!: () => void;
  const sent: number[] = [];
  const session = new VideoProgressSession(guard, payload => {
    calls++; sent.push(payload.currentTime);
    const identity = { learningCycleId: 'cycle-a', competitionMonthId: 'month-a', ...(calls > 1 ? { [dimension]: 'new' } : {}) };
    const data = { ...reply(guard, 713).data, progressContext: { ...identity, monthlyReplayRequired: true }, replay: { ...identity, watchedSeconds: calls === 1 ? 713 : 100 } };
    if (calls === 3) return new Promise(resolve => { release = () => resolve({ ok: true, status: 200, data }); });
    return Promise.resolve({ ok: true, status: 200, data });
  }, () => true, () => {});
  try {
    await session.send(713, 713, 1); await session.send(100, 713, 1, 'PLAY');
    const pending = [session.send(108, 713, 1, 'HEARTBEAT', true), session.send(108, 713, 1, 'HEARTBEAT', true), session.send(98, 713, 2, 'PLAY')];
    release(); await Promise.all(pending);
    assert.deepEqual(sent, [713, 100, 108, 108, 98]);
  } finally { session.dispose(); }
});

for (const rate of [1, 1.5, 2]) {
  test(`actual checkpoint plus unchanged server cap survives 100 seeks and three heartbeats at ${rate}x`, async () => {
    const guard = makeGuard();
    let now = 1000;
    let lastAt = now;
    let server = 100;
    const accepted: number[] = [];
    const session = new VideoProgressSession(guard, async payload => {
      server = capVideoProgress(server, payload.currentTime, payload.furthest, (now - lastAt) / 1000, payload.playbackRate).furthestWatchedPositionSeconds;
      lastAt = now;
      return reply(guard, server);
    }, () => true, data => accepted.push(data.furthestWatchedPositionSeconds));
    guard.setPlaybackRate(rate);
    guard.onStateChange(1, 100, now);
    for (let position = 100.5; position <= 108; position += .5) {
      now += 500 / rate;
      assert.equal(guard.onTick(position, now).shouldSeek, false);
    }
    // Capture the physical pre-seek position, not the local furthest at a rewound position.
    await session.send(108, 713, rate, 'HEARTBEAT', true);
    for (let i = 0; i < 100; i++) {
      const { clampedTime } = guard.clampManualSeek(i % 2 ? 108 : 98);
      now += 1;
      guard.onStateChange(3, clampedTime, now);
      guard.onStateChange(1, clampedTime, now);
      await session.send(clampedTime, 713, rate, 'PLAY');
    }
    for (let i = 1; i <= 3; i++) {
      now += 10000;
      await session.send(108 + i * 10 * rate, 713, rate);
      assert.equal(server, 108 + i * 10 * rate);
    }
    assert.equal(accepted.at(-1), server);
    assert.equal(hasCompletedVideoAtEnd(server, 713, 'ENDED'), false);
    session.dispose();
  });
}

test('serial transport retains unacknowledged heartbeats and seek/rate/state boundaries', async () => {
  const guard = new VideoPlaybackGuard({ lessonId: 'a', videoId: 'db-video', duration: 713 });
  const sent: number[] = [];
  let release!: (value: any) => void;
  const session = new VideoProgressSession(guard, async payload => {
    sent.push(payload.currentTime);
    if (sent.length === 1) return new Promise(resolve => { release = resolve; });
    return reply(guard, payload.currentTime);
  }, () => true, () => {});
  const first = session.send(1, 713, 1, 'PLAY');
  const ordinary1 = session.send(2, 713, 1);
  const ordinary2 = session.send(3, 713, 1);
  const boundary = session.send(4, 713, 1, 'HEARTBEAT', true);
  const ordinary3 = session.send(5, 713, 2);
  const ordinary4 = session.send(6, 713, 2);
  assert.deepEqual(sent, [1]);
  release(reply(guard, 1));
  await Promise.all([first, ordinary1, ordinary2, boundary, ordinary3, ordinary4]);
  assert.deepEqual(sent, [1, 2, 3, 4, 5, 6]);
  session.dispose();
});

test('100 rapid authorized seeks under latency do not consume the next three playback windows', async () => {
  const guard = makeGuard();
  let now = 9000;
  let lastAt = 1000;
  let server = 100;
  const releases: Array<() => void> = [];
  const sent: number[] = [];
  const session = new VideoProgressSession(guard, payload => new Promise(resolve => {
    sent.push(payload.currentTime);
    releases.push(() => {
      server = capVideoProgress(server, payload.currentTime, payload.furthest, (now - lastAt) / 1000, payload.playbackRate).furthestWatchedPositionSeconds;
      lastAt = now;
      resolve(reply(guard, server));
    });
  }), () => true, () => {});
  const requests = [session.send(108, 713, 1, 'HEARTBEAT', true)];
  try {
    for (let i = 0; i < 100; i++) {
      requests.push(session.send(i % 2 ? 108 : 98, 713, [1, 1.5, 2][i % 3], 'HEARTBEAT', true));
      requests.push(session.send(i % 2 ? 108 : 98, 713, [1, 1.5, 2][i % 3], 'PLAY'));
    }
    // Model one-second HTTP latency while the actual video continues from108.
    let nextHeartbeat = 19000;
    while (releases.length && now < 150000) {
      now += 1000;
      if (now >= nextHeartbeat) {
        requests.push(session.send(108 + (now - 9000) / 1000, 713, 1));
        nextHeartbeat += 10000;
      }
      releases.shift()!(); await flush();
    }
    for (let i = 0; i < 3; i++) {
      now += 10000;
      requests.push(session.send(108 + (now - 9000) / 1000, 713, 1));
      releases.shift()!(); await flush();
      assert.equal(server, 108 + (now - 9000) / 1000, 'new content must remain within the unchanged server cap');
    }
    await Promise.all(requests);
    assert.ok(sent.length < 10, 'redundant history markers must not create a seek-sized network backlog');
  } finally { session.dispose(); }
});

test('a newly confirmed checkpoint also collapses already queued PAUSE markers', async () => {
  const guard = makeGuard();
  const releases: Array<() => void> = [];
  let requests = 0;
  const session = new VideoProgressSession(guard, () => new Promise(resolve => {
    requests++;
    releases.push(() => resolve(reply(guard, 108)));
  }), () => true, () => {});
  try {
    const pending = [session.send(108, 713, 1, 'PAUSE')];
    for (let i = 0; i < 100; i++) pending.push(session.send(108, 713, 1, 'PAUSE'));
    while (releases.length) { releases.shift()!(); await flush(); }
    await Promise.all(pending);
    assert.equal(requests, 2, 'one physical checkpoint and one latest state marker suffice');
  } finally { session.dispose(); }
});

for (const failure of ['http', 'rejection', 'timeout', 'abort']) {
  test(`${failure}: pending request ends and subsequent session progress still works`, async () => {
    const oldWindow = (globalThis as any).window;
    (globalThis as any).window = { __bbeProbe: true };
    try {
      const guard = makeGuard();
      let count = 0;
      const session = new VideoProgressSession(guard, async () => {
        if (++count > 1) return reply(guard, 110);
        if (failure === 'http') return { ok: false, status: 503 };
        if (failure === 'rejection') throw new Error('test network rejection');
        if (failure === 'abort') throw new DOMException('test abort', 'AbortError');
        return new Promise(() => {});
      }, () => true, () => {}, 5);
      assert.equal(await session.send(108, 713, 1, 'PLAY'), null);
      assert.equal((await session.send(110, 713, 1, 'PLAY')).furthestWatchedPositionSeconds, 110);
      assert.equal(guard.logEntries.at(-1)?.pendingRequestsCount, 0);
      session.dispose();
    } finally { (globalThis as any).window = oldWindow; }
  });
}

for (const mismatch of ['lessonId', 'videoId', 'viewSessionId']) {
  test(`rejects ${mismatch} mismatch before invoking any UI/reward callback`, async () => {
    const guard = makeGuard();
    let updates = 0;
    const session = new VideoProgressSession(guard, async () => ({ ...reply(guard, 713), data: {
      ...reply(guard, 713).data, [mismatch]: 'another-identity', completed: true,
    } }), () => true, () => updates++);
    assert.equal(await session.send(713, 713, 1, 'ENDED'), null);
    assert.equal(updates, 0);
    assert.equal(guard.isCompleted, false);
    assert.equal(guard.serverConfirmedFurthest, 100);
    session.dispose();
  });
}

test('A to B to A cannot apply a response from the earlier A session', async () => {
  const old = makeGuard('old-a');
  const active = makeGuard('new-a');
  let resolveOld!: (value: any) => void;
  let updates = 0;
  const oldSession = new VideoProgressSession(old, () => new Promise(resolve => { resolveOld = resolve; }), () => false, () => updates++);
  const newSession = new VideoProgressSession(active, async () => reply(active, 110), () => true, () => updates++);
  const pending = oldSession.send(713, 713, 1, 'ENDED');
  await newSession.send(110, 713, 1, 'PLAY');
  resolveOld({ ...reply(old, 713), data: { ...reply(old, 713).data, completed: true } });
  assert.equal(await pending, null);
  assert.equal(updates, 1);
  assert.equal(active.serverConfirmedFurthest, 110);
  assert.equal(active.isCompleted, false);
  oldSession.dispose(); newSession.dispose();
});

test('a timed-out response arriving after a newer response cannot complete the active video', async () => {
  const guard = makeGuard();
  let release!: (value: any) => void;
  let count = 0;
  let updates = 0;
  const session = new VideoProgressSession(guard, () => {
    if (++count === 1) return new Promise(resolve => { release = resolve; });
    return Promise.resolve(reply(guard, 110));
  }, () => true, () => updates++, 5);
  try {
    assert.equal(await session.send(108, 713, 1, 'PLAY'), null);
    await session.send(110, 713, 1, 'PLAY');
    release({ ...reply(guard, 713), data: { ...reply(guard, 713).data, completed: true } });
    await flush();
    assert.equal(guard.serverConfirmedFurthest, 110);
    assert.equal(guard.isCompleted, false);
    assert.equal(updates, 1);
  } finally { session.dispose(); }
});

test('dispose aborts the in-flight request, resolves queued callers, and ignores late results', async () => {
  const guard = makeGuard();
  let signal!: AbortSignal;
  let release!: (value: any) => void;
  let updates = 0;
  const session = new VideoProgressSession(guard, (_, abortSignal) => {
    signal = abortSignal;
    return new Promise(resolve => { release = resolve; });
  }, () => true, () => updates++);
  const first = session.send(108, 713, 1, 'PLAY');
  const queued = session.send(98, 713, 1, 'PAUSE');
  session.dispose();
  assert.equal(signal.aborted, true);
  assert.deepEqual(await Promise.all([first, queued]), [null, null]);
  release(reply(guard, 713)); await flush();
  assert.equal(updates, 0);
  assert.equal(guard.serverConfirmedFurthest, 100);
});

test('probe playback logs remain bounded during seek stress', () => {
  const oldWindow = (globalThis as any).window;
  (globalThis as any).window = { __bbeProbe: true };
  try {
    const guard = new VideoPlaybackGuard({ lessonId: 'a', videoId: 'db-video', duration: 713 });
    for (let i = 0; i < 800; i++) guard.onStateChange(1, i);
    assert.ok(guard.logEntries.length <= 300, 'retain at most 300 probe events');
    assert.equal(guard.logEntries.at(-1)?.currentTime, 799);
  } finally { (globalThis as any).window = oldWindow; }
});
