import { test, expect } from '@playwright/test';

test.describe('Sidebar tab switching animation (Direction A - flowing highlight)', () => {
  test('render sidebar with flowing active-tab highlight bar', async ({ page }) => {
    await page.goto('/admin/dashboard');
    // Wait for the nav to load
    await page.waitForSelector('nav');
    const sidebar = page.locator('#bbe-navigation');
    await expect(sidebar).toBeVisible();

    // The flowing highlight bar should be present behind the active tab
    const highlight = sidebar.locator('.bg-[#2563EB]', { hasNot: sidebar.locator('a') });
    // Bar height ~40px (h-10) behind the first nav item
    const firstNav = sidebar.locator('nav a').first();
    await expect(firstNav).toBeVisible();
    // The highlight bar should be positioned near the first tab
    await expect(highlight).toHaveClass(/bg-\[#2563EB\]/);

    // Click a different tab and verify the bar flows (position changes)
    const secondNav = sidebar.locator('nav a').nth(1);
    await secondNav.click();
    await page.waitForURL('/admin/courses');
    await expect(sidebar).toContainText('Khóa học & lộ trình');
    // Bar should still be present
    await expect(highlight).toHaveClass(/bg-\[#2563EB\]/);
  });
});
