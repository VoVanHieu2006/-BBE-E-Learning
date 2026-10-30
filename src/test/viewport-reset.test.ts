import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetViewportZoom, watchViewportReset } from '../lib/viewport-reset';

const ORIGINAL = 'width=device-width, initial-scale=1, viewport-fit=cover';

function createWindow(vv: { scale: number; offsetLeft: number; offsetTop: number } | null) {
  const attrs: Record<string, string> = { content: ORIGINAL };
  const history: string[] = [];
  const meta = {
    getAttribute: (name: string) => attrs[name] ?? null,
    setAttribute: (name: string, value: string) => { attrs[name] = value; if (name === 'content') history.push(value); },
  };
  const listeners = new Map<string, Set<() => void>>();
  const vvListeners = new Map<string, Set<() => void>>();
  const timers = new Map<number, () => void>();
  const frames: Array<() => void> = [];
  let nextTimer = 1;
  let scrolls = 0;
  const addTo = (map: Map<string, Set<() => void>>) => (type: string, fn: () => void) => {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type)!.add(fn);
  };
  const removeFrom = (map: Map<string, Set<() => void>>) => (type: string, fn: () => void) => map.get(type)?.delete(fn);
  const win = {
    document: { querySelector: () => meta },
    visualViewport: vv && { ...vv, addEventListener: addTo(vvListeners), removeEventListener: removeFrom(vvListeners) },
    addEventListener: addTo(listeners),
    removeEventListener: removeFrom(listeners),
    requestAnimationFrame: (fn: () => void) => { frames.push(fn); return frames.length; },
    setTimeout: (fn: () => void) => { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    scrollTo: () => { scrolls++; },
  };
  return {
    win: win as unknown as Window,
    attrs,
    history,
    listeners,
    vvListeners,
    timers,
    get scrolls() { return scrolls; },
    runFrames() { while (frames.length) frames.shift()!(); },
    fire(type: string) { listeners.get(type)?.forEach(fn => fn()); },
    fireVisualViewport(type: string) { vvListeners.get(type)?.forEach(fn => fn()); },
    flushTimers() { const pending = Array.from(timers.values()); timers.clear(); pending.forEach(fn => fn()); },
  };
}

describe('resetViewportZoom', () => {
  test('does nothing when the page is not zoomed', () => {
    const env = createWindow({ scale: 1, offsetLeft: 0, offsetTop: 0 });
    assert.equal(resetViewportZoom(env.win), false);
    assert.deepEqual(env.history, []);
    assert.equal(env.scrolls, 0);
  });

  test('does nothing without visualViewport support', () => {
    const env = createWindow(null);
    assert.equal(resetViewportZoom(env.win), false);
  });

  test('pins maximum-scale=1 then restores the original viewport content', () => {
    const env = createWindow({ scale: 2.4, offsetLeft: 0, offsetTop: 0 });
    assert.equal(resetViewportZoom(env.win), true);
    assert.match(env.attrs.content, /maximum-scale=1$/);
    assert.equal(env.scrolls, 1);
    env.runFrames();
    assert.equal(env.attrs.content, ORIGINAL);
  });

  test('also recovers a shifted visual viewport at scale 1', () => {
    const env = createWindow({ scale: 1, offsetLeft: 40, offsetTop: 0 });
    assert.equal(resetViewportZoom(env.win), true);
  });
});

describe('watchViewportReset', () => {
  test('resets after rotation once the debounce fires', () => {
    const env = createWindow({ scale: 2, offsetLeft: 0, offsetTop: 0 });
    watchViewportReset(env.win);
    env.fire('orientationchange');
    assert.deepEqual(env.history, []);
    env.flushTimers();
    assert.ok(env.history.length >= 1);
    env.runFrames();
    assert.equal(env.attrs.content, ORIGINAL);
  });

  test('listens to resize and visualViewport resize', () => {
    const env = createWindow({ scale: 2, offsetLeft: 0, offsetTop: 0 });
    watchViewportReset(env.win);
    env.fire('resize');
    assert.equal(env.timers.size, 2);
    env.flushTimers();
    env.fireVisualViewport('resize');
    assert.equal(env.timers.size, 2);
  });

  test('stop removes every listener and pending timer', () => {
    const env = createWindow({ scale: 2, offsetLeft: 0, offsetTop: 0 });
    const stop = watchViewportReset(env.win);
    env.fire('orientationchange');
    stop();
    assert.equal(env.timers.size, 0);
    env.listeners.forEach(set => assert.equal(set.size, 0));
    env.vvListeners.forEach(set => assert.equal(set.size, 0));
  });
});
