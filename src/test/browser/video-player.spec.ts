import { expect, test, type Page } from '@playwright/test';
import { capVideoProgress } from '../../lib/video-progress-rules';

// Test the actual React component and CSS; only the external YouTube API is mocked.
async function setup(page: Page, options: { theater?: boolean; noPopover?: boolean; reject?: boolean; url?: string; duration?: number } = {}) {
  await page.addInitScript(options => {
    const win = window as any;
    if (options.theater) {
      Object.defineProperty(document, 'fullscreenEnabled', { value: false, configurable: true });
    }
    if (options.reject) {
      Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
      HTMLElement.prototype.requestFullscreen = () => Promise.reject(new Error('Test: permission denied'));
    }
    if (options.noPopover) (HTMLElement.prototype as any).showPopover = undefined;
    win.__playerMock = { creates: 0, destroys: 0, frameLoads: 0, seeks: [], rates: [], current: null };
    win.YT = {
      Player: class {
        time = 120;
        rate = 1;
        state = 2;
        frame: HTMLIFrameElement;
        constructor(element: HTMLElement, private options: any) {
          win.__playerMock.creates++;
          win.__playerMock.current = this;
          this.frame = document.createElement('iframe');
          this.frame.title = 'YouTube API mock for UI regression';
          this.frame.style.cssText = 'width:100%;height:100%;border:0;display:block';
          this.frame.srcdoc = '<body style="margin:0;background:#101b32;color:white;display:grid;place-items:center;height:100vh;font:16px sans-serif"><div style="text-align:center">YouTube API mock<br><small>UI regression — no real media</small></div></body>';
          this.frame.onload = () => win.__playerMock.frameLoads++;
          element.replaceWith(this.frame);
          setTimeout(() => options.events.onReady({ target: this }), 0);
        }
        emit(state: number) { this.state = state; this.options.events.onStateChange({ data: state, target: this }); }
        playVideo() { this.emit(1); }
        pauseVideo() { this.emit(2); }
        stopVideo() { this.state = 2; }
        seekTo(time: number) {
          this.time = time;
          win.__playerMock.seeks.push(time);
          if (this.state === 1 || this.state === 3) {
            this.emit(3);
            setTimeout(() => this.emit(1), 40);
          }
        }
        setPlaybackRate(rate: number) { this.rate = rate; win.__playerMock.rates.push(rate); }
        getPlaybackRate() { return this.rate; }
        getCurrentTime() { return this.time; }
        getDuration() { return options.duration || 596; }
        getPlayerState() { return this.state; }
        unloadModule() {}
        destroy() { win.__playerMock.destroys++; this.frame.remove(); }
      },
    };
  }, options);
  await page.goto(options.url || '/lessons/player-ui-regression');
  await expect(page.locator('[data-video-controls]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__playerMock.frameLoads)).toBeGreaterThan(0);
  await page.clock.install();
}

const wrapper = (page: Page) => page.locator('[data-video-player]');
const bar = (page: Page) => page.locator('[data-video-controls]');
const play = (page: Page) => bar(page).locator('button').first();
const fullscreen = (page: Page) => bar(page).locator('button').last();

for (const rate of [1, 1.5, 2]) {
  test(`P0: preserves pre-seek playback and three new-content heartbeats after 100 DOM seeks at ${rate}x`, async ({ page, isMobile }) => {
    test.setTimeout(120000);
    let furthest = 100;
    let lastAt = 0;
    const events: any[] = [];
    await page.addInitScript(() => {
      const originalFetch = window.fetch;
      window.fetch = (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('x-synthetic-sent-at', String(Date.now()));
        return originalFetch(input, { ...init, headers });
      };
    });
    await page.route('**/api/v1/lessons/player-ui-regression/progress', async route => {
      const data = route.request().postDataJSON();
      const now = Number(route.request().headers()['x-synthetic-sent-at']);
      const elapsed = lastAt ? Math.min(30, Math.max(0, (now - lastAt) / 1000)) : 0;
      furthest = capVideoProgress(furthest, data.positionSeconds, data.furthestWatchedPositionSeconds, elapsed, data.playbackRate).furthestWatchedPositionSeconds;
      lastAt = now;
      events.push({ ...data, accepted: furthest });
      await route.fulfill({ json: { lessonId: 'player-ui-regression', viewSessionId: data.viewSessionId, furthestWatchedPositionSeconds: furthest } });
    });
    await setup(page);
    await page.locator('input').first().fill('synthetic-ui-token');
    await page.locator('input').nth(1).fill('p0-test-video');
    await page.clock.runFor(100);
    await page.evaluate(() => { (window as any).__playerMock.current.time = 100; });
    if (rate !== 1) {
      if (isMobile) {
        for (let i = 0; i < (rate === 1.5 ? 2 : 4); i++) await bar(page).locator('button[title^="Đổi tốc độ"]').click();
      } else await bar(page).getByRole('button', { name: `${rate}x`, exact: true }).click();
    }
    await start(page);
    await expect.poll(() => events.length).toBeGreaterThan(0);
    const frame = await wrapper(page).locator('iframe').elementHandle();
    const advance = async (to: number) => {
      for (let ticks = 0; ticks < 200 && await page.evaluate(() => (window as any).__playerMock.current.time) < to; ticks++) {
        await page.evaluate(({ to, rate }) => {
          const player = (window as any).__playerMock.current;
          player.time += Math.min(.5 * rate, to - player.time);
        }, { to, rate });
        await page.clock.runFor(500);
      }
      expect(await page.evaluate(() => (window as any).__playerMock.current.time)).toBeGreaterThanOrEqual(to);
    };
    await advance(108);
    for (let i = 0; i < 100; i++) {
      await reveal(page);
      if (i % 3 === 0) {
        const forward = bar(page).locator('button').nth(2);
        await (await forward.isEnabled() ? forward : bar(page).locator('button').nth(1)).click();
      }
      else if (i % 3 === 1) await page.keyboard.press(i % 2 ? 'ArrowRight' : 'ArrowLeft');
      else {
        const box = (await page.locator('[data-video-timeline]').boundingBox())!;
        await page.mouse.move(box.x + box.width * .15, box.y + 5);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * (108 / 596), box.y + 5, { steps: 5 });
        await page.mouse.up();
      }
      await page.clock.runFor(50);
      if (i === 0) await expect.poll(() => events.some(e => e.positionSeconds === 108 && e.accepted >= 108)).toBe(true);
    }
    expect(events.some(e => e.positionSeconds === 108 && e.accepted >= 108)).toBe(true);
    // Return to the watched boundary through the actual timeline.
    await reveal(page);
    const box = (await page.locator('[data-video-timeline]').boundingBox())!;
    await page.locator('[data-video-timeline]').click({ position: { x: box.width * (108 / 596), y: 5 } });
    await page.clock.runFor(50);
    const before = events.length;
    await advance(108 + 30 * rate);
    const freshHeartbeats = () => events.slice(before).filter(e => e.event === 'HEARTBEAT' && e.positionSeconds > 108.01);
    await expect.poll(() => freshHeartbeats().length).toBeGreaterThanOrEqual(3);
    const fresh = freshHeartbeats();
    expect(fresh.every(e => e.accepted >= e.positionSeconds - .01)).toBe(true);
    for (let i = 1; i < fresh.length; i++) expect(fresh[i].accepted).toBeGreaterThan(fresh[i - 1].accepted);
    console.log('P0 synthetic acceptance', { rate, seeks: 100, furthest, newContentHeartbeats: fresh.length });
    expect(await frame!.evaluate(el => el === document.querySelector('[data-video-player] iframe'))).toBe(true);
  });
}

test('P0: duplicate PLAYING events do not enqueue requests or postpone heartbeat', async ({ page }) => {
  const events: any[] = [];
  await page.route('**/api/v1/lessons/player-ui-regression/progress', async route => {
    events.push(route.request().postDataJSON());
    await route.fulfill({ json: { furthestWatchedPositionSeconds: 100 } });
  });
  await setup(page);
  await page.locator('input').first().fill('synthetic-ui-token');
  await page.locator('input').nth(1).fill('p0-playing-test');
  await page.clock.runFor(100);
  await page.evaluate(() => { (window as any).__playerMock.current.time = 100; });
  await start(page);
  await expect.poll(() => events.length).toBeGreaterThan(0);
  const playsBefore = events.filter(e => e.event === 'PLAY').length;
  for (let i = 0; i < 24; i++) {
    await page.evaluate(() => (window as any).__playerMock.current.emit(1));
    await page.clock.runFor(500);
  }
  await expect.poll(() => events.filter(e => e.event === 'HEARTBEAT').length).toBeGreaterThanOrEqual(1);
  expect(events.filter(e => e.event === 'PLAY').length - playsBefore).toBe(0);
});

test('P0: switching during ENDED retry delay never sends old completion into new session', async ({ page }) => {
  const ended: any[] = [];
  await page.route('**/api/v1/lessons/player-ui-regression/progress', async route => {
    const payload = route.request().postDataJSON();
    if (payload.event === 'ENDED') ended.push(payload);
    await route.fulfill({ json: { furthestWatchedPositionSeconds: 100, completed: false } });
  });
  await setup(page);
  await page.locator('input').first().fill('synthetic-ui-token');
  await page.locator('input').nth(1).fill('p0-ended-a');
  await page.clock.runFor(100);
  await start(page);
  await page.evaluate(() => (window as any).__playerMock.current.emit(0));
  await expect.poll(() => ended.length).toBe(1);
  await page.waitForTimeout(100);
  await page.clock.runFor(100);
  await page.locator('input').nth(1).fill('p0-ended-b');
  await page.clock.runFor(2500);
  await page.waitForTimeout(100);
  expect(ended).toHaveLength(1);
});

test('P0: MEMBER page uses DB video identity, rejects wrong-video completion, and restores synthetic progress on refresh', async ({ page }) => {
  let watched = 100;
  let patches = 0;
  await page.addInitScript(() => {
    localStorage.setItem('accessToken', 'synthetic-member-token');
    localStorage.setItem('user', JSON.stringify({ id: 'synthetic-member', role: 'MEMBER', display_name: 'Synthetic member' }));
  });
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    const progress = {
      lessonId: 'p0-member', videoId: 'db-video-uuid', completed: false, videoCompleted: false,
      watchedUntil: watched, furthestWatchedPositionSeconds: watched, lastPosition: watched,
      progressPercentage: watched / 713 * 100,
      lifetime: { completed: false, furthestWatchedPositionSeconds: watched },
    };
    if (url.pathname === '/api/v1/lessons/p0-member/progress') {
      if (route.request().method() === 'PATCH') {
        const payload = route.request().postDataJSON();
        patches++;
        if (patches === 1) return route.fulfill({ json: { ...progress, videoId: 'wrong-db-video', viewSessionId: payload.viewSessionId, completed: true, videoCompleted: true, furthestWatchedPositionSeconds: 713, progressPercentage: 100, lifetime: { completed: true, furthestWatchedPositionSeconds: 713 } } });
        watched = payload.positionSeconds;
        return route.fulfill({ json: { ...progress, watchedUntil: watched, furthestWatchedPositionSeconds: watched, lastPositionSeconds: watched, viewSessionId: payload.viewSessionId, lifetime: { completed: false, furthestWatchedPositionSeconds: watched } } });
      }
      return route.fulfill({ json: progress });
    }
    if (url.pathname === '/api/v1/lessons/p0-member') return route.fulfill({ json: {
      id: 'p0-member', title: 'Synthetic lesson', description: '',
      session: { courseId: 'p0-course', title: 'Synthetic session' },
      video: { id: 'db-video-uuid', videoId: 'db-video-uuid', youtubeVideoId: 'different-youtube-id', durationSeconds: 713 }, documents: [],
    } });
    if (url.pathname === '/api/v1/courses/p0-course') return route.fulfill({ json: {
      id: 'p0-course', title: 'Synthetic course', sessions: [{ id: 'p0-session', title: 'Synthetic session', lessons: [{ id: 'p0-member', title: 'Synthetic lesson' }] }],
    } });
    return route.fulfill({ json: { items: [], sessions: [], user: { id: 'synthetic-member', role: 'MEMBER' }, balance: 0 } });
  });
  await setup(page, { url: '/student/learning/p0-member', duration: 713 });
  await start(page);
  await expect.poll(() => patches).toBe(1);
  await expect(page.getByText(/100\/713s/)).toBeVisible();
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => { (window as any).__playerMock.current.time += .5; });
    await page.clock.runFor(500);
  }
  await expect(page.getByText(/110\/713s/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/110\/713s/)).toBeVisible();
});
async function reveal(page: Page) {
  const rect = (await wrapper(page).boundingBox())!;
  await page.mouse.move(rect.x + rect.width * .5, rect.y + rect.height * .5);
  await page.mouse.move(rect.x + rect.width * .5 + 20, rect.y + rect.height * .5);
  await expect(bar(page)).toHaveCSS('opacity', '1');
}
async function hiddenAfterIdle(page: Page) {
  await page.clock.fastForward(2800);
  await expect(bar(page)).toHaveClass(/opacity-0/);
  await expect(bar(page)).toHaveCSS('opacity', '0');
  await expect(bar(page)).toHaveCSS('pointer-events', 'none');
}
async function start(page: Page) {
  await play(page).click();
  await expect.poll(() => page.evaluate(() => (window as any).__playerMock.current.state)).toBe(1);
}
async function viewportFilled(page: Page) {
  await expect(wrapper(page)).toHaveClass(/bbe-player-fullscreen/);
  await expect.poll(() => wrapper(page).evaluate(el => {
    const rect = el.getBoundingClientRect();
    return Math.max(Math.abs(rect.x), Math.abs(rect.y), Math.abs(rect.width - innerWidth), Math.abs(rect.height - innerHeight));
  })).toBeLessThan(2);
}

test('Play/Pause/Play and stationary pointer over each button auto-hide', async ({ page, isMobile }) => {
  await setup(page);
  await start(page);
  await hiddenAfterIdle(page);
  await reveal(page);
  await play(page).click();
  await page.clock.fastForward(10000);
  await expect(bar(page)).toHaveClass(/opacity-100/);
  await play(page).click();
  await hiddenAfterIdle(page);
  for (const index of [1, 2]) {
    await reveal(page);
    await bar(page).locator('button').nth(index).click();
    await hiddenAfterIdle(page);
  }
  const rates = isMobile ? [null, null, null, null, null] : ['1x', '1.25x', '1.5x', '1.75x', '2x'];
  for (const rate of rates) {
    await reveal(page);
    if (rate) await bar(page).getByRole('button', { name: rate, exact: true }).click();
    else await bar(page).locator('button[title^="Đổi tốc độ"]').click();
    await hiddenAfterIdle(page);
  }
});

test('50 speed changes and 50 alternating seeks, including buffering, do not stick', async ({ page, isMobile }) => {
  test.setTimeout(120000);
  await setup(page);
  await start(page);
  for (let i = 0; i < 50; i++) {
    if (isMobile) await bar(page).locator('button[title^="Đổi tốc độ"]').click();
    else await bar(page).getByRole('button', { name: ['1x', '1.25x', '1.5x', '1.75x', '2x'][i % 5], exact: true }).click();
    await page.clock.fastForward(50);
  }
  await hiddenAfterIdle(page);
  await reveal(page);
  for (let i = 0; i < 50; i++) {
    await bar(page).locator('button').nth(i % 2 ? 2 : 1).click();
    await page.clock.fastForward(50);
  }
  await hiddenAfterIdle(page);
  await expect.poll(() => page.evaluate(() => (window as any).__playerMock.rates.length)).toBe(50);
  await expect.poll(() => page.evaluate(() => (window as any).__playerMock.seeks.length)).toBe(50);
});

test('seek click, drag inside, and pointerup outside with failed capture resume auto-hide', async ({ page }) => {
  await setup(page);
  await start(page);
  const timeline = page.locator('[data-video-timeline]');
  await timeline.click({ position: { x: 50, y: 10 } });
  await hiddenAfterIdle(page);
  await reveal(page);
  let rect = (await timeline.boundingBox())!;
  await page.mouse.move(rect.x + 30, rect.y + 10);
  await page.mouse.down();
  await page.clock.fastForward(10000);
  await expect(bar(page)).toHaveClass(/opacity-100/);
  await page.mouse.move(rect.x + 100, rect.y + 10);
  await page.mouse.up();
  await hiddenAfterIdle(page);
  await reveal(page);
  await timeline.evaluate(el => { el.setPointerCapture = () => { throw new Error('Capture unavailable'); }; });
  rect = (await timeline.boundingBox())!;
  await page.mouse.move(rect.x + 30, rect.y + 10);
  await page.mouse.down();
  await page.mouse.move(1, 1);
  await page.clock.fastForward(10000);
  await expect(bar(page)).toHaveClass(/opacity-100/);
  await page.mouse.up();
  await page.clock.fastForward(400);
  await expect(bar(page)).toHaveClass(/opacity-0/);
});

test('pointercancel and lostpointercapture release the actual React drag handlers', async ({ page }) => {
  await setup(page);
  await start(page);
  for (const event of ['pointercancel', 'lostpointercapture']) {
    await reveal(page);
    const timeline = page.locator('[data-video-timeline]');
    await timeline.dispatchEvent('pointerdown', { pointerId: 8, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 400 });
    await page.clock.fastForward(10000);
    await expect(bar(page)).toHaveClass(/opacity-100/);
    await timeline.dispatchEvent(event, { pointerId: 8, pointerType: 'touch', clientX: 100, clientY: 400 });
    await hiddenAfterIdle(page);
  }
});

test('Tab preserves controls and DOM focus; clicking with mouse resumes hiding', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Keyboard navigation verified on desktop browser engines.');
  await setup(page);
  await start(page);
  await page.keyboard.press('Tab');
  await expect(bar(page).locator('button').nth(1)).toBeFocused();
  await page.mouse.move(1, 1);
  await page.clock.fastForward(10000);
  await expect(bar(page)).toHaveClass(/opacity-100/);
  await expect(bar(page).locator('button').nth(1)).toBeFocused();
  await bar(page).getByRole('button', { name: '1.5x', exact: true }).click();
  await page.evaluate(() => { (window as any).__focusAfterClick = document.activeElement; });
  await hiddenAfterIdle(page);
  // Safari does not focus buttons on a mouse click. Preserve each engine's own focus.
  expect(await page.evaluate(() => document.activeElement === (window as any).__focusAfterClick)).toBe(true);
});

test('touch tap and generated click change rate once and auto-hide', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Requires touch-enabled browser context.');
  await setup(page);
  await start(page);
  await bar(page).locator('button[title^="Đổi tốc độ"]').tap();
  await expect.poll(() => page.evaluate(() => (window as any).__playerMock.rates)).toEqual([1.25]);
  await hiddenAfterIdle(page);
});

test('leaving during seek buffering and window blur cannot revive controls', async ({ page }) => {
  await setup(page);
  await start(page);
  await bar(page).locator('button').nth(1).click();
  await page.mouse.move(1, 1);
  await page.clock.fastForward(400);
  await expect(bar(page)).toHaveCSS('opacity', '0');
  // Repeated PLAYING events after a seek must not reveal the bar outside the player.
  await page.evaluate(() => (window as any).__playerMock.current.emit(1));
  await page.clock.fastForward(400);
  await expect(bar(page)).toHaveCSS('opacity', '0');
  await reveal(page);
  const timeline = page.locator('[data-video-timeline]');
  await timeline.dispatchEvent('pointerdown', { pointerId: 42, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 100, clientY: 400 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.clock.fastForward(10000);
  await expect(bar(page)).toHaveCSS('opacity', '0');
});

test('touch seek ends outside and compatibility click does not seek a second time', async ({ page }) => {
  await setup(page);
  await start(page);
  const timeline = page.locator('[data-video-timeline]');
  const rect = (await timeline.boundingBox())!;
  await timeline.dispatchEvent('pointerdown', { pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: rect.x + 30, clientY: rect.y + 10 });
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, pointerType: 'touch', clientX: 1, clientY: 1 })));
  const seeks = await page.evaluate(() => (window as any).__playerMock.seeks.length);
  await timeline.dispatchEvent('click', { clientX: rect.x + 30 });
  expect(await page.evaluate(() => (window as any).__playerMock.seeks.length)).toBe(seeks);
  await hiddenAfterIdle(page);
});

for (const legacy of [false, true]) {
  test(`theater escapes clipped/transformed ancestors, preserves iframe, rotates and exits (${legacy ? 'legacy CSS' : 'top layer'})`, async ({ page }, testInfo) => {
    await setup(page, { theater: true, noPopover: legacy });
    await start(page);
    await wrapper(page).evaluate(el => {
      const parent = el.parentElement!;
      parent.style.cssText += ';transform:translateZ(0);filter:opacity(1);overflow:hidden;max-width:500px;position:relative;z-index:1';
      (window as any).__originalFrame = el.querySelector('iframe');
      (window as any).__beforeFullscreen = { ...((window as any).__playerMock), state: history.state };
    });
    await fullscreen(page).click();
    await viewportFilled(page);
    await expect(wrapper(page)).toHaveAttribute('data-fullscreen-mode', 'THEATER');
    await expect(page.getByRole('status').filter({ hasText: 'Xem rộng trong trình duyệt' })).toBeVisible();
    expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await expect.poll(() => page.evaluate(() => history.state?.bbeTheater)).toBeTruthy();
    if (!legacy) await expect(wrapper(page)).toHaveJSProperty('popover', 'manual');
    await hiddenAfterIdle(page);
    await page.screenshot({ path: `scratch/player-${testInfo.project.name}-${legacy ? 'legacy' : 'theater'}-hidden.png` });
    const portrait = page.viewportSize()!;
    await page.setViewportSize({ width: Math.max(portrait.width, portrait.height), height: Math.min(portrait.width, portrait.height) });
    await viewportFilled(page);
    await expect(page.getByRole('button', { name: /Thu nhỏ/, exact: false }).first()).toBeVisible();
    await wrapper(page).locator(':scope > button').click();
    await expect(wrapper(page)).not.toHaveClass(/bbe-player-fullscreen/);
    await expect.poll(() => page.evaluate(() => history.state?.bbeTheater ?? null)).toBeNull();
    await expect(page.locator('.bbe-fullscreen-locked')).toHaveCount(0);
    await expect(page.locator('.bbe-theater-ancestor')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => {
      const win = window as any;
      return { sameFrame: document.querySelector('[data-video-player] iframe') === win.__originalFrame, creates: win.__playerMock.creates === win.__beforeFullscreen.creates, loads: win.__playerMock.frameLoads === win.__beforeFullscreen.frameLoads, time: win.__playerMock.current.time };
    })).toEqual({ sameFrame: true, creates: true, loads: true, time: 120 });
    await hiddenAfterIdle(page);
  });
}

test('installed standalone mode hides the browser-only theater notice', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { get: () => true, configurable: true });
  });
  await setup(page, { theater: true });
  await fullscreen(page).click();
  await viewportFilled(page);
  await expect(wrapper(page)).toHaveAttribute('data-fullscreen-mode', 'THEATER');
  await expect(page.getByRole('status').filter({ hasText: 'Xem rộng trong trình duyệt' })).toHaveCount(0);
});

test('native rejection falls back once; repeated theater exit/Back preserves Next history state', async ({ page }) => {
  await setup(page, { reject: true });
  await start(page);
  const originalState = await page.evaluate(() => history.state);
  const url = page.url();
  for (let i = 0; i < 4; i++) {
    await reveal(page);
    await fullscreen(page).click();
    await viewportFilled(page);
    expect(await page.evaluate(() => { const { bbeTheater, ...state } = history.state; return state; })).toEqual(originalState);
    if (i % 2) await page.goBack();
    else await wrapper(page).locator(':scope > button').click();
    await expect(wrapper(page)).not.toHaveClass(/bbe-player-fullscreen/);
    await expect.poll(() => page.evaluate(() => history.state?.bbeTheater ?? null)).toBeNull();
    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => history.state)).toEqual(originalState);
  }
  await expect(page.locator('.bbe-fullscreen-locked')).toHaveCount(0);
});

test('video switch during theater releases presentation and old timer', async ({ page }) => {
  await setup(page, { theater: true });
  await start(page);
  await fullscreen(page).click();
  await viewportFilled(page);
  // Change through the existing video ID input, as a same-page lesson replacement would.
  await page.locator('input').nth(1).evaluate((el: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, 'aqz-KE-bpKQ');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(wrapper(page)).not.toHaveClass(/bbe-player-fullscreen/);
  await expect(page.locator('.bbe-fullscreen-locked')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => history.state?.bbeTheater ?? null)).toBeNull();
  await page.clock.fastForward(10000);
  await expect(bar(page)).toHaveClass(/opacity-100/);
});

test('fullscreenerror plus rejected promise enters theater once, pagehide removes locks and marker', async ({ page }) => {
  await setup(page);
  await start(page);
  const before = await page.evaluate(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    HTMLElement.prototype.requestFullscreen = function () {
      this.dispatchEvent(new Event('fullscreenerror', { bubbles: true }));
      return Promise.reject(new Error('Test: error event plus promise rejection'));
    };
    return { length: history.length, state: history.state };
  });
  await fullscreen(page).click();
  await viewportFilled(page);
  expect(await page.evaluate(() => history.length)).toBe(before.length + 1);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.locator('.bbe-fullscreen-locked')).toHaveCount(0);
  await expect(wrapper(page)).not.toHaveClass(/bbe-player-fullscreen/);
  expect(await page.evaluate(() => history.state)).toEqual(before.state);
});

test('pending native request rejected after video switch cannot reopen theater', async ({ page }) => {
  await setup(page);
  await start(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    HTMLElement.prototype.requestFullscreen = () => new Promise((_resolve, reject) => { (window as any).__rejectFullscreen = reject; });
  });
  await fullscreen(page).click();
  await page.locator('input').nth(1).fill('aqz-KE-bpKQ');
  await page.evaluate(() => (window as any).__rejectFullscreen(new Error('Late failure')));
  await page.clock.fastForward(10000);
  await expect(wrapper(page)).not.toHaveClass(/bbe-player-fullscreen/);
  await expect(page.locator('.bbe-fullscreen-locked')).toHaveCount(0);
  expect(await page.evaluate(() => history.state?.bbeTheater ?? null)).toBeNull();
});

test('late native success after video switch is exited without reopening presentation', async ({ page }) => {
  await setup(page);
  await start(page);
  await page.evaluate(() => {
    const win = window as any;
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    Object.defineProperty(document, 'fullscreenElement', { get: () => win.__nativeElement ?? null, configurable: true });
    document.exitFullscreen = async () => {
      win.__nativeElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
    };
    HTMLElement.prototype.requestFullscreen = function () {
      const element = this;
      return new Promise<void>(resolve => {
        win.__resolveFullscreen = () => {
          win.__nativeElement = element;
          document.dispatchEvent(new Event('fullscreenchange'));
          resolve();
        };
      });
    };
  });
  await fullscreen(page).click();
  await page.locator('input').nth(1).fill('aqz-KE-bpKQ');
  await page.evaluate(() => (window as any).__resolveFullscreen());
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(wrapper(page)).not.toHaveClass(/bbe-player-fullscreen/);
  await expect(page.locator('.bbe-fullscreen-locked')).toHaveCount(0);
});

test('navigation while theater is active never traverses back into the previous video', async ({ page }) => {
  await setup(page, { theater: true });
  await start(page);
  await fullscreen(page).click();
  await viewportFilled(page);
  await page.goto('/lessons/player-ui-next');
  await expect(page.locator('[data-video-controls]')).toBeVisible();
  await expect(page.locator('.bbe-fullscreen-locked')).toHaveCount(0);
  expect(page.url()).toContain('/lessons/player-ui-next');
  expect(await page.evaluate(() => history.state?.bbeTheater ?? null)).toBeNull();
});

test('real Chromium native fullscreen enters/exits with same iframe and no synthetic history', async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== 'chromium' || isMobile, 'Actual desktop Chromium Fullscreen API; no device claim.');
  await setup(page);
  await start(page);
  const state = await page.evaluate(() => history.state);
  await wrapper(page).evaluate(el => { (window as any).__originalFrame = el.querySelector('iframe'); });
  await fullscreen(page).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.hasAttribute('data-video-player'))).toBe(true);
  await expect(wrapper(page)).toHaveAttribute('data-fullscreen-mode', 'NATIVE');
  await viewportFilled(page);
  await hiddenAfterIdle(page);
  await page.screenshot({ path: 'scratch/player-chromium-native-hidden.png' });
  expect(await page.evaluate(() => history.state)).toEqual(state);
  await wrapper(page).locator(':scope > button').click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(wrapper(page)).not.toHaveClass(/bbe-player-fullscreen/);
  expect(await page.evaluate(() => document.querySelector('[data-video-player] iframe') === (window as any).__originalFrame)).toBe(true);
  await hiddenAfterIdle(page);
});

test('unavailable presentation is reported honestly and a later retry can enter theater', async ({ page }) => {
  await setup(page, { theater: true });
  await start(page);
  const state = await page.evaluate(() => history.state);
  await wrapper(page).evaluate(el => { (window as any).__originalFrame = el.querySelector('iframe'); });
  const stylesheet = await page.addStyleTag({ content: '.bbe-player-fullscreen { position: relative !important; }' });
  await fullscreen(page).click();
  await expect(wrapper(page)).toHaveAttribute('data-fullscreen-mode', 'UNAVAILABLE');
  await expect(wrapper(page)).not.toHaveClass(/bbe-player-fullscreen/);
  await expect(page.locator('.bbe-fullscreen-locked')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Không thể mở toàn màn hình' })).toBeVisible();
  expect(await page.evaluate(() => history.state)).toEqual(state);
  expect(await page.evaluate(() => document.querySelector('[data-video-player] iframe') === (window as any).__originalFrame)).toBe(true);
  await stylesheet.evaluate(el => el.remove());
  await fullscreen(page).click();
  await expect(wrapper(page)).toHaveAttribute('data-fullscreen-mode', 'THEATER');
  await viewportFilled(page);
  await wrapper(page).locator(':scope > button').click();
  await expect(wrapper(page)).toHaveAttribute('data-fullscreen-mode', 'NONE');
});

for (const native of [false, true]) {
  test(`authenticated heartbeat/session survives ${native ? 'native' : 'theater'} fullscreen and speed changes`, async ({ page, browserName, isMobile }) => {
    test.skip(native && (browserName !== 'chromium' || isMobile), 'Actual native API case is desktop Chromium only; no device claim.');
    const events: any[] = [];
    await page.route('**/api/v1/lessons/player-ui-regression/progress', async route => {
      events.push(route.request().postDataJSON());
      await route.fulfill({ json: {} });
    });
    await setup(page, { theater: !native });
    // Mount the selected video with auth already present, then establish the
    // baseline. Subsequent fullscreen changes must never create another player.
    await page.locator('input').first().fill('ui-test-token');
    await page.locator('input').nth(1).fill('aqz-KE-bpKQ');
    await page.clock.fastForward(100);
    await expect(bar(page)).toBeVisible();
    await page.evaluate(() => { (window as any).__createsBeforeFullscreen = (window as any).__playerMock.creates; });
    await start(page);
    await page.clock.fastForward(11000);
    await expect.poll(() => events.filter(event => event.event === 'HEARTBEAT').length).toBeGreaterThan(0);
    const before = events.filter(event => event.event === 'HEARTBEAT').length;
    await reveal(page);
    await fullscreen(page).click();
    await expect(wrapper(page)).toHaveAttribute('data-fullscreen-mode', native ? 'NATIVE' : 'THEATER');
    await page.clock.fastForward(11000);
    await expect.poll(() => events.filter(event => event.event === 'HEARTBEAT').length).toBeGreaterThan(before);
    await reveal(page);
    if (isMobile) await bar(page).locator('button[title^="Đổi tốc độ"]').click();
    else await bar(page).getByRole('button', { name: '1.5x', exact: true }).click();
    await expect.poll(() => events.some(event => event.playbackRate > 1)).toBe(true);
    await wrapper(page).locator(':scope > button').click();
    await page.clock.fastForward(11000);
    expect(new Set(events.map(event => event.viewSessionId)).size).toBe(1);
    expect(events.every(event => event.viewSessionId && event.event && event.positionSeconds >= 0)).toBe(true);
    expect(await page.evaluate(() => (window as any).__playerMock.creates === (window as any).__createsBeforeFullscreen)).toBe(true);
  });
}

test('Admin organization history distinguishes ended Chapter and current DNA', async ({ page, context, browserName, isMobile }) => {
  test.skip(browserName !== 'chromium' || isMobile, 'Admin UI check on desktop Chromium; API security is separately tested against local PostgreSQL.');
  const nextEnv = await import('@next/env');
  nextEnv.default.loadEnvConfig(process.cwd());
  const { SignJWT } = await import('jose');
  const userId = '11111111-1111-4111-8111-111111111111';
  // This synthetic subject does not exist in the application DB. All API requests
  // are mocked, and the token is used solely for the local middleware page gate.
  const token = await new SignJWT({ role: 'ADMIN' }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setExpirationTime('2m').sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET));
  await context.addCookies([{ name: 'accessToken', value: token, url: 'http://127.0.0.1:3117', httpOnly: true }]);
  await page.addInitScript(({ token }) => {
    localStorage.setItem('accessToken', token);
    localStorage.setItem('user', JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', role: 'ADMIN', email: 'ui-test@invalid.example' }));
  }, { token });
  await page.route('**/api/v1/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/organization/history')) return route.fulfill({ json: {
      user: { id: userId, display_name: 'Synthetic learner' },
      chapters: [{ id: 'history', name: 'Phoenix', label: 'Đã rời Chapter', starts_at: '2026-04-01T00:00:00Z', ends_at: '2026-05-15T00:00:00Z' }],
      memberships: [{ id: 'dna', unit: { name: 'DNA SGDC' }, status: 'ACTIVE', starts_at: '2026-05-15T00:00:00Z', ends_at: null }], positions: [],
    } });
    if (pathname.endsWith('/auth/me')) return route.fulfill({ json: { user: { id: userId, role: 'ADMIN' } } });
    return route.fulfill({ json: { items: [], stats: {} } });
  });
  await page.goto(`/admin/users/${userId}/organization-history`);
  await expect(page.getByRole('heading', { name: 'Lịch sử tổ chức' })).toBeVisible();
  await expect(page.getByText('Đã rời Chapter', { exact: true })).toBeVisible();
  await expect(page.getByText('DNA SGDC', { exact: true })).toBeVisible();
  await expect(page.getByText('Đang hoạt động', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'scratch/organization-history-ui.png', fullPage: true });
});
