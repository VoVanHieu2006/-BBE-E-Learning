# Screenshot verification script for the sidebar animation
$playwrightDir = "C:\Users\Acer\Desktop\E-learning\node_modules\.bin"

# Start dev server if not running
$process = Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*next dev*" -or $_.CommandLine -like "*3000*" } | Select-Object -First 1
if (-not $process) {
    Write-Host "Starting dev server..." -ForegroundColor Cyan
    Start-Process pwsh -ArgumentList "-Command", "cd 'C:\Users\Acer\Desktop\E-learning'; npm run dev" -NoNewWindow
    Start-Sleep -Seconds 5
}

# Use Playwright to take screenshots
cd "C:\Users\Acer\Desktop\E-learning"
npx playwright --help | Out-Null

# Take screenshot of admin dashboard sidebar
& node -e "
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/admin/dashboard');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'sidebar-admin.png', fullPage: true });
  // Wait for navigation to second tab
  const navBtns = await page.locator('#bbe-navigation nav a');
  const second = await navBtns.nth(1);
  await second.click();
  await page.waitForURL('http://localhost:3000/admin/courses');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'sidebar-admin-courses.png', fullPage: true });
  await browser.close();
  console.log('Screenshots saved');
})().catch(e => console.error(e));
"