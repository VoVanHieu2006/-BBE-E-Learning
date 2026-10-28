// Optional network-dependent smoke test. Start Next locally first; no YouTube mock.
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const failedHosts = new Set();
  const theater = process.env.PLAYER_FULLSCREEN_MODE === 'THEATER';
  const prefix = theater ? 'theater' : 'native';
  page.on('requestfailed', request => failedHosts.add(new URL(request.url()).hostname));
  try {
    await fs.mkdir('scratch/player-live', { recursive: true });
    if (theater) await page.addInitScript(() => Object.defineProperty(document, 'fullscreenEnabled', { value: false }));
    await page.goto(`${process.env.PLAYER_BASE_URL || 'http://127.0.0.1:3117'}/lessons/player-live-check`);
    await page.locator('input').nth(1).fill(process.env.PLAYER_YOUTUBE_ID || 'aqz-KE-bpKQ');
    const player = page.locator('[data-video-player]');
    const bar = page.locator('[data-video-controls]');
    await expect(bar).toBeVisible({ timeout: 60000 });
    await player.evaluate(el => { window.__liveFrame = el.querySelector('iframe'); });
    const conflictingPosition = await page.evaluate(() => {
      const element = document.createElement('div');
      element.className = 'fixed relative';
      document.body.appendChild(element);
      const position = getComputedStyle(element).position;
      element.remove();
      return position;
    });
    await bar.locator('button').first().click();
    const time = bar.locator('.tabular-nums');
    await expect(time).not.toContainText('0:00 /', { timeout: 30000 });
    await expect(bar).toHaveCSS('opacity', '0', { timeout: 10000 });
    await page.screenshot({ path: `scratch/player-live/${prefix}-playing-hidden.png` });
    const reveal = async () => {
      const box = await player.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2);
    };
    await reveal();
    await bar.getByRole('button', { name: '1.5x', exact: true }).click();
    await expect(bar).toHaveCSS('opacity', '0', { timeout: 6000 });
    await reveal();
    await bar.locator('button').nth(2).click();
    await expect(bar).toHaveCSS('opacity', '0', { timeout: 10000 });
    const beforeFullscreen = await time.textContent();
    await reveal();
    await bar.locator('button').last().click();
    if (theater) await expect(player).toHaveJSProperty('popover', 'manual');
    else await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await expect(bar).toHaveCSS('opacity', '0', { timeout: 6000 });
    await page.screenshot({ path: `scratch/player-live/${prefix}-hidden.png` });
    await player.locator(':scope > button').click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    expect(await player.evaluate(el => el.querySelector('iframe') === window.__liveFrame)).toBe(true);
    const result = { outcome: 'PASS', browser: browser.version(), mode: prefix, media: 'real YouTube', conflictingPosition, beforeFullscreen, afterFullscreen: await time.textContent(), failedHosts: [...failedHosts] };
    await fs.writeFile(`scratch/player-live/${prefix}-result.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch (error) {
    await page.screenshot({ path: `scratch/player-live/${prefix}-failure.png` }).catch(() => {});
    const result = { outcome: 'NOT_VERIFIED', message: error.message, failedHosts: [...failedHosts] };
    await fs.writeFile(`scratch/player-live/${prefix}-result.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
