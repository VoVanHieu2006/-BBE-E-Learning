import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/test/browser',
  testMatch: 'video-player.spec.ts',
  outputDir: './scratch/player-browser-results',
  timeout: 45000,
  expect: { timeout: 10000 },
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'scratch/player-browser-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3117',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'] } },
    { name: 'chromium-touch-emulation', use: { ...devices['Pixel 7'] } },
    { name: 'webkit-touch-emulation', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: `npm run ${process.env.PLAYER_PRODUCTION === '1' ? 'start' : 'dev'} -- --hostname 127.0.0.1 --port 3117`,
    url: 'http://127.0.0.1:3117/lessons/player-ui-regression',
    timeout: 120000,
    reuseExistingServer: false,
  },
});
