const { chromium } = require('@playwright/test');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Try admin credentials
  const email = 'bbetrainerteam@gmail.com';
  const password = 'BBEelearning123!';

  await page.goto('http://localhost:3000/login');
  await page.waitForTimeout(2000);

  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);

  console.log('URL after login:', page.url());

  const sidebarExists = await page.locator('#bbe-navigation').count();
  console.log('Sidebar exists:', sidebarExists > 0);

  if (sidebarExists > 0) {
    console.log('Nav links:', await page.locator('#bbe-navigation nav a').count());

    // Take screenshot at dashboard
    await page.goto('http://localhost:3000/admin/dashboard');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'verify/sidebar-before.png', fullPage: false });

    const navBtns = await page.locator('#bbe-navigation nav a');
    const second = await navBtns.nth(1);
    await second.click();
    await page.waitForURL('http://localhost:3000/admin/courses');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'verify/sidebar-after.png', fullPage: false });

    console.log('Screenshots saved!');
  } else {
    const errorText = await page.locator('text=Lỗi').first().textContent() || await page.locator('text=không đúng').first().textContent() || 'unknown error';
    console.log('Error:', errorText);
  }

  await browser.close();
})();