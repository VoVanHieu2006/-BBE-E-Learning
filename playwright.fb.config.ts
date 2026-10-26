import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './src/test/browser',
  testMatch: ['fb-feedback.spec.ts', 'video-player.spec.ts'],
  outputDir: './scratch/fb-fixes/browser-results',
  timeout: 60000,
  expect: { timeout: 12000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3117', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 3117',
    url: 'http://127.0.0.1:3117/leaderboard',
    timeout: 120000,
    reuseExistingServer: false,
  },
})
