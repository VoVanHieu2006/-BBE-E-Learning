import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/test/browser',
  testMatch: 'tab-cache.spec.ts',
  outputDir: './scratch/tab-cache-results',
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3121',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 3121',
    url: 'http://127.0.0.1:3121/login',
    timeout: 120000,
    reuseExistingServer: false,
  },
});
