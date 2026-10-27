const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('http://localhost:3000/login');
  await page.waitForTimeout(2000);

  await page.locator('input[type="email"]').fill('admin.demo@bbe.vn');
  await page.locator('input[type="password"]').fill('Demo@123456');
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);

  // Check for error message
  const errorText = await page.locator('text=⚠️').textContent() || await page.locator('text=Lỗi').textContent() || 'no error';
  console.log('Error text:', errorText);
  console.log('URL:', page.url());

  // Check localStorage / cookies via the page
  const localStorageItems = await page.evaluate(() => {
    return {
      user: localStorage.getItem('user'),
      accessToken: localStorage.getItem('accessToken'),
      refreshToken: localStorage.getItem('refreshToken'),
    };
  });
  console.log('localStorage:', localStorageItems);

  await browser.close();
})();