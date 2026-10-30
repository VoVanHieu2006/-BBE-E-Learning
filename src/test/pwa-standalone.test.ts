import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStandaloneMode, isStandaloneMode } from '../lib/pwa';

describe('computeStandaloneMode', () => {
  test('accepts the legacy iOS navigator.standalone flag', () => {
    assert.equal(computeStandaloneMode({ navigatorStandalone: true }), true);
  });

  test('accepts display-mode: standalone', () => {
    assert.equal(computeStandaloneMode({ displayStandalone: true }), true);
  });

  test('accepts display-mode: fullscreen', () => {
    assert.equal(computeStandaloneMode({ displayFullscreen: true }), true);
  });

  test('stays false in a regular browser tab', () => {
    assert.equal(computeStandaloneMode({}), false);
    assert.equal(
      computeStandaloneMode({
        navigatorStandalone: false,
        displayStandalone: false,
        displayFullscreen: false,
      }),
      false
    );
  });
});

describe('isStandaloneMode', () => {
  const g = globalThis as { window?: unknown };

  function withWindow(fake: unknown, run: () => void) {
    g.window = fake;
    try {
      run();
    } finally {
      delete g.window;
    }
  }

  function fakeWindow(opts: { standalone?: unknown; modes?: string[]; noMatchMedia?: boolean }) {
    const modes = opts.modes ?? [];
    return {
      navigator: { standalone: opts.standalone },
      ...(opts.noMatchMedia
        ? {}
        : { matchMedia: (q: string) => ({ matches: modes.some(m => q === `(display-mode: ${m})`) }) }),
    };
  }

  test('is SSR-safe outside a browser window', () => {
    assert.equal(typeof window, 'undefined');
    assert.equal(isStandaloneMode(), false);
  });

  test('detects iOS navigator.standalone === true', () => {
    withWindow(fakeWindow({ standalone: true }), () => assert.equal(isStandaloneMode(), true));
  });

  test('ignores a truthy but non-boolean navigator.standalone', () => {
    withWindow(fakeWindow({ standalone: 'true' }), () => assert.equal(isStandaloneMode(), false));
  });

  test('detects display-mode: standalone via matchMedia', () => {
    withWindow(fakeWindow({ standalone: false, modes: ['standalone'] }), () => assert.equal(isStandaloneMode(), true));
  });

  test('detects display-mode: fullscreen via matchMedia', () => {
    withWindow(fakeWindow({ modes: ['fullscreen'] }), () => assert.equal(isStandaloneMode(), true));
  });

  test('stays false in a regular browser tab', () => {
    withWindow(fakeWindow({ standalone: false, modes: ['browser'] }), () => assert.equal(isStandaloneMode(), false));
  });

  test('does not throw when matchMedia is unavailable', () => {
    withWindow(fakeWindow({ noMatchMedia: true }), () => assert.equal(isStandaloneMode(), false));
    withWindow(fakeWindow({ standalone: true, noMatchMedia: true }), () => assert.equal(isStandaloneMode(), true));
  });
});
