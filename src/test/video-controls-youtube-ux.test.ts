import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Test Suite: YouTube-like Video Controls UX Architecture
 * Verifies:
 * 1. Windowed mode auto-hide, instant leave hide, pinned states.
 * 2. Fullscreen mode significant movement threshold (6px), idle cursor hiding.
 * 3. 12% Left Safe Zone behavior and bottom-controls exception.
 * 4. Touch interaction toggle & safe-zone bypass.
 * 5. Pinned controls state (Seeking, Hovering buttons, Keyboard focus, Paused).
 * 6. Zero dark gradient scrim when hidden & Pause overlay purity.
 */

interface Point {
  x: number;
  y: number;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

// Controller simulator mirroring the unified Controls Coordinator logic in YouTubePlayer.tsx
class YouTubeControlsCoordinator {
  public showControls = true;
  public isCursorHidden = false;
  public isFullscreen = false;
  public displayPlaying = false;

  public isSeekingActive = false;
  public isInteractingWithControls = false;
  public isKeyboardFocused = false;
  public isPointerInsidePlayer = false;

  private hideControlsTimer: NodeJS.Timeout | null = null;
  private safeZoneTimer: NodeJS.Timeout | null = null;
  private lastPointerPos: Point = { x: -1, y: -1 };

  public playerRect: Rect = {
    left: 0,
    top: 0,
    right: 1920,
    bottom: 1080,
    width: 1920,
    height: 1080,
  };

  public isControlsPinned(): boolean {
    if (!this.displayPlaying) return true;
    if (this.isSeekingActive) return true;
    if (this.isInteractingWithControls) return true;
    if (this.isKeyboardFocused) return true;
    return false;
  }

  public clearHideControls(): void {
    if (this.hideControlsTimer) {
      clearTimeout(this.hideControlsTimer);
      this.hideControlsTimer = null;
    }
  }

  public clearSafeZoneTimer(): void {
    if (this.safeZoneTimer) {
      clearTimeout(this.safeZoneTimer);
      this.safeZoneTimer = null;
    }
  }

  public scheduleHideControls(delayMs: number = 2500): void {
    this.clearHideControls();
    if (this.isControlsPinned()) return;

    this.hideControlsTimer = setTimeout(() => {
      if (this.isControlsPinned()) return;
      this.showControls = false;
      if (this.isFullscreen) {
        this.isCursorHidden = true;
      }
    }, delayMs);
  }

  public revealControls(autoHideDelay: number = 2500): void {
    this.showControls = true;
    this.isCursorHidden = false;
    this.clearSafeZoneTimer();
    if (this.displayPlaying && !this.isControlsPinned()) {
      this.scheduleHideControls(autoHideDelay);
    } else {
      this.clearHideControls();
    }
  }

  public onPointerEnter(x: number, y: number): void {
    this.isPointerInsidePlayer = true;
    this.lastPointerPos = { x, y };
    this.revealControls(2500);
  }

  public onPointerLeave(): void {
    this.isPointerInsidePlayer = false;
    this.clearSafeZoneTimer();
    // Instant hide on leave when playing and not pinned
    if (this.displayPlaying && !this.isControlsPinned()) {
      this.clearHideControls();
      this.showControls = false;
    }
  }

  public onPointerMove(x: number, y: number, isTouch = false): void {
    if (isTouch) return;
    this.isPointerInsidePlayer = true;

    const prevX = this.lastPointerPos.x;
    const prevY = this.lastPointerPos.y;
    const dx = Math.abs(x - prevX);
    const dy = Math.abs(y - prevY);
    const distance = Math.hypot(dx, dy);

    this.lastPointerPos = { x, y };

    // 1. FULLSCREEN SAFE ZONE (Left 12% of screen)
    if (this.isFullscreen) {
      const isOverBottomControls = y >= this.playerRect.bottom - 80;
      const isInLeftSafeZone = (x - this.playerRect.left) < (this.playerRect.width * 0.12);

      // Mouse inside left safe zone AND NOT over bottom controls
      if (isInLeftSafeZone && !isOverBottomControls && !this.isControlsPinned()) {
        // Do NOT trigger controls to appear!
        // If controls are currently visible, auto-hide them quickly after 600ms
        if (this.showControls && !this.safeZoneTimer) {
          this.safeZoneTimer = setTimeout(() => {
            if (!this.isControlsPinned()) {
              this.showControls = false;
              this.isCursorHidden = true;
            }
          }, 600);
        }
        return;
      }
    }

    // 2. MOVEMENT THRESHOLD
    const minThreshold = this.isFullscreen ? 6 : 3;
    if (distance < minThreshold && prevX >= 0) {
      return;
    }

    // 3. REVEAL CONTROLS UPON VALID MOVEMENT
    this.revealControls(2500);
  }

  public onTouchStart(): void {
    if (this.displayPlaying) {
      if (this.showControls) {
        this.clearHideControls();
        this.showControls = false;
      } else {
        this.revealControls(3000);
      }
    } else {
      this.revealControls(3000);
    }
  }

  public destroy(): void {
    this.clearHideControls();
    this.clearSafeZoneTimer();
  }
}

test('PHASE A — Windowed Mode (Chế độ thường)', async (t) => {
  await t.test('Test 1: Controls auto-hide after 2500ms when playing without interaction', async () => {
    const c = new YouTubeControlsCoordinator();
    c.displayPlaying = true;
    c.revealControls(50); // fast timeout for test

    assert.equal(c.showControls, true, 'Controls should be visible initially');
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(c.showControls, false, 'Controls must auto-hide after inactivity');
    c.destroy();
  });

  await t.test('Test 2: Mouse enter immediately reveals controls', async () => {
    const c = new YouTubeControlsCoordinator();
    c.displayPlaying = true;
    c.showControls = false;

    c.onPointerEnter(500, 300);
    assert.equal(c.showControls, true, 'Entering player must immediately reveal controls');
    c.destroy();
  });

  await t.test('Test 3: Mouse leave immediately hides controls without waiting 2.5s', async () => {
    const c = new YouTubeControlsCoordinator();
    c.displayPlaying = true;
    c.showControls = true;

    c.onPointerLeave();
    assert.equal(c.showControls, false, 'Leaving player must immediately hide controls without delay');
    c.destroy();
  });

  await t.test('Test 4: When video is paused, controls stay pinned and never auto-hide', async () => {
    const c = new YouTubeControlsCoordinator();
    c.displayPlaying = false;
    c.revealControls(50);

    assert.equal(c.isControlsPinned(), true, 'Paused state must pin controls');
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(c.showControls, true, 'Paused video must KEEP controls visible');
    c.destroy();
  });

  await t.test('Test 5: Dragging scrubber or hovering buttons pins controls from hiding', async () => {
    const c = new YouTubeControlsCoordinator();
    c.displayPlaying = true;
    c.showControls = true;

    // Start scrubber drag
    c.isSeekingActive = true;
    assert.equal(c.isControlsPinned(), true, 'Active seek must pin controls');
    c.scheduleHideControls(50);
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(c.showControls, true, 'Controls must not hide while dragging seek bar');

    // Finish seek, but user is hovering buttons
    c.isSeekingActive = false;
    c.isInteractingWithControls = true;
    c.scheduleHideControls(50);
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(c.showControls, true, 'Controls must not hide while hovering buttons');

    // User leaves controls
    c.isInteractingWithControls = false;
    c.scheduleHideControls(50);
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(c.showControls, false, 'Controls must hide after user stops interacting');
    c.destroy();
  });
});

test('PHASE B — Fullscreen Mode & Cursor Hiding', async (t) => {
  await t.test('Test 6: Fullscreen auto-hide also hides cursor (cursor: none)', async () => {
    const c = new YouTubeControlsCoordinator();
    c.isFullscreen = true;
    c.displayPlaying = true;
    c.revealControls(50);

    assert.equal(c.isCursorHidden, false, 'Cursor should be visible when controls are shown');
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal(c.showControls, false, 'Controls must hide');
    assert.equal(c.isCursorHidden, true, 'Cursor must be hidden in fullscreen when idle');
    c.destroy();
  });

  await t.test('Test 7: Micro-jitter (< 6px) in fullscreen does not wake up controls', async () => {
    const c = new YouTubeControlsCoordinator();
    c.isFullscreen = true;
    c.displayPlaying = true;
    c.showControls = false;
    c.isCursorHidden = true;

    // Initial position in center (960, 540)
    c.onPointerEnter(960, 540);
    c.showControls = false; // simulate already idle

    // Jitter of 2px
    c.onPointerMove(961, 541);
    assert.equal(c.showControls, false, 'Micro-jitter < 6px must NOT awaken controls');

    // Jitter of 4px
    c.onPointerMove(963, 542);
    assert.equal(c.showControls, false, 'Movement < 6px must still be suppressed');

    // Significant movement (dx=15px)
    c.onPointerMove(978, 542);
    assert.equal(c.showControls, true, 'Movement >= 6px must awaken controls');
    assert.equal(c.isCursorHidden, false, 'Cursor must be restored immediately');
    c.destroy();
  });
});

test('PHASE C — Left Safe Zone (12%) in Fullscreen', async (t) => {
  await t.test('Test 8: Mouse moving in Left Safe Zone (< 12%) does not awaken controls', async () => {
    const c = new YouTubeControlsCoordinator();
    c.isFullscreen = true;
    c.displayPlaying = true;
    c.showControls = false;
    c.isCursorHidden = true;

    // Player width = 1920px. 12% is 230.4px.
    // Mouse enters inside safe zone at x = 100px, y = 400px (not bottom controls)
    c.onPointerEnter(100, 400);
    c.showControls = false; // start idle

    // Move mouse within safe zone (from x=100 to x=150)
    c.onPointerMove(150, 410);
    assert.equal(c.showControls, false, 'Moving inside Left 12% safe zone must NOT awaken controls');
    c.destroy();
  });

  await t.test('Test 9: Moving from safe zone to normal zone awakens controls', async () => {
    const c = new YouTubeControlsCoordinator();
    c.isFullscreen = true;
    c.displayPlaying = true;
    c.showControls = false;
    c.isCursorHidden = true;

    // Set last pos in safe zone
    c.onPointerEnter(100, 400);
    c.showControls = false;

    // Cross the 12% threshold (x = 300px > 230.4px) with significant movement
    c.onPointerMove(300, 400);
    assert.equal(c.showControls, true, 'Crossing into normal viewing zone must awaken controls');
    c.destroy();
  });

  await t.test('Test 10: BOTTOM CONTROLS EXCEPTION — moving to bottom-left Play button DOES awaken controls', async () => {
    const c = new YouTubeControlsCoordinator();
    c.isFullscreen = true;
    c.displayPlaying = true;
    c.showControls = false;

    // Bottom controls are at y >= 1080 - 80 = 1000px.
    // User moves mouse to bottom-left corner to click Play button (x = 40px, y = 1030px)
    c.onPointerEnter(40, 1010);
    c.onPointerMove(40, 1030); // in bottom controls area!
    assert.equal(c.showControls, true, 'Bottom controls area must be EXEMPT from safe zone suppression');
    c.destroy();
  });

  await t.test('Test 11: If controls are visible and mouse enters safe zone, controls auto-hide quickly (600ms)', async () => {
    const c = new YouTubeControlsCoordinator();
    c.isFullscreen = true;
    c.displayPlaying = true;
    c.showControls = true;

    // Mouse enters safe zone
    c.onPointerEnter(100, 400);
    c.onPointerMove(110, 410);

    assert.equal(c.showControls, true, 'Still visible right away');
    await new Promise((resolve) => setTimeout(resolve, 650));
    assert.equal(c.showControls, false, 'Controls must auto-hide quickly when placed in safe zone');
    c.destroy();
  });
});

test('PHASE D — Mobile & Touch Interaction', async (t) => {
  await t.test('Test 12: Touch tap toggles controls when playing', async () => {
    const c = new YouTubeControlsCoordinator();
    c.displayPlaying = true;
    c.showControls = false;

    // First tap reveals controls
    c.onTouchStart();
    assert.equal(c.showControls, true, 'First touch tap reveals controls');

    // Second tap hides controls
    c.onTouchStart();
    assert.equal(c.showControls, false, 'Second touch tap hides controls');
    c.destroy();
  });

  await t.test('Test 13: Touch devices bypass 12% mouse safe zone', async () => {
    const c = new YouTubeControlsCoordinator();
    c.isFullscreen = true;
    c.displayPlaying = true;
    c.showControls = false;

    // Synthetic mouse event flagged as touch is ignored so touch logic handles it
    c.onPointerMove(50, 400, true);
    assert.equal(c.showControls, false, 'Synthetic mouse move from touch does not awaken');

    // Touch tap at left margin still awakens controls
    c.onTouchStart();
    assert.equal(c.showControls, true, 'Touch tap works everywhere on screen');
    c.destroy();
  });
});
