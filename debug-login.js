const { chromium } = require('@playwright/test');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const loginUrl = 'http://localhost:3000/login';
  const email = 'admin.demo@bbe.vn';
  const password = 'Demo@123456';

  // Login
  await page.goto(loginUrl);
  await page.waitForTimeout(2000);

  // Inspect the page
  console.log('Title after load:', await page.title());
  const html = await page.locator('body').innerHTML();
  const inputEmail = html.match(/<input[^>]*email[^>]*>/);
  console.log('Email input found:', !!inputEmail);
  console.log('Submit button count:', await page.locator('button[type="submit"]').count());
  console.log('Page has BBE:', html.includes('BBE'));
  console.log('URL:', page.url());

  await browser.close();
})();