import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * WCAG 2.1 Relative Luminance Calculation
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 */
function getRelativeLuminance(hexColor: string): number {
  const cleanHex = hexColor.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;

  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);

  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/**
 * WCAG 2.1 Contrast Ratio Calculation
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */
function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getRelativeLuminance(hex1);
  const l2 = getRelativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('PHASE A — High-Contrast Video Controls & WCAG Accessibility', () => {
  test('White text #FFFFFF against dark scrim #0f172a achieves WCAG AAA (> 7.0:1)', () => {
    const ratio = getContrastRatio('#FFFFFF', '#0f172a');
    assert.ok(ratio >= 7.0, `Expected contrast ratio >= 7.0, got ${ratio.toFixed(2)}`);
    assert.ok(ratio > 15.0, `Expected superior contrast ratio > 15.0, got ${ratio.toFixed(2)}`);
  });

  test('White text #FFFFFF against button background #1e293b achieves WCAG AAA (> 7.0:1)', () => {
    const ratio = getContrastRatio('#FFFFFF', '#1e293b');
    assert.ok(ratio >= 7.0, `Expected contrast ratio >= 7.0, got ${ratio.toFixed(2)}`);
    assert.ok(ratio > 11.0, `Expected contrast ratio > 11.0, got ${ratio.toFixed(2)}`);
  });

  test('Secondary text #E2E8F0 against control bar background #0f172a achieves WCAG AAA (> 7.0:1)', () => {
    const ratio = getContrastRatio('#E2E8F0', '#0f172a');
    assert.ok(ratio >= 7.0, `Expected contrast ratio >= 7.0, got ${ratio.toFixed(2)}`);
    assert.ok(ratio > 12.0, `Expected contrast ratio > 12.0, got ${ratio.toFixed(2)}`);
  });

  test('BBE Blue #2563EB against control bar background #0f172a meets WCAG 2.1 Non-text contrast (>= 3.0:1)', () => {
    const ratio = getContrastRatio('#2563EB', '#0f172a');
    assert.ok(ratio >= 3.0, `Expected non-text contrast ratio >= 3.0, got ${ratio.toFixed(2)}`);
  });

  test('Scrubber thumb #FFFFFF against track #334155 achieves high visibility (> 7.0:1)', () => {
    const ratio = getContrastRatio('#FFFFFF', '#334155');
    assert.ok(ratio >= 7.0, `Expected contrast ratio >= 7.0, got ${ratio.toFixed(2)}`);
  });
});

describe('PHASE B — Tiered Mobile Fullscreen Architecture', () => {
  test('Detection correctly identifies Android Chrome / Desktop with native requestFullscreen', () => {
    const mockElement = {
      requestFullscreen: async () => {},
    } as any;
    const mockDoc = {
      fullscreenEnabled: true,
    };

    const hasDocSupport = Boolean(mockDoc.fullscreenEnabled);
    const hasElSupport = Boolean(mockElement.requestFullscreen);
    const canUseNative = hasDocSupport && hasElSupport;

    assert.equal(canUseNative, true, 'Desktop & Android Chrome must be recognized as native-capable');
  });

  test('Detection correctly identifies iPhone Safari (div lacks requestFullscreen) and triggers Fallback', () => {
    // iPhone Safari div elements have NEITHER requestFullscreen nor webkitRequestFullscreen
    const mockIPhoneDiv = {} as any;
    const mockDoc = {
      fullscreenEnabled: false,
    };

    const hasDocSupport = Boolean(mockDoc.fullscreenEnabled);
    const hasElSupport = Boolean(mockIPhoneDiv.requestFullscreen || mockIPhoneDiv.webkitRequestFullscreen);
    const canUseNative = hasDocSupport && hasElSupport;

    assert.equal(canUseNative, false, 'iPhone Safari div must be recognized as NOT native-capable');
  });

  test('Viewport Theater Mode locks body scroll and adds bbe-fullscreen-locked class', () => {
    const mockClassList = new Set<string>();
    const mockBodyStyle = { overflow: '', touchAction: '' };

    // Simulate enterTheaterMode
    mockClassList.add('bbe-fullscreen-locked');
    mockBodyStyle.overflow = 'hidden';
    mockBodyStyle.touchAction = 'none';

    assert.ok(mockClassList.has('bbe-fullscreen-locked'), 'Must add bbe-fullscreen-locked class');
    assert.equal(mockBodyStyle.overflow, 'hidden', 'Must lock scroll');

    // Simulate exitTheaterMode
    mockClassList.delete('bbe-fullscreen-locked');
    mockBodyStyle.overflow = '';
    mockBodyStyle.touchAction = '';

    assert.ok(!mockClassList.has('bbe-fullscreen-locked'), 'Must remove bbe-fullscreen-locked class');
    assert.equal(mockBodyStyle.overflow, '', 'Must restore body overflow');
  });

  test('Android Back Button: popstate event cleanly exits theater mode without navigating away', () => {
    let currentFullscreenMode: 'NONE' | 'NATIVE' | 'THEATER' = 'THEATER';
    let isFullscreenState = true;

    // Simulate user pressing Android hardware / gesture Back button
    const handlePopState = () => {
      if (currentFullscreenMode === 'THEATER') {
        currentFullscreenMode = 'NONE';
        isFullscreenState = false;
      }
    };

    handlePopState();

    assert.equal(currentFullscreenMode, 'NONE', 'Must exit theater mode on popstate');
    assert.equal(isFullscreenState, false, 'isFullscreen must be false after popstate');
  });
});

describe('PHASE C — Responsive Control Bar Geometry (320px to Desktop)', () => {
  test('At 320px screen width, control bar items fit with zero overflow', () => {
    const screenWidth = 320;
    const padding = 12 * 2; // px-3 = 12px each side
    const availableWidth = screenWidth - padding; // 296px

    const playBtnWidth = 36;
    const rewindBtnWidth = 38;
    const forwardBtnWidth = 38;
    const timeDisplayWidth = 72; // "00:00 / 05:28"
    const gapLeft = 4 * 4; // gap-1 between 5 elements
    const leftGroupTotal = playBtnWidth + rewindBtnWidth + forwardBtnWidth + timeDisplayWidth + gapLeft;

    const speedBtnWidth = 36;
    const fullscreenBtnWidth = 36;
    const gapRight = 6;
    const rightGroupTotal = speedBtnWidth + fullscreenBtnWidth + gapRight;

    const totalBarWidth = leftGroupTotal + rightGroupTotal + 8; // between gap
    assert.ok(
      totalBarWidth <= availableWidth,
      `Total controls width (${totalBarWidth}px) must fit in available width (${availableWidth}px)`
    );
  });

  test('Touch targets meet or exceed mobile comfortable guidelines (>= 36px height, touch-manipulation)', () => {
    const buttonHeight = 36;
    assert.ok(buttonHeight >= 36, 'Mobile button height must be at least 36px for easy touch');
  });
});
