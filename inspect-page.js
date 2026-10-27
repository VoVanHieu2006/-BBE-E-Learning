const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/admin/dashboard');
  await page.waitForTimeout(3000);
  const html = await page.content();
  console.log('Has login:', html.includes('login'));
  console.log('Has BBE:', html.includes('BBE'));
  const titleMatch = html.match(/<title>(.*?)<\/title>/);
  console.log('Title:', titleMatch ? titleMatch[1] : 'none');
  console.log('HTML length:', html.length);
  const idx = html.indexOf('bbe-navigation');
  console.log('bbe-navigation found at:', idx);
  if (idx !== -1) {
    console.log(html.substring(idx, idx + 3000));
  }
  await browser.close();
})().catch(e => console.error(e));
